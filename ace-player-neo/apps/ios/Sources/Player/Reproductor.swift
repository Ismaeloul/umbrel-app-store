import Foundation
import Observation
import os

/// El orquestador de la reproducción: pide la URL al backend, engancha
/// AVPlayer, vigila, reconecta, salta al directo, suelta la sesión y cuenta
/// lo que pasa. Es `runtime.ts` de la web portado sobre `MaquinaConexion`:
///
/// - El INTENTO pertenece a la fuente elegida: una reconexión no manda otro
///   `arranco` y una fuente que se cae tras 10 min se anota `cayo`, no `fallo`.
/// - Presupuesto de reconexiones POR VENTANA (las de los últimos 3 min) con
///   espera exponencial (1, 2, 4 s): 3 antes de dar la fuente por perdida
///   (1 en el arranque automático antes de la primera imagen). Agotadas, se
///   pregunta a `alFallarFuente` (el centro de partido pasa a la siguiente
///   verificada).
/// - La sesión es del backend (D5): latido cada 15 s y release al parar. Un
///   410/404 en el latido distingue el traspaso a otro dispositivo de una
///   sesión caducada.
/// - Imagen congelada con vídeo por delante: SALTA AL DIRECTO en vez de
///   reiniciar; si sigue parada 24 s, reconecta.
/// - `stream.reopened` reengancha sin intervención; `playback.handoff` para
///   sin soltar (ya lo hizo el backend).
/// - «Arrancó» = primer fotograma real, no el colchón lleno.
@MainActor
@Observable
public final class Reproductor {
    // MARK: Lo que pinta la interfaz

    public private(set) var canal: CanalReproducible?
    public private(set) var conexion: FaseConexion = .idle
    public private(set) var medio: FaseMedio = .idle
    public private(set) var mensaje: String?
    public private(set) var intento: IntentoReconexion?
    public private(set) var directo: InfoDirecto = .nada
    public private(set) var estadisticas: StreamStatsData?
    /// Ya hubo imagen con esta fuente.
    public private(set) var arranco = false
    public private(set) var sesionId: String?
    public private(set) var motivoParada: MotivoParada?
    /// La persona quiere que suene (intención, no medida).
    public private(set) var quiereReproducir = false
    public private(set) var modo: PlaybackMode
    /// Sube con cada fuente perdida (háptica de error).
    public private(set) var errores = 0
    /// Sube con cada canal nuevo (háptica de cambio de fuente).
    public private(set) var cambiosDeFuente = 0
    /// Sube cada vez que, agotada una fuente, el centro de partido pasa solo a la siguiente (háptica de aviso).
    public private(set) var cambiosAutomaticos = 0
    /// Hay una detención reciente que se puede deshacer («Deshacer» del mini).
    public private(set) var puedeDeshacerDetencion = false
    /// Veces que el vigilante saltó al directo por imagen congelada.
    public private(set) var saltosAlDirecto = 0
    /// Milisegundos desde que se pidió la fuente hasta la primera imagen («Datos técnicos»).
    public private(set) var primeraImagenMs: Double?
    /// Reconexiones de la fuente actual («Datos técnicos»).
    public private(set) var reconexiones = 0
    /// Canales para «anterior / siguiente» (fuentes del partido o favoritos).
    public var lista: [CanalReproducible] = []

    public var fase: FaseReproductor { FaseReproductor.derivar(conexion, medio) }

    // La presentación (expandido, superficiesGrandes, visibleEnMini, vista, expandir, minimizar,
    // superficieGrande) salió en la poda (fase 0.2): pasa a PresentacionReproductor (b-arquitectura §2.6, M3).

    // MARK: Dependencias

    public let motor: any MotorVideo
    public let visor: String
    /// Id de este dispositivo en el backend (del arranque), para reconocer un traspaso.
    @ObservationIgnored public var dispositivoId: String?
    /// Quien decide la siguiente fuente al agotar las reconexiones. Devuelve
    /// `true` si ya ha puesto otra a sonar.
    @ObservationIgnored public var alFallarFuente: ((FalloFuente) -> Bool)?
    /// Pantalla de bloqueo, Centro de Control y sesión de audio (nil en los tests).
    @ObservationIgnored public var sistema: (any ControlesDelSistema)?

    private let servicio: any ServicioReproduccion
    private let esperar: @Sendable (TimeInterval) async throws -> Void
    private let reloj: @Sendable () -> Date
    private let automatico: Bool
    private let preferencias: UserDefaults?
    private let registro = Logger(subsystem: "es.ismaeloul.aceplayerneo", category: "reproductor")

    // MARK: Estado interno (de la fuente y de la conexión)

    private struct EstadoFuente {
        let clave: Int
        let canal: CanalReproducible
        let origen: OrigenReproduccion
        let pedidaEn: Date
        var reconexiones: [Date] = []
        var empezoEn: Date?
        var arrancoEnviado = false
        var ultimoSigue: Date = .distantPast
        var metricasEnviadas = false
        var ttffMs: Double?
        var rebuffers = 0
        var reconexionesTotales = 0
    }

    private struct EstadoConexion {
        let generacion: Int
        var ticsConexion = 0
        var ticsParado = 0
        var ticsGracia = 0
        var ultimaPosicion: Double = 0
    }

    private struct Sesion {
        let id: String
        var url: URL
        var protocolo: StreamProtocol
        let latidoMs: Int
    }

    /// Lo último que sonaba antes de `detener()`, para «Deshacer».
    private struct Detencion {
        let canal: CanalReproducible
        let lista: [CanalReproducible]
        let origen: OrigenReproduccion
    }

    @ObservationIgnored private var ultimaDetencion: Detencion?
    @ObservationIgnored private var fuente: EstadoFuente?
    @ObservationIgnored private var estadoConexion: EstadoConexion?
    @ObservationIgnored private var sesion: Sesion?
    @ObservationIgnored private var generacion = 0
    @ObservationIgnored private var claves = 0
    @ObservationIgnored private var pausasPropias = 0
    @ObservationIgnored private var tareaConexion: Task<Void, Never>?
    @ObservationIgnored private var tareaReconexion: Task<Void, Never>?
    @ObservationIgnored private var tareaLatido: Task<Void, Never>?
    @ObservationIgnored private var tareaVigilante: Task<Void, Never>?
    @ObservationIgnored private var tareaPausaAjena: Task<Void, Never>?

    /// - Parameters:
    ///   - automatico: arranca el vigilante (1,5 s) y el latido (15 s). En los
    ///     tests va a `false` y se llama a `tic()` y `latir()` a mano.
    ///   - esperar: la espera entre reconexiones (en los tests, inmediata).
    public init(
        motor: any MotorVideo, servicio: any ServicioReproduccion, visor: String,
        modo: PlaybackMode = .porDefecto, automatico: Bool = true, preferencias: UserDefaults? = nil,
        esperar: @escaping @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) },
        reloj: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.motor = motor
        self.servicio = servicio
        self.visor = visor
        self.automatico = automatico
        self.preferencias = preferencias
        self.esperar = esperar
        self.reloj = reloj
        if let guardado = preferencias?.string(forKey: Self.claveModo), let modoGuardado = PlaybackMode(rawValue: guardado) {
            self.modo = modoGuardado
        } else {
            self.modo = modo
        }
        motor.alEvento = { [weak self] evento in self?.alEventoMotor(evento) }
    }

    private static let claveModo = "es.ismaeloul.aceplayerneo.modo"

    // MARK: Órdenes públicas

    /// Pone a sonar un canal. Si ya sonaba otro, suelta su sesión antes.
    public func reproducir(
        _ nuevo: CanalReproducible, origen: OrigenReproduccion = .usuario, lista: [CanalReproducible]? = nil
    ) {
        if let lista { self.lista = lista }
        // El mismo canal ya en marcha: solo asegurar que suena.
        if let actual = canal, actual.id == nuevo.id, conexion.enMarcha {
            canal = nuevo
            reanudar()
            return
        }
        if fuente != nil { terminarFuente(motivo: .channelChange, porque: "cambio de canal") }
        claves += 1
        fuente = EstadoFuente(clave: claves, canal: nuevo, origen: origen, pedidaEn: reloj())
        canal = nuevo
        motivoParada = nil
        mensaje = nil
        intento = nil
        estadisticas = nil
        arranco = false
        directo = .nada
        medio = .idle
        primeraImagenMs = nil
        reconexiones = 0
        quiereReproducir = true
        puedeDeshacerDetencion = false
        ultimaDetencion = nil
        cambiosDeFuente += 1
        transicion(.solicitar)
        sistema?.empezo(nuevo)
        sistema?.cambio(self)
        conectar(recuperacion: false)
        arrancarVigilante()
    }

    /// Para del todo y suelta la sesión. Se recuerda lo que sonaba para «Deshacer».
    public func detener() {
        guard let actual = canal else { return }
        ultimaDetencion = Detencion(canal: actual, lista: lista, origen: fuente?.origen ?? .usuario)
        puedeDeshacerDetencion = true
        terminarFuente(motivo: .user, porque: "parado")
        transicion(.detener)
        motivoParada = .usuario
        canal = nil
        mensaje = nil
        intento = nil
        medio = .idle
        quiereReproducir = false
        tareaVigilante?.cancel()
        tareaVigilante = nil
        sistema?.termino()
    }

    /// Vuelve a poner lo que se acababa de detener (el «Deshacer» del mini).
    /// Devuelve false si no había nada que deshacer.
    @discardableResult
    public func deshacerDetencion() -> Bool {
        guard let detencion = ultimaDetencion, canal == nil else { return false }
        ultimaDetencion = nil
        puedeDeshacerDetencion = false
        reproducir(detencion.canal, origen: detencion.origen, lista: detencion.lista)
        return true
    }

    public func pausar() {
        quiereReproducir = false
        tareaPausaAjena?.cancel()
        pausasPropias += 1
        motor.pausar()
        medio = conexion == .activa ? .pausado : medio
        sistema?.cambio(self)
    }

    public func reanudar() {
        guard canal != nil else { return }
        if conexion == .idle || conexion == .error {
            // Tras un traspaso o una fuente perdida, «reproducir» vuelve a pedirla.
            if let canal { reintentarDesdeCero(canal) }
            return
        }
        quiereReproducir = true
        motor.reproducir()
        sistema?.cambio(self)
    }

    public func alternar() {
        if quiereReproducir && conexion.enMarcha { pausar() } else { reanudar() }
    }

    /// Salta al borde útil del directo (con el colchón de seguridad del modo).
    public func irAlDirecto() async {
        guard conexion == .activa, let ventana = motor.ventana else { return }
        let seguridad = Directo.colchonSeguridad(modo: modo, duracionVentana: ventana.duracion)
        guard let objetivo = Directo.objetivo(ventana: ventana, seguridad: seguridad) else { return }
        await saltar(a: objetivo)
        if !quiereReproducir {
            quiereReproducir = true
        }
        motor.reproducir()
        medirDirecto()
    }

    /// Retrocede 30 s (sin salirse de la ventana del directo).
    public func retroceder() async {
        guard conexion == .activa else { return }
        let actual = motor.tiempoActual
        let inicio = motor.ventana?.inicio ?? 0
        await saltar(a: max(inicio + 0.5, actual - UmbralesReproductor.retrocesoS))
        medirDirecto()
    }

    /// Canal siguiente o anterior de la lista (pantalla de bloqueo, Centro de Control).
    public func cambiarCanal(_ paso: Int) {
        guard let canal, !lista.isEmpty else { return }
        let indice = lista.firstIndex { $0.id == canal.id } ?? -1
        let siguiente = ((indice + paso) % lista.count + lista.count) % lista.count
        let destino = lista[siguiente]
        guard destino.id != canal.id else { return }
        reproducir(destino, origen: .usuario)
    }

    /// Cambia el modo: solo toca el colchón y la distancia al directo, no reconecta.
    public func cambiarModo(_ nuevo: PlaybackMode) {
        guard nuevo != modo else { return }
        modo = nuevo
        preferencias?.set(nuevo.rawValue, forKey: Self.claveModo)
        motor.aplicar(perfil: nuevo.perfilIOS)
    }

    // MARK: Conexión

    private func reintentarDesdeCero(_ canal: CanalReproducible) {
        let origen = fuente?.origen ?? .usuario
        fuente = nil
        sesion = nil
        sesionId = nil
        reproducir(canal, origen: origen)
    }

    private func conectar(recuperacion: Bool) {
        guard let fuente else { return }
        generacion += 1
        let gen = generacion
        estadoConexion = EstadoConexion(generacion: gen, ticsGracia: recuperacion ? UmbralesReproductor.graciaTics : 0)
        let canal = fuente.canal
        let modo = self.modo
        let visor = self.visor
        let servicio = self.servicio
        tareaConexion?.cancel()
        tareaConexion = Task {
            do {
                if recuperacion { await servicio.olvidarServidor() }
                let concesion = try await servicio.pedirStream(canal: canal, modo: modo, visor: visor)
                self.concedida(concesion, generacion: gen)
            } catch {
                self.falloAlPedir(APIError.desde(error), generacion: gen)
            }
        }
    }

    private func concedida(_ concesion: Concesion, generacion gen: Int) {
        guard gen == generacion, fuente != nil, conexion == .pidiendo || conexion == .conectando else {
            // Respuesta de una conexión vieja: si nadie usa esa sesión, se suelta.
            if sesion?.id != concesion.grant.session.id {
                let servicio = self.servicio
                let visor = self.visor
                let id = concesion.grant.session.id
                Task { await servicio.soltar(sesion: id, visor: visor, motivo: .channelChange) }
            }
            return
        }
        sesion = Sesion(
            id: concesion.grant.session.id, url: concesion.url, protocolo: concesion.grant.protocol,
            latidoMs: max(5000, concesion.grant.session.heartbeatMs))
        sesionId = concesion.grant.session.id
        if conexion == .pidiendo { transicion(.concedida) }
        let perfil = concesion.grant.latency.ios ?? modo.perfilIOS
        motor.cargar(url: concesion.url, perfil: perfil)
        if quiereReproducir { motor.reproducir() }
        arrancarLatido()
    }

    private func falloAlPedir(_ error: APIError, generacion gen: Int) {
        guard gen == generacion, fuente != nil else { return }
        switch error {
        case .cancelado:
            return
        case .necesitaEmparejar:
            fallarSistema("Este dispositivo ya no tiene acceso al reproductor.", motivo: .sinAcceso)
        case .servidor(let codigo, _, _, _) where Self.codigosSinReintento.contains(codigo):
            fallar(error.mensaje, reintentable: false, codigo: codigo)
        default:
            fallar(error.mensaje, codigo: error.codigo)
        }
    }

    /// Errores que no se arreglan reintentando la misma fuente.
    static let codigosSinReintento: Set<String> = [
        "invalid_hash", "invalid_id", "device_revoked", "origin_forbidden", "not_found", "channel_not_found",
        "unsupported_codec",
    ]

    // MARK: Eventos del motor

    private func alEventoMotor(_ evento: EventoMotor) {
        guard fuente != nil else { return }
        switch evento {
        case .listo:
            if conexion == .conectando { transicion(.colchonListo) }
            if quiereReproducir { motor.reproducir() }
        case .primerFotograma:
            if conexion == .conectando { transicion(.colchonListo) }
            if conexion == .arrancando, transicion(.primerFotograma) { alArrancar() }
        case .estado(let estado):
            alCambiarEstado(estado)
        case .atasco:
            fuente?.rebuffers += 1
        case .fallo(let detalle):
            registro.info("Fallo del vídeo: \(detalle, privacy: .public)")
            fallar("La señal se ha cortado: reconectando", detalle: detalle)
        }
    }

    private func alArrancar() {
        guard var f = fuente else { return }
        let ahora = reloj()
        if f.empezoEn == nil {
            f.empezoEn = ahora
            f.ttffMs = ahora.timeIntervalSince(f.pedidaEn) * 1000
        }
        fuente = f
        primeraImagenMs = f.ttffMs
        arranco = true
        intento = nil
        mensaje = nil
        medio = motor.estadoTiempo == .reproduciendo ? .reproduciendo : .buffer
        estadoConexion?.ticsGracia = UmbralesReproductor.graciaTics
        estadoConexion?.ultimaPosicion = motor.tiempoActual
        enviarResultado(.arranco, segundos: 0)
        // Un Content ID pegado a mano no entra en recientes (inventario §5).
        if f.canal.origen != "manual" {
            let servicio = self.servicio
            let canal = f.canal
            Task { await servicio.guardarReciente(canal) }
        }
        medirDirecto()
        sistema?.cambio(self)
    }

    private func alCambiarEstado(_ estado: EstadoTiempo) {
        switch estado {
        case .reproduciendo:
            tareaPausaAjena?.cancel()
            // P1: un play desde fuera (PiP, pantalla de bloqueo) restaura la intención.
            if !quiereReproducir { quiereReproducir = true }
            if conexion == .activa { medio = .reproduciendo }
        case .esperando:
            if conexion == .activa { medio = .buffer }
        case .pausado:
            if pausasPropias > 0 {
                pausasPropias -= 1
                if conexion == .activa { medio = .pausado }
            } else if quiereReproducir && conexion == .activa {
                confirmarPausaAjena()
            } else if conexion == .activa {
                medio = .pausado
            }
        }
        sistema?.cambio(self)
    }

    /// Una pausa que no hemos pedido (botón del PiP, auriculares, llamada) se
    /// toma como decisión de quien mira si dura; un corte de red también pausa
    /// AVPlayer, pero llega su fallo antes de confirmarla.
    private func confirmarPausaAjena() {
        tareaPausaAjena?.cancel()
        let gen = generacion
        let esperar = self.esperar
        tareaPausaAjena = Task {
            try? await esperar(UmbralesReproductor.confirmarPausaAjena)
            guard !Task.isCancelled, gen == self.generacion, self.conexion == .activa,
                self.motor.estadoTiempo == .pausado
            else { return }
            self.quiereReproducir = false
            self.medio = .pausado
            self.sistema?.cambio(self)
        }
    }

    /// La sesión de audio se interrumpió (llamada, Siri) o se desconectaron los auriculares.
    public func pausaDelSistema() {
        guard canal != nil else { return }
        pausar()
    }

    /// Terminó la interrupción y el sistema dice que se puede seguir.
    public func finDeInterrupcion(reanudar: Bool) {
        guard reanudar, canal != nil, conexion == .activa else { return }
        self.reanudar()
    }

    // MARK: Vigilante

    private func arrancarVigilante() {
        guard automatico, tareaVigilante == nil else { return }
        tareaVigilante = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(UmbralesReproductor.tic))
                guard let self, !Task.isCancelled else { return }
                self.tic()
            }
        }
    }

    /// Un tic del vigilante (cada 1,5 s).
    public func tic() {
        guard fuente != nil, var c = estadoConexion, c.generacion == generacion else { return }
        switch conexion {
        case .conectando, .precarga, .arrancando:
            c.ticsConexion += 1
            estadoConexion = c
            if c.ticsConexion >= UmbralesReproductor.limiteConexionTics {
                fallar("Sin señal suficiente: reintentando")
            }
            return
        case .activa:
            break
        default:
            return
        }
        medirDirecto()
        let t = motor.tiempoActual
        if !quiereReproducir {
            c.ticsParado = 0
            c.ultimaPosicion = t
            estadoConexion = c
            return
        }
        if c.ticsGracia > 0 {
            c.ticsGracia -= 1
            c.ultimaPosicion = t
            estadoConexion = c
            return
        }
        if abs(t - c.ultimaPosicion) > UmbralesReproductor.avanceMinimoS {
            c.ticsParado = 0
            c.ultimaPosicion = t
            estadoConexion = c
            talVezSigue()
            return
        }
        c.ticsParado += 1
        estadoConexion = c
        if c.ticsParado == UmbralesReproductor.empujonDirectoTics { empujarAlDirecto() }
        if c.ticsParado >= UmbralesReproductor.reconexionCongeladoTics {
            fallar("La imagen se ha quedado parada: reconectando")
        }
    }

    /// Imagen parada con vídeo por delante: saltar al directo en vez de reiniciar.
    /// «Vídeo disponible» es cualquiera de las tres: el directo va 6 s o más por
    /// delante, hay 2 s ya descargados por delante del cabezal o AVPlayer dice
    /// que puede seguir (`isPlaybackLikelyToKeepUp`) y aun así no avanza.
    private func empujarAlDirecto() {
        guard let ventana = motor.ventana else { return }
        let seguridad = Directo.colchonSeguridad(modo: modo, duracionVentana: ventana.duracion)
        guard let objetivo = Directo.objetivo(ventana: ventana, seguridad: seguridad) else { return }
        let retraso = objetivo - motor.tiempoActual
        let porDelante = motor.colchonPorDelante
        guard
            retraso >= UmbralesReproductor.empujonMinRetrasoS || porDelante >= UmbralesReproductor.videoDisponibleS
                || motor.probableSinCortes
        else { return }
        registro.info("Imagen parada con \(retraso, format: .fixed(precision: 1)) s por delante: salto al directo")
        saltosAlDirecto += 1
        Task {
            await self.saltar(a: objetivo)
            self.motor.reproducir()
        }
    }

    private func saltar(a segundos: Double) async {
        let anterior = medio
        if conexion == .activa { medio = .buscando }
        _ = await motor.saltar(a: segundos)
        if medio == .buscando {
            switch motor.estadoTiempo {
            case .reproduciendo: medio = .reproduciendo
            case .esperando: medio = .buffer
            case .pausado: medio = anterior == .buscando ? .pausado : anterior
            }
        }
    }

    private func medirDirecto() {
        let nuevo = InfoDirecto.medir(ventana: motor.ventana, actual: motor.tiempoActual, modo: modo)
        // Solo se publica si cambia de verdad (medio segundo o el estado).
        if nuevo.disponible != directo.disponible || nuevo.enDirecto != directo.enDirecto
            || abs(nuevo.recuperable - directo.recuperable) >= 0.5 || abs(nuevo.retraso - directo.retraso) >= 0.5
        {
            directo = nuevo
        }
    }

    /// El vigilante lo llama mientras el vídeo avanza: «sigue» cada 2 min.
    private func talVezSigue() {
        guard var f = fuente, f.empezoEn != nil else { return }
        let ahora = reloj()
        guard ahora.timeIntervalSince(f.ultimoSigue) >= UmbralesReproductor.sigueCada else { return }
        f.ultimoSigue = ahora
        fuente = f
        let cuerpo = OutcomeBody(id: f.canal.id, resultado: .sigue)
        let servicio = self.servicio
        Task { await servicio.resultado(cuerpo) }
    }

    // MARK: Fallos y reconexión

    /// La conexión se ha roto: reconecta tras la espera exponencial o, sin
    /// presupuesto, da la fuente por perdida.
    public func fallar(
        _ motivo: String, reintentable: Bool = true, codigo: String? = nil, detalle: String? = nil
    ) {
        guard var f = fuente, conexion != .idle, conexion != .error, conexion != .reconectando else { return }
        terminarConexion()
        let ahora = reloj()
        f.reconexiones = f.reconexiones.filter { ahora.timeIntervalSince($0) < UmbralesReproductor.ventanaReconexion }
        let maximo =
            (f.origen == .automatico && f.empezoEn == nil)
            ? PoliticaReconexion.maxIntentosArranqueAutomatico : PoliticaReconexion.maxIntentos
        if !reintentable || f.reconexiones.count >= maximo {
            fuente = f
            agotar(motivo, codigo: codigo)
            return
        }
        f.reconexiones.append(ahora)
        f.reconexionesTotales += 1
        fuente = f
        reconexiones = f.reconexionesTotales
        let n = f.reconexiones.count
        transicion(.fallo)
        medio = .idle
        intento = IntentoReconexion(n: n, max: maximo)
        mensaje = "\(motivo) (\(n)/\(maximo))…"
        let clave = f.clave
        let esperar = self.esperar
        tareaReconexion?.cancel()
        tareaReconexion = Task {
            try? await esperar(PoliticaReconexion.espera(intento: n))
            guard !Task.isCancelled, self.fuente?.clave == clave, self.conexion == .reconectando else { return }
            self.transicion(.reintentar)
            self.conectar(recuperacion: true)
        }
        sistema?.cambio(self)
    }

    /// Reconexiones agotadas: la fuente se da por perdida y se pregunta por la siguiente.
    private func agotar(_ motivo: String, codigo: String?) {
        guard let f = fuente else { return }
        let segundos = f.empezoEn.map { Int(reloj().timeIntervalSince($0).rounded()) } ?? 0
        let resultado: OutcomeResult = f.empezoEn != nil ? .cayo : .fallo
        enviarResultado(resultado, segundos: segundos)
        informar(.source, codigo: codigo ?? "player_source_failed", mensaje: motivo)
        soltarSesion(.error)
        terminarConexion()
        transicion(.agotado)
        medio = .idle
        errores += 1
        let aviso = FalloFuente(canal: f.canal, origen: f.origen, resultado: resultado, segundos: segundos, motivo: motivo)
        let cambiada = alFallarFuente?(aviso) ?? false
        if cambiada { cambiosAutomaticos += 1 }
        if fuente?.clave != f.clave {
            // Quien escucha ya ha puesto otra fuente a sonar.
            mensaje = "Esta fuente no responde: probando la siguiente…"
            return
        }
        intento = nil
        motivoParada = .fallo
        mensaje = cambiada ? "Esta fuente no responde: probando la siguiente…" : "Esta fuente no responde. Prueba con otra."
        sistema?.cambio(self)
    }

    /// Un fallo que no se arregla reintentando (sin acceso, revocado).
    private func fallarSistema(_ texto: String, motivo: MotivoParada) {
        soltarSesion(.error)
        terminarConexion()
        if conexion != .error { transicion(.agotado) }
        if conexion != .error { conexion = .error }
        medio = .idle
        intento = nil
        errores += 1
        motivoParada = motivo
        mensaje = texto
        sistema?.cambio(self)
    }

    // MARK: Sesión del backend

    private func arrancarLatido() {
        tareaLatido?.cancel()
        guard automatico, let s = sesion else { return }
        let id = s.id
        let intervalo = TimeInterval(s.latidoMs) / 1000
        tareaLatido = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(intervalo))
                guard let self, !Task.isCancelled, self.sesion?.id == id else { return }
                await self.latir()
            }
        }
    }

    /// Un latido: mantiene la sesión y descubre cambios de URL o que se ha perdido.
    public func latir() async {
        guard let s = sesion else { return }
        do {
            let recibido = try await servicio.latido(
                sesion: s.id, visor: visor, reproduciendo: medio == .reproduciendo)
            guard sesion?.id == s.id else { return }
            // La URL firmada cambia en cada latido (`?t=`): solo cuenta la ruta.
            if recibido.url.path() != s.url.path() || recibido.respuesta.protocol != s.protocolo {
                sesion?.url = recibido.url
                sesion?.protocolo = recibido.respuesta.protocol
                reenganchar("La señal ha cambiado de ruta: reenganchando…")
            }
        } catch {
            guard sesion?.id == s.id else { return }
            let codigo = APIError.desde(error).codigo
            if codigo == "session_expired" || codigo == "session_not_found" {
                await sesionPerdida(s.id)
            }
        }
    }

    /// El backend ya no nos tiene: ¿otro dispositivo se ha quedado el mando o caducó?
    private func sesionPerdida(_ id: String) async {
        guard sesion?.id == id, let f = fuente else { return }
        olvidarSesion()
        var otroDispositivo = false
        if let estado = try? await servicio.estadoReproduccion(), let ahora = estado.nowPlaying {
            let otroEquipo = dispositivoId.map { ahora.dev != $0 } ?? false
            otroDispositivo = otroEquipo || ahora.id != f.canal.id
        }
        guard fuente?.clave == f.clave else { return }
        if otroDispositivo {
            traspaso()
        } else {
            fallar("La sesión había caducado: reconectando")
        }
    }

    /// Otro dispositivo se ha quedado el mando (D5): se para sin soltar.
    private func traspaso() {
        olvidarSesion()
        terminarConexion()
        transicion(.traspaso)
        medio = .idle
        intento = nil
        quiereReproducir = false
        motivoParada = .traspaso
        mensaje = "La reproducción ha pasado a otro dispositivo"
        sistema?.cambio(self)
    }

    /// Cambio de URL sin contar como fallo (motor reiniciado, remux rehecho…).
    private func reenganchar(_ aviso: String) {
        guard fuente != nil, transicion(.reenganche) else { return }
        mensaje = aviso
        medio = .idle
        motor.vaciar()
        // Se pide otra vez la URL (unirse a la sesión es inmediato si sigue viva)
        // para que llegue firmada y con el remux ya listo.
        conectar(recuperacion: false)
    }

    private func soltarSesion(_ motivo: ReleaseReason) {
        guard let s = sesion else { return }
        olvidarSesion()
        let servicio = self.servicio
        let visor = self.visor
        Task { await servicio.soltar(sesion: s.id, visor: visor, motivo: motivo) }
    }

    private func olvidarSesion() {
        sesion = nil
        sesionId = nil
        tareaLatido?.cancel()
        tareaLatido = nil
    }

    // MARK: Eventos del backend (SSE)

    private func esNuestro(sesion id: String?, visores: [String]) -> Bool {
        guard let s = sesion else { return false }
        if let id, id != s.id { return false }
        return visores.isEmpty || visores.contains(visor)
    }

    public func procesar(_ evento: SSEEvent) {
        guard fuente != nil else { return }
        switch evento {
        case .playbackHandoff(let datos):
            let mio = datos.viewerIds.contains(visor) || (datos.sessionId != nil && datos.sessionId == sesion?.id)
            if mio && conexion.enMarcha { traspaso() }
        case .streamReopened(let datos):
            guard esNuestro(sesion: datos.sessionId, visores: datos.viewerIds) else { return }
            reenganchar(
                datos.reason == .remuxRestart
                    ? "La conversión para iPhone se ha reiniciado: reenganchando…"
                    : "El motor se ha reiniciado: reenganchando la señal…")
        case .streamModeChanged(let datos):
            // El remux de iOS sigue leyendo la sesión: si se rehace, llega `stream.reopened`.
            guard esNuestro(sesion: datos.sessionId, visores: datos.viewerIds),
                sesion?.protocolo != .hlsFmp4, datos.to != sesion?.protocolo
            else { return }
            reenganchar(
                datos.reason == .shared
                    ? "Otro dispositivo se ha unido: pasando a HLS…"
                    : "Vuelves a estar solo: recuperando la señal directa…")
        case .streamClosed(let datos):
            guard esNuestro(sesion: datos.sessionId, visores: datos.viewerIds) else { return }
            switch datos.reason {
            case .released, .handoff:
                return
            case .revoked:
                olvidarSesion()
                fallarSistema("Este dispositivo ya no tiene acceso al reproductor.", motivo: .sinAcceso)
            case .expired:
                olvidarSesion()
                fallar("La sesión había caducado: reconectando")
            default:
                olvidarSesion()
                fallar("La señal se ha cortado: reconectando", detalle: datos.code ?? datos.reason.rawValue)
            }
        case .streamStats(let datos):
            if esNuestro(sesion: datos.sessionId, visores: datos.viewerIds) { estadisticas = datos }
        case .engineStatus(let estado):
            // Motor de vuelta con la fuente dada por perdida por culpa suya: se recupera sola.
            if estado.online, conexion == .error, motivoParada == .fallo, let canal {
                reintentarDesdeCero(canal)
            }
        default:
            break
        }
    }

    // MARK: Primer plano

    /// Al volver a primer plano: comprobar la señal y recuperarla si se había perdido.
    public func volvioAPrimerPlano() {
        guard fuente != nil else { return }
        switch conexion {
        case .activa:
            estadoConexion?.ticsParado = 0
            estadoConexion?.ticsGracia = UmbralesReproductor.graciaTics
            estadoConexion?.ultimaPosicion = motor.tiempoActual
            Task { await self.latir() }
            guard quiereReproducir else { return }
            if motor.estadoTiempo == .pausado { motor.reproducir() }
            medirDirecto()
            // En segundo plano la señal siguió: si nos quedamos muy atrás, al directo.
            if directo.disponible, directo.recuperable >= UmbralesReproductor.empujonMinRetrasoS {
                Task { await self.irAlDirecto() }
            }
        case .error where motivoParada == .fallo:
            break
        default:
            break
        }
    }

    // MARK: Final de una fuente

    private func terminarConexion() {
        tareaConexion?.cancel()
        tareaConexion = nil
        tareaReconexion?.cancel()
        tareaReconexion = nil
        tareaPausaAjena?.cancel()
        tareaPausaAjena = nil
        generacion += 1
        estadoConexion = nil
        motor.vaciar()
    }

    private func terminarFuente(motivo: ReleaseReason, porque: String) {
        if let f = fuente, !f.metricasEnviadas, f.empezoEn != nil || f.reconexionesTotales > 0 {
            fuente?.metricasEnviadas = true
            informar(.client, codigo: "player_session", mensaje: "Fin de la reproducción (\(porque))")
        }
        soltarSesion(motivo)
        terminarConexion()
        fuente = nil
    }

    // MARK: Resultados y diagnóstico

    private func enviarResultado(_ resultado: OutcomeResult, segundos: Int) {
        guard var f = fuente else { return }
        if resultado == .arranco {
            if f.arrancoEnviado { return }
            f.arrancoEnviado = true
            fuente = f
        }
        // Un `cayo` sin `arranco` antes no tiene sentido.
        if resultado == .cayo && !f.arrancoEnviado { return }
        let cuerpo = OutcomeBody(
            id: f.canal.id, resultado: resultado, segundos: resultado == .arranco ? nil : Double(segundos),
            title: f.canal.titulo, listaId: f.canal.listaId, source: f.canal.origen)
        let servicio = self.servicio
        Task { await servicio.resultado(cuerpo) }
    }

    private func informar(_ causa: DiagnosticCause, codigo: String, mensaje: String) {
        guard let f = fuente else { return }
        let metricas = PlayerMetrics(
            timeToFirstFrameMs: f.ttffMs, rebuffers: f.rebuffers, reconnects: f.reconexionesTotales,
            liveLatencyS: directo.disponible ? directo.retraso : nil)
        let cuerpo = DiagnosticReportBody(
            cause: causa, code: codigo, message: String(mensaje.prefix(500)), hash: f.canal.id,
            channel: f.canal.partido?.canal ?? f.canal.titulo, sessionId: sesion?.id, metrics: metricas)
        let servicio = self.servicio
        Task { await servicio.informar(cuerpo) }
    }

    // MARK: Máquina

    @discardableResult
    private func transicion(_ evento: EventoConexion) -> Bool {
        guard let nueva = MaquinaConexion.siguiente(conexion, evento) else {
            registro.debug("Transición ignorada: \(self.conexion.rawValue, privacy: .public) + \(evento.rawValue, privacy: .public)")
            return false
        }
        conexion = nueva
        return true
    }
}

/// Pantalla de bloqueo, Centro de Control y sesión de audio.
@MainActor
public protocol ControlesDelSistema: AnyObject {
    func empezo(_ canal: CanalReproducible)
    func cambio(_ reproductor: Reproductor)
    func termino()
}
