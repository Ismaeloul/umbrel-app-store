import Foundation
import Observation

/* El modelo de la pantalla de emparejar este iPhone (a2 §22, §23.3; b-arquitectura §1.4): el
   `PairingViewModel` rescatado en la poda + los estados de la cámara, el canje automático (QR leído, enlace
   `aceneo://pair` abierto o pegado en el código) y la pausa de 60 s. Lo que decide es puro
   (`ReglasEmparejar`); aquí se juntan los hechos, los plazos y los servicios (canje, háptica, anuncios),
   que se inyectan para probarlo sin red ni cámara (ModeloEmparejarTests). */

@MainActor @Observable final class ModeloEmparejar {
    /// Los plazos de a2 §22 (los tests los acortan).
    struct Plazos: Sendable {
        var pausa: Duration = ReglasEmparejar.pausa
        var vueltaCapsula: Duration = ReglasEmparejar.vueltaCapsula
        var ignorarTrasAjeno: Duration = ReglasEmparejar.ignorarTrasAjeno
        var marcoRojo: Duration = ReglasEmparejar.marcoRojo
    }

    /// Lo que el modelo necesita de fuera.
    struct Servicios {
        /// El canje (`PairingService.emparejar`): ping + `POST pairing/claim` + token al Llavero.
        var canjear: @MainActor (ServerConfig, String) async throws -> PairingClaimResponse
        /// La háptica central (`Haptica.disparar`).
        var vibrar: @MainActor (TipoHaptico) -> Void = { _ in }
        /// Anuncio de VoiceOver.
        var anunciar: @MainActor (String) -> Void = { _ in }
        /// Emparejado: la sesión y la raíz siguen (a2 §22.6).
        var alEmparejar: @MainActor (PairingClaimResponse, [URL], String) async -> Void = { _, _, _ in }
    }

    // MARK: Campos

    private var codigoLimpio = ""
    /// Solo cifras y como mucho 6; si se pega un enlace `aceneo://pair…`, se aplica entero y se empareja solo.
    var codigo: String {
        get { codigoLimpio }
        set {
            if ReglasEmparejar.esEnlace(newValue), let url = URL(string: newValue.trimmingCharacters(in: .whitespacesAndNewlines)),
                let enlace = PairingLink(url: url)
            {
                aplicar(enlace)
                Task { await emparejar() }
                return
            }
            codigoLimpio = ReglasEmparejar.filtrarCodigo(newValue)
            bordeCodigo = false
        }
    }
    var direccionCasa = "" { didSet { erroresCampo[.casa] = nil } }
    var direccionTailscale = "" { didSet { erroresCampo[.tailscale] = nil } }

    // MARK: Estado

    private(set) var erroresCampo: [HuecoDireccion: String] = [:]
    /// Fila de error bajo el texto de entrada (a2 §22.5).
    private(set) var fila: String?
    private(set) var bordeCodigo = false
    private(set) var enviando = false
    /// «Emparejado» en el botón (a2 §22.4).
    private(set) var hecho = false
    private(set) var enPausa = false
    /// Lo que dice la cámara (permiso, sesión, interrupción).
    private(set) var captura: EstadoCaptura = .preparando
    /// Lo que se pone encima de la cámara un rato (QR ajeno, emparejando, error…).
    private(set) var superpuesto: EstadoCamara?
    /// Cuenta los cambios de la fila de error: la pantalla desplaza hasta ella (a2 §22.5).
    private(set) var peticionFila = 0
    /// La imagen de la cámara ya ha llegado (fundido de 320 ms).
    private(set) var hayImagen = false
    /// Un QR recién leído que aún espera su canje: la cámara sigue parada (imagen congelada, a2 §22.3.1) aunque
    /// `emparejar()` no haya empezado todavía.
    private(set) var leyendoQR = false
    /// Cambia cuando la cámara puede volver a leer el mismo QR: tras un fallo que no es del código (red, no es
    /// un Ace Player Neo…), al volver la cápsula a la de escanear (4,5 s) o al acabar la pausa.
    private(set) var vecesReleer = 0

    @ObservationIgnored private var fallosSeguidos = 0
    @ObservationIgnored private var ignorarHasta = false
    @ObservationIgnored private var tareaCapsula: Task<Void, Never>?
    @ObservationIgnored private var tareaPausa: Task<Void, Never>?
    @ObservationIgnored private var tareaIgnorar: Task<Void, Never>?
    @ObservationIgnored private var hostQR: String?
    @ObservationIgnored private var servidoresQR: [URL] = []
    @ObservationIgnored private var releerPendiente = false

    private let servicios: Servicios
    private let plazos: Plazos

    init(servicios: Servicios, guardadas: ServerConfig = ServerConfig(), plazos: Plazos = Plazos()) {
        self.servicios = servicios
        self.plazos = plazos
        direccionCasa = guardadas.lan?.absoluteString ?? ""
        direccionTailscale = guardadas.tailscale?.absoluteString ?? ""
    }

    // MARK: Lo que se pinta

    /// El estado del cartel (a2 §22.3.1).
    var estadoCamara: EstadoCamara {
        switch captura {
        case .sinPermiso: return .sinPermiso
        case .restringida: return .restringida
        case .sinCamara: return .sinCamara
        default: break
        }
        if let superpuesto { return superpuesto }
        if enPausa { return .pausa }
        switch captura {
        case .activa: return .escaneando
        case .ocupada: return .ocupada
        default: return .preparando
        }
    }

    /// La cámara lee solo escaneando (se para al leer, en la pausa y emparejando).
    var camaraLeyendo: Bool { !enviando && !leyendoQR && !hecho && !enPausa }

    var hayDireccion: Bool {
        !(direccionCasa.trimmingCharacters(in: .whitespaces).isEmpty
            && direccionTailscale.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    /// «Emparejar» deshabilitado con el código incompleto, sin dirección, enviando o en pausa.
    var puedeEnviar: Bool { !enviando && !hecho && !enPausa && PairingLink.codigoValido(codigo) && hayDireccion }

    // MARK: Cámara

    func cambioCaptura(_ nuevo: EstadoCaptura) {
        captura = nuevo
    }

    func primeraImagen() { hayImagen = true }

    /// Texto leído por la cámara. Devuelve `true` si es un enlace de emparejar (la cámara se para).
    func leido(_ texto: String) -> Bool {
        guard camaraLeyendo, !ignorarHasta else { return false }
        guard let url = URL(string: texto.trimmingCharacters(in: .whitespacesAndNewlines)), let enlace = PairingLink(url: url) else {
            qrAjeno()
            return false
        }
        servicios.vibrar(.ligera)
        aplicar(enlace)
        leyendoQR = true
        Task { await emparejar() }
        return true
    }

    private func qrAjeno() {
        servicios.vibrar(.error)
        servicios.anunciar(ReglasEmparejar.qrAjenoLargo)
        mostrarUnRato(.qrAjeno)
        ignorarHasta = true
        tareaIgnorar?.cancel()
        let espera = plazos.ignorarTrasAjeno
        tareaIgnorar = Task { [weak self] in
            try? await Task.sleep(for: espera)
            guard !Task.isCancelled else { return }
            self?.ignorarHasta = false
        }
    }

    /// Pone un estado encima de la cámara y lo quita a los 4,5 s (QR ajeno, error).
    private func mostrarUnRato(_ estado: EstadoCamara) {
        superpuesto = estado
        tareaCapsula?.cancel()
        let espera = plazos.vueltaCapsula
        tareaCapsula = Task { [weak self] in
            try? await Task.sleep(for: espera)
            guard !Task.isCancelled, let self, self.superpuesto == estado else { return }
            self.superpuesto = nil
            if estado == .errorEmparejar { self.dejarReleer() }
        }
    }

    // MARK: Enlace y campos

    /// Rellena desde un enlace: cada dirección a su hueco por `ServerVia.clasificar` (con varias `u=`, la
    /// primera de cada tipo; a2 §22.4, a9 §3.4) y el código. Quita la fila de error. Sin `servidores`, todas las
    /// del enlace (también el que llega desde fuera, `aceneo://pair` con la Cámara del sistema).
    func aplicar(_ enlace: PairingLink, servidores: [URL] = []) {
        let todas = servidores.isEmpty ? enlace.servidores : servidores
        let huecos = ReglasEmparejar.huecos(todas)
        if let casa = huecos.casa { direccionCasa = casa.absoluteString }
        if let tailscale = huecos.tailscale { direccionTailscale = tailscale.absoluteString }
        codigoLimpio = enlace.codigo
        bordeCodigo = false
        fila = nil
        hostQR = ReglasEmparejar.host(todas.first ?? enlace.servidor)
        servidoresQR = todas
    }

    /// Tocar un campo quita la fila de error (a2 §22.5).
    func tocarCampo() {
        fila = nil
    }

    // MARK: Canje

    /// Canjea el código. Devuelve `true` si ha quedado emparejado.
    @discardableResult
    func emparejar() async -> Bool {
        // Hasta la primera espera todo va en el mismo turno: la cámara pasa de `leyendoQR` a `enviando` sin
        // volver a arrancar entre medias.
        leyendoQR = false
        guard !enviando, !hecho, !enPausa else { return false }
        let leidas = ReglasEmparejar.direcciones(casa: direccionCasa, tailscale: direccionTailscale)
        guard leidas.errores.isEmpty else {
            erroresCampo = leidas.errores
            return false
        }
        guard PairingLink.codigoValido(codigo), !leidas.config.vacia else { return false }
        let host = hostQR ?? [leidas.config.lan, leidas.config.tailscale].compactMap { $0 }.first.map(ReglasEmparejar.host) ?? ""
        let servidores = servidoresQR.isEmpty ? [leidas.config.lan, leidas.config.tailscale].compactMap { $0 } : servidoresQR
        enviando = true
        releerPendiente = false
        fila = nil
        superpuesto = .emparejando(host: host)
        tareaCapsula?.cancel()
        do {
            let respuesta = try await servicios.canjear(leidas.config, codigo)
            enviando = false
            hecho = true
            fallosSeguidos = 0
            superpuesto = .emparejado(host: host)
            servicios.vibrar(.exito)
            servicios.anunciar("Emparejado con \(host)")
            await servicios.alEmparejar(respuesta, servidores, host)
            return true
        } catch {
            fallar(error)
            return false
        }
    }

    private func fallar(_ error: any Error) {
        enviando = false
        hostQR = nil
        servidoresQR = []
        let fallo: FalloCanje
        if let api = error as? APIError {
            fallo = ReglasEmparejar.fallo(api)
        } else {
            let texto = (error as? LocalizedError)?.errorDescription ?? APIError.desde(error).mensaje
            fallo = FalloCanje(texto: texto)
        }
        fila = fallo.texto
        peticionFila += 1
        bordeCodigo = fallo.bordeCodigo
        if fallo.vaciarCodigo { codigoLimpio = "" }
        releerPendiente = ReglasEmparejar.releerTrasFallo(fallo)
        servicios.vibrar(.error)
        servicios.anunciar(fallo.texto)
        fallosSeguidos += 1
        if fallo.pausa || fallosSeguidos >= ReglasEmparejar.fallosAntesDePausa {
            empezarPausa()
        } else {
            mostrarUnRato(.errorEmparejar)
        }
    }

    /// «Demasiados intentos»: botón y cámara en pausa 60 s; se reanudan solos (a2 §22.5).
    private func empezarPausa() {
        superpuesto = nil
        tareaCapsula?.cancel()
        enPausa = true
        fallosSeguidos = 0
        tareaPausa?.cancel()
        let espera = plazos.pausa
        tareaPausa = Task { [weak self] in
            try? await Task.sleep(for: espera)
            guard !Task.isCancelled else { return }
            self?.enPausa = false
            self?.dejarReleer()
        }
    }

    /// Tras un fallo que no es del código, el mismo QR se puede volver a leer (sin escribir nada a mano).
    private func dejarReleer() {
        guard releerPendiente else { return }
        releerPendiente = false
        vecesReleer += 1
    }
}
