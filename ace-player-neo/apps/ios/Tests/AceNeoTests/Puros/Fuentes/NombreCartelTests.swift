import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Los textos del cartel de fuente (Isma, 26-sep): el proveedor en la tesela y, debajo, el nombre del canal sin él.
   Los mismos casos que las pruebas de la función de la web (SourcePoster.tsx), más los bordes. */

struct NombreCartelTests {
    private func sin(_ titulo: String, _ proveedor: String) -> String {
        NombreCartel.sinProveedor(titulo, proveedores: [proveedor])
    }

    @Test func losCasosDeIsma() {
        #expect(sin("MOVISTAR PLUS FHD --> NEW ERA III", "NEW ERA III") == "MOVISTAR PLUS FHD")
        #expect(sin("DAZN 1 HD | ELCANO", "Elcano") == "DAZN 1 HD")
        #expect(sin("M+ LaLiga (NEW ERA)", "NEW ERA III") == "M+ LaLiga")
        #expect(sin("LaLiga TV [Elcano] 1080", "Elcano") == "LaLiga TV 1080")
    }

    @Test func lasVariantesDelProveedor() {
        #expect(sin("MOVISTAR PLUS FHD --> NEW ERA", "NEW ERA III") == "MOVISTAR PLUS FHD")
        #expect(sin("MOVISTAR PLUS FHD --> NEW ERA III", "NEW ERA") == "MOVISTAR PLUS FHD")
        #expect(sin("DAZN 2 (Elcano 2)", "Elcano") == "DAZN 2")
        #expect(sin("Eurosport 1 -> new era", "NEW ERA") == "Eurosport 1")
    }

    @Test func todosLosSeparadores() {
        #expect(sin("M+ Liga de Campeones => Elcano", "Elcano") == "M+ Liga de Campeones")
        #expect(sin("DAZN 1 → Faro", "Faro") == "DAZN 1")
        #expect(sin("DAZN 1 » Faro", "Faro") == "DAZN 1")
        #expect(sin("DAZN 1 - Faro", "Faro") == "DAZN 1")
        #expect(sin("DAZN 1 — Faro", "Faro") == "DAZN 1")
        #expect(sin("DAZN 1 – Faro", "Faro") == "DAZN 1")
        #expect(sin("Faro | DAZN 1", "Faro") == "DAZN 1")
        #expect(sin("Faro - DAZN 1", "Faro") == "DAZN 1")
        #expect(sin("DAZN 1 {Faro} HD", "Faro") == "DAZN 1 HD")
    }

    @Test func soloPalabrasEnteras() {
        #expect(sin("Elcanonico 1", "Elcano") == "Elcanonico 1")
        #expect(sin("LaLiga TV", "Elcano") == "LaLiga TV")
        #expect(sin("M+ LaLiga-TV", "Elcano") == "M+ LaLiga-TV")
    }

    @Test func sinNadaQueQuitarOSinQueQuedeNada() {
        #expect(sin("DAZN 1", "") == "DAZN 1")
        #expect(sin("NEW ERA", "NEW ERA") == "NEW ERA")
        #expect(sin("  NEW ERA III  ", "NEW ERA") == "NEW ERA III")
        #expect(sin("--> Elcano", "Elcano") == "--> Elcano")
    }

    @Test func laBaseSinNumeracion() {
        #expect(NombreCartel.base("NEW ERA III") == "NEW ERA")
        #expect(NombreCartel.base("Elcano 2") == "Elcano")
        #expect(NombreCartel.base("Elcano") == "Elcano")
        #expect(NombreCartel.base("III") == "III")
    }

    @Test func elCartelUsaElProveedorDeLaTesela() {
        let entrada = EntradaFuente(
            id: String(repeating: "a", count: 40), titulo: "MOVISTAR PLUS FHD --> NEW ERA III", ih: false, origen: "m3u",
            listaId: nil, canal: "Movistar Plus")
        let presentacion = ReglasFuentes.presentacion(entrada, listas: [])
        #expect(NombreCartel.proveedorTesela(presentacion) == "NEW ERA III")
        #expect(NombreCartel.nombre(entrada, presentacion) == "MOVISTAR PLUS FHD")
        let sinTitulo = EntradaFuente(id: String(repeating: "b", count: 40), titulo: " ", ih: false, origen: "m3u", canal: "DAZN 1")
        #expect(NombreCartel.nombre(sinTitulo, ReglasFuentes.presentacion(sinTitulo, listas: [])) == "DAZN 1")
    }
}
