import Foundation
import Observation

// Rescatado en la poda (fase 0.2, b-arquitectura §1.11) de `BuscarModelo` (Features/Search/BuscarView.swift),
// sin cambiar el comportamiento. M5 lo completa (fases, anuncios; a5 §4) y lo pasa a DatosApp.

/// Búsqueda en el motor AceStream (`GET search?q=`): con espera de 450 ms
/// mientras se escribe y cancelando la anterior.
@MainActor
@Observable
final class ModeloBuscar {
    private(set) var resultados: [SearchResult] = []
    private(set) var buscando = false
    private(set) var fallo: String?
    private(set) var buscado = ""

    private let entorno: Entorno

    init(entorno: Entorno) {
        self.entorno = entorno
    }

    /// Busca `texto` (vacío = limpia). Pensado para `.task(id:)`, que cancela la anterior.
    func buscar(_ texto: String, esperar: Bool = true) async {
        let consulta = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        guard consulta.count >= 2, ReglasFuentes.hashValido(consulta) == nil else {
            resultados = []
            fallo = nil
            buscado = ""
            buscando = false
            return
        }
        if esperar {
            try? await Task.sleep(for: .milliseconds(450))  // a5 §4 (espera de 450 ms)
            if Task.isCancelled { return }
        }
        buscando = true
        defer { buscando = false }
        do {
            let respuesta = try await entorno.api.enviar(API.buscar(consulta))
            guard !Task.isCancelled else { return }
            resultados = respuesta.results
            buscado = consulta
            fallo = nil
        } catch {
            let convertido = APIError.desde(error)
            if case .cancelado = convertido { return }
            fallo = convertido.mensaje
        }
    }
}
