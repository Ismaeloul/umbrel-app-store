import Foundation
import Testing

@testable import AceNeo

/* El botón de las plegadas (SourceList.tsx): ListaCarteles es una vista, así que esta prueba va con la app y no
   en el paquete de Linux (OtrasFuentesTests sí). */

@MainActor
struct PlegadasTests {
    private func fila(_ id: String, _ estado: ScanCandidateState) -> FilaFuente {
        let entrada = EntradaFuente(
            id: id, titulo: "DAZN --> \(id)", ih: false, origen: "m3u", canal: "DAZN", sonda: SondaFuente(estado: estado))
        return ReglasFuentes.filas(
            [entrada], pantalla: .nada, ahora: Date(timeIntervalSince1970: 0), activa: nil, listas: [],
            conComprobador: true)[0]
    }

    @Test func textoDelBotonComoSourceList() {
        let caida = fila("a", .failed)
        let enCola = fila("b", .queued)
        #expect(ListaCarteles.textoPlegadas([caida], abiertas: false) == "Ver 1 más sin señal")
        #expect(ListaCarteles.textoPlegadas([caida, enCola], abiertas: false) == "Ver 2 más (1 sin señal, 1 en cola)")
        #expect(ListaCarteles.textoPlegadas([enCola], abiertas: false) == "Ver 1 más en cola")
        #expect(ListaCarteles.textoPlegadas([caida], abiertas: true) == "Ocultar las que no dan señal")
    }
}
