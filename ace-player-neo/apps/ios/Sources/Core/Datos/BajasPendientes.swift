import Foundation
import Observation

/* «Deshacer» de 6 s de la biblioteca, con el envío en segundo plano (b-arquitectura §2.5.5, M1). ESQUELETO de I0 (fase 0.3b) con la firma del contrato para que
   `ContenedorApp` compile; M1 escribe la lógica y sus pruebas. */

@MainActor @Observable final class BajasPendientes {
    private var pendientes: Set<String> = []

    func quitar(_ canal: RefCanal, datos: DatosApp, avisos: Avisos) {}
    func pendiente(_ hash: String) -> Bool { pendientes.contains(hash) }
}
