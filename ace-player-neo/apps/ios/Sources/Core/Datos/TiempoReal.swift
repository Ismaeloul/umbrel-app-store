import Foundation
import Observation

/* Tiempo real (b-arquitectura §2.5.3, I0→M1; a7 §6, apps/web/src/api/sse.ts): el SSE con sus estados,
   el Last-Event-ID de proceso y el respaldo si a los 10 s no abre.
   - `inactivo → conectando → abierto`; `respaldo` si en 10 s no ha abierto (el repartidor sondea);
     `demo` con -AceNeoDemo (sin SSE: las reglas «sin SSE» de la web).
   - Reconecta solo (`SSEClient`, esperas 3·2ⁿ con tope 60 s) reanudando desde el último id: si ya no
     está en el búfer del servidor, llega `resync`.
   - Al abrir tras un corte (venía de `respaldo` o de reintentos) avisa con `alAbrirTrasCorte`.
   - En segundo plano sin nada sonando se corta (a7 §14.2); al volver, `reconectarYa()` con el mismo id. */

enum EstadoTiempoReal: Sendable { case inactivo, conectando, abierto, respaldo, demo }

@MainActor @Observable final class TiempoReal {
    private(set) var estado: EstadoTiempoReal = .inactivo
    @ObservationIgnored private(set) var ultimoId: String?
    @ObservationIgnored var alEvento: ((SSEEvent) -> Void)?
    @ObservationIgnored var alAbrirTrasCorte: (() -> Void)?  // invalida playbackStatus y engineStatus
    @ObservationIgnored var alPerderAcceso: (() -> Void)?

    /// Cada cambio de estado (el repartidor lleva el sondeo de respaldo y `datos.tiempoRealAbierto`).
    @ObservationIgnored var alCambiarEstado: ((EstadoTiempoReal) -> Void)?
    /// La dirección por la que ha abierto (la sesión la enseña como conexión).
    @ObservationIgnored var alConectar: ((ActiveServer) -> Void)?
    /// El código del 401 que cortó la conexión (`unauthorized` o `device_revoked`).
    @ObservationIgnored private(set) var codigoAccesoPerdido: String?
    /// `SSE_FALLBACK_AFTER_MS` (api/sse.ts). Los tests lo acortan.
    @ObservationIgnored var plazoRespaldo: Duration = .seconds(EsperaSSE.respaldoTras)

    private let cliente: SSEClient
    private let esDemo: Bool
    @ObservationIgnored private var conexion: Task<Void, Never>?
    @ObservationIgnored private var relojRespaldo: Task<Void, Never>?
    @ObservationIgnored private var intentos = 0
    @ObservationIgnored private var generacion = 0
    /// Se pidió arrancar y nadie lo ha parado (el segundo plano solo lo pausa).
    @ObservationIgnored private var quiereConexion = false

    init(cliente: SSEClient, esDemo: Bool) {
        self.cliente = cliente
        self.esDemo = esDemo
        if esDemo { estado = .demo }
    }

    var abierto: Bool { estado == .abierto }

    /// Arranca (10 s sin abrir → `.respaldo`). En demo se queda en `.demo`.
    func arrancar() {
        guard !esDemo else { return }
        quiereConexion = true
        codigoAccesoPerdido = nil
        guard conexion == nil else { return }
        conectar()
    }

    /// Para del todo (acceso perdido, olvidar este iPhone). El último id se olvida.
    func parar() {
        quiereConexion = false
        cortar()
        ultimoId = nil
        if !esDemo { cambiar(a: .inactivo) }
    }

    /// Vuelta a primer plano: si no está abierto, reconecta ya con el último id (`visibilitychange`).
    func reconectarYa() {
        guard !esDemo, quiereConexion else { return }
        guard estado != .abierto || conexion == nil else { return }
        conectar()
    }

    /// Cambio de red (VigiaRed): la conexión puede estar muerta aunque parezca abierta; se rehace ya.
    func renovar() {
        guard !esDemo, quiereConexion else { return }
        conectar()
    }

    /// Sin nada sonando se corta hasta volver; sonando (audio, PiP, AirPlay) sigue mientras iOS deje.
    func pasoASegundoPlano(suena: Bool) {
        guard !esDemo, !suena, quiereConexion else { return }
        cortar()
        cambiar(a: .inactivo)
    }

    // MARK: Conexión

    private func conectar() {
        cortar()
        let miGeneracion = generacion
        if estado != .respaldo { cambiar(a: .conectando) }
        armarRespaldo()
        let flujo = cliente.conectar(desde: ultimoId)
        conexion = Task { [weak self] in
            for await cambio in flujo {
                guard let self, self.generacion == miGeneracion else { return }
                self.recibir(cambio)
            }
        }
    }

    private func cortar() {
        generacion += 1
        conexion?.cancel()
        conexion = nil
        relojRespaldo?.cancel()
        relojRespaldo = nil
    }

    /// Lo que va pasando en `SSEClient` (onopen, onmessage, onerror de api/sse.ts).
    func recibir(_ cambio: SSEUpdate) {
        switch cambio {
        case .conectado(let servidor):
            let veniaDeCorte = estado == .respaldo || intentos > 0
            relojRespaldo?.cancel()
            relojRespaldo = nil
            intentos = 0
            cambiar(a: .abierto)
            alConectar?(servidor)
            if veniaDeCorte { alAbrirTrasCorte?() }
        case .evento(let sobre):
            if let id = sobre.id, !id.isEmpty { ultimoId = id }
            alEvento?(sobre.event)
        case .desconectado:
            intentos += 1
            if estado != .respaldo { cambiar(a: .conectando) }
            armarRespaldo()
        case .necesitaEmparejar(let codigo):
            codigoAccesoPerdido = codigo
            quiereConexion = false
            cortar()
            cambiar(a: .inactivo)
            alPerderAcceso?()
        }
    }

    private func armarRespaldo() {
        guard relojRespaldo == nil, estado != .respaldo else { return }
        let plazo = plazoRespaldo
        let miGeneracion = generacion
        relojRespaldo = Task { [weak self] in
            try? await Task.sleep(for: plazo)
            guard !Task.isCancelled, let self, self.generacion == miGeneracion else { return }
            self.relojRespaldo = nil
            if self.estado != .abierto { self.cambiar(a: .respaldo) }
        }
    }

    private func cambiar(a nuevo: EstadoTiempoReal) {
        guard estado != nuevo else { return }
        estado = nuevo
        alCambiarEstado?(nuevo)
    }
}
