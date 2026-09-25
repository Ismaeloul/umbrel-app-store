import Foundation
import Observation

/* Tiempo real (b-arquitectura §2.5.3, I0→M1; a7 §6): el SSE con sus estados, el Last-Event-ID de
   proceso y el respaldo por sondeo si a los 10 s no abre.
   ESQUELETO de I0 (fase 0.3b): en demo se queda en `.demo` y si no, en `.inactivo`; M1 lo conecta. */

enum EstadoTiempoReal: Sendable { case inactivo, conectando, abierto, respaldo, demo }

@MainActor @Observable final class TiempoReal {
    private(set) var estado: EstadoTiempoReal = .inactivo
    @ObservationIgnored private(set) var ultimoId: String?
    @ObservationIgnored var alEvento: ((SSEEvent) -> Void)?
    @ObservationIgnored var alAbrirTrasCorte: (() -> Void)?  // invalida playbackStatus y engineStatus
    @ObservationIgnored var alPerderAcceso: (() -> Void)?

    private let cliente: SSEClient
    private let esDemo: Bool

    init(cliente: SSEClient, esDemo: Bool) {
        self.cliente = cliente
        self.esDemo = esDemo
        if esDemo { estado = .demo }
    }

    var abierto: Bool { estado == .abierto }

    func arrancar() {}  // 10 s sin abrir → .respaldo
    func parar() {}
    func reconectarYa() {}  // cambio de red, vuelta a primer plano
    func pasoASegundoPlano(suena: Bool) {}
}
