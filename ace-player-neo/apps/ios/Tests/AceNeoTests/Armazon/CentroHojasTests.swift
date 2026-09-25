import Foundation
import Testing

@testable import AceNeo

/* Hojas de la app (Armazon/Hojas.swift; b-arquitectura §2.4.2; a2 §9, a1 §8.1). M4. */

private let canal = RefCanal(hash: String(repeating: "b", count: 40), titulo: "DAZN 1", coleccion: nil, ih: nil)

@MainActor
struct CentroHojasTests {
    @Test func abrirSustituyeALaQueHaya() {
        let centro = CentroHojas()
        centro.abrir(.gustos)
        centro.abrir(.ayuda)  // la web nunca apila hojas
        #expect(centro.actual == .ayuda)
    }

    @Test func cerrarConBotonNoVibra() {
        let centro = CentroHojas()
        centro.abrir(.pegar(.libre))
        centro.cerrar()
        #expect(centro.actual == nil)
        #expect(centro.alDescartar() == false)  // ✕, «Cancelar» o fin de acción: sin háptica
    }

    @Test func cerrarArrastrandoVibra() {
        let centro = CentroHojas()
        centro.abrir(.renombrar(canal))
        centro.actual = nil  // lo que hace el sistema al arrastrar el asa
        #expect(centro.alDescartar() == true)  // a1 §8.1: «media» al cerrar arrastrando
    }

    @Test func cerrarSinHojaNoHaceNada() {
        let centro = CentroHojas()
        centro.cerrar()
        centro.abrir(.ayuda)
        centro.actual = nil
        #expect(centro.alDescartar() == true)  // el «cerrar» de antes no cuenta para esta hoja
    }

    @Test func tamanosDeLaWeb() {
        #expect(Hoja.gustos.tamano == .lg)  // PreferencesSheet size="lg"
        #expect(Hoja.pegar(.libre).tamano == .sm)  // PasteHashSheet
        #expect(Hoja.reportar(hash: "x", numero: 1).tamano == .sm)  // ReportSheet
        #expect(Hoja.encontrarCanal.tamano == .md)  // ResolverSheet
        #expect(Hoja.guardarFavorito(canal).tamano == .sm)  // useChannelActions
        #expect(Hoja.renombrar(canal).tamano == .sm)
        #expect(Hoja.ayuda.tamano == .md)  // ShortcutHelp
    }

    @Test func detents() {
        #expect(Hoja.gustos.detents == .grande)
        #expect(Hoja.ayuda.detents == .grande)
        #expect(Hoja.encontrarCanal.detents == .medioYGrande)
        #expect(Hoja.pegar(.partido(id: "demo-1")).detents == .medido)
        #expect(Hoja.renombrar(canal).detents == .medido)
    }

    @Test func identificadoresDistintos() {
        let hojas: [Hoja] = [
            .gustos, .pegar(.libre), .reportar(hash: "h", numero: 2), .encontrarCanal, .guardarFavorito(canal),
            .renombrar(canal), .ayuda,
        ]
        #expect(Set(hojas.map(\.id)).count == hojas.count)
    }
}
