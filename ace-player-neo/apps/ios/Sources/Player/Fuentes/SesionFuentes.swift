import Foundation
import Observation

/* La sesión de fuentes (b-arquitectura §2.6, I0→M3): sources/session.ts entero, UNA sola sesión de
   vida de proceso (partido o canal suelto) con su política de cambio de fuente y «Otras fuentes»
   (calcado de la web, §0.0 punto 1). Sustituye a `CentroPartidoModelo`.
   ESQUELETO de I0 (fase 0.3b): firmas exactas y cuerpos neutros. La lógica rescatada en la poda está
   en `SesionFuentesPartido` (misma carpeta) como referencia; M3 la porta aquí y la borra. */

/// Lo que la sesión de fuentes necesita de la app (lo conforma `ContenedorApp`; los tests pasan un doble).
@MainActor protocol EntornoSesionFuentes: AnyObject {
    var api: APIClient { get }
    var reproductor: Reproductor { get }
    var avisos: Avisos { get }
    var haptica: Haptica { get }
    var hojas: CentroHojas { get }
    var reloj: any Reloj { get }
    var visor: String { get }
    var tiempoRealAbierto: Bool { get }
    /// La biblioteca: hermanas del canal suelto, nombres de las listas y lo que devuelve Recientes (M3, aditivo).
    var datos: DatosApp { get }
}

enum FaseSesionFuentes: Sendable { case reposo, resolviendo, lista, opciones, noEncontrado, sinCanales }

@MainActor @Observable final class SesionFuentes {
    private(set) var clave: String?  // "partido:<id>" · "canal:<hash>"
    private(set) var fase: FaseSesionFuentes = .reposo
    private(set) var entradas: [EntradaFuente] = []
    private(set) var activa: String?
    private(set) var trabajo: ScanJob?
    private(set) var resolucion: Resolution?
    private(set) var automatico = true
    private(set) var eleccionManual = false
    private(set) var rebuscando = false
    private(set) var detenida = false
    private(set) var textoFallo: String?
    private(set) var textoEspera: String?
    private(set) var otrasSenales: [ResolutionCandidate] = []  // canal suelto (añadido de Isma)
    private(set) var buscandoOtras = false

    @ObservationIgnored private weak var entorno: (any EntornoSesionFuentes)?

    init() {}

    /// Dos fases: el contenedor se crea y luego se presenta (evita el ciclo en el init). Los tests pasan un doble.
    func conectar(_ entorno: any EntornoSesionFuentes) { self.entorno = entorno }

    func entrarPartido(_ partido: FootballMatch) async { clave = "partido:\(partido.id)" }
    func entrarCanal(_ canal: RefCanal, listaActiva: String?) async { clave = "canal:\(canal.hash)" }
    func salirVista() {}  // la vista se va; la política sigue viva mientras suene
    func elegir(_ hash: String) {  // manual: ya nunca salta sola
        automatico = false
        eleccionManual = true
        activa = hash
    }
    func paso(_ delta: Int) {}  // ‹ › de la barra «emitiendo»
    func pegar(_ texto: String) async throws {}
    func rebuscar() async {}
    func reportar(_ hash: String, motivo: SourceReportReason) async throws {}
    func confirmar(_ hash: String) async {}
    func elegirCandidata(_ candidata: ResolutionCandidate) async {}
    func vincularManual(_ hash: String) async throws {}
    func procesar(_ evento: SSEEvent) {}
    /// Reconexiones agotadas: `true` si ya ha puesto otra a sonar. Esqueleto: nunca.
    func alFallarFuente(_ fallo: FalloFuente) -> Bool { false }
    var visibles: [EntradaFuente] { entradas }
    var plegadas: [EntradaFuente] { [] }
}
