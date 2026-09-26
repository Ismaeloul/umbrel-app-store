import Foundation

/// Sigue un trabajo del comprobador (`watchJob` de features/sources/session.ts): con el SSE abierto, cada
/// `scan.progress` de ese trabajo pide el estado entero (y `scan.verdict` cambia la fuente al momento); sin SSE
/// (respaldo o demo) se consulta cada 1,5 s. Nunca las dos cosas. Al volver el SSE se pide una vez (se pudo
/// perder algún evento). Nunca dos peticiones a la vez: si llega otra, se encadena una.
@MainActor
final class SeguimientoTrabajo {
    let id: String
    var alTrabajo: (ScanJob) -> Void = { _ in }
    var alError: () -> Void = {}
    var alVeredicto: ((ScanVerdictData) -> Void)?

    private let pedir: @MainActor () async throws -> ScanJob
    private let sseAbierto: @MainActor () -> Bool
    private let intervalo: Duration
    private var parado = false
    private var ocupado = false
    private var otraVez = false
    private var estabaAbierto = false
    private var sondeo: Task<Void, Never>?

    init(
        id: String, intervalo: Duration, pedir: @escaping @MainActor () async throws -> ScanJob,
        sseAbierto: @escaping @MainActor () -> Bool
    ) {
        self.id = id
        self.intervalo = intervalo
        self.pedir = pedir
        self.sseAbierto = sseAbierto
    }

    func empezar() {
        estabaAbierto = sseAbierto()
        pedirYa()
        sondeo = Task { [weak self] in
            while !Task.isCancelled {
                guard let intervalo = self?.intervalo else { return }
                try? await Task.sleep(for: intervalo)
                guard let self, !Task.isCancelled, !self.parado else { return }
                self.alTic()
            }
        }
    }

    func parar() {
        parado = true
        sondeo?.cancel()
        sondeo = nil
    }

    /// Los eventos del SSE que tocan a este trabajo.
    func procesar(_ evento: SSEEvent) {
        guard !parado else { return }
        switch evento {
        case .scanProgress(let datos) where datos.jobId == id:
            pedirYa()
        case .scanVerdict(let datos) where datos.jobId == id:
            alVeredicto?(datos)
            pedirYa()
        default:
            break
        }
    }

    private func alTic() {
        let abierto = sseAbierto()
        if !abierto || !estabaAbierto { pedirYa() }
        estabaAbierto = abierto
    }

    private func pedirYa() {
        guard !parado else { return }
        if ocupado {
            otraVez = true
            return
        }
        ocupado = true
        Task {
            do {
                let trabajo = try await pedir()
                if !parado { alTrabajo(trabajo) }
            } catch {
                if !parado, !esCancelacion(error) { alError() }
            }
            ocupado = false
            if otraVez && !parado {
                otraVez = false
                pedirYa()
            }
        }
    }

    private func esCancelacion(_ error: any Error) -> Bool {
        if case .cancelado = APIError.desde(error) { return true }
        return false
    }
}

/// Un reporte cuyo trabajo se sigue (`followReport`): consultas hechas y la pausa hasta el reintento.
@MainActor
final class ReporteSeguido {
    let hash: String
    let motivo: SourceReportReason
    let trabajoId: String
    let generacion: Int
    var consultas = 0
    var seguimiento: SeguimientoTrabajo?
    var pausa: Task<Void, Never>?

    init(hash: String, motivo: SourceReportReason, trabajoId: String, generacion: Int) {
        self.hash = hash
        self.motivo = motivo
        self.trabajoId = trabajoId
        self.generacion = generacion
    }

    func parar() {
        seguimiento?.parar()
        seguimiento = nil
        pausa?.cancel()
        pausa = nil
    }
}
