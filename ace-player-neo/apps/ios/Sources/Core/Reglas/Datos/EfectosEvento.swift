import Foundation

/* Lo que provoca cada evento del tiempo real (b-arquitectura §2.1.4, contrato I0→M1; a7 §6.3-6.4).
   `RepartidorEventos` (Core/Datos) aplica los efectos; aquí solo se decide.
   ESQUELETO de la fase 0.3a (§2.0: cuerpos con valor neutro): M1 rellena `de(_:)` y `rutas(de:)` con
   las tablas de a7 §6.3 y §6.4 y las prueba en EfectosEventoTests. */

/// Lo que un evento SSE provoca (a7 §6.3-6.4).
enum EfectoEvento: Hashable, Sendable {
    case invalidar(Set<RutaConsulta>)
    case invalidarTodo  // resync
    case escribirMotor(EngineStatus)
    case escribirSonando(NowPlaying?, aprendidos: Int)
    case escribirSesiones([SessionSummary])
    case trabajo(jobId: String)  // invalida ese footballScan
    case senalPartido(ScanProgressData)  // almacén por matchId
    case veredicto(ScanVerdictData)  // sesión de fuentes
    case dispositivos(DevicesChangedData)  // emparejar / revocado desde otro
    case alReproductor(SSEEvent)  // dirigidos, filtrados por viewerIds
    case versionPosible  // tras resync: VigiaVersion hace ping
}

enum EfectosEvento {
    /// a7 §6.3. Esqueleto: ningún efecto hasta que M1 lo rellene.
    static func de(_ evento: SSEEvent) -> [EfectoEvento] { [] }

    /// `SCOPE_ROUTES` (a7 §6.4). Esqueleto: ninguna ruta hasta que M1 lo rellene.
    static func rutas(de ambito: StateScope) -> Set<RutaConsulta> { [] }
}
