import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Los textos del cartel de fuente (Isma, 26-sep): el proveedor en la tesela y, debajo, el nombre del canal sin él.
   TODOS los casos del bloque «nombre de debajo del cartel, sin el proveedor (Isma, 26-sep)» de
   apps/web/src/features/sources/model.test.ts (origin/rediseno/iptv), uno a uno y con los mismos nombres, más lo
   propio de la app (la tesela y `posterNameOf`). */

struct NombreCartelTests {
    private func sin(_ nombre: String, _ proveedores: [String?]) -> String {
        NombreCartel.sinProveedor(nombre, proveedores: proveedores)
    }

    @Test func losCuatroCasosDeIsma() {
        #expect(sin("MOVISTAR PLUS FHD --> NEW ERA III", ["New Era"]) == "MOVISTAR PLUS FHD")
        #expect(sin("DAZN 1 HD | ELCANO", ["Elcano"]) == "DAZN 1 HD")
        #expect(sin("M+ LaLiga (NEW ERA)", ["New Era"]) == "M+ LaLiga")
        #expect(sin("LaLiga TV [Elcano] 1080", ["Elcano"]) == "LaLiga TV 1080")
    }

    @Test func parteDelNombreDelCanal() {
        let entrada = EntradaFuente(
            id: String(repeating: "a", count: 40), titulo: "MOVISTAR PLUS FHD --> NEW ERA III", ih: false, origen: "m3u",
            listaId: nil, canal: "")
        #expect(sin(ReglasFuentes.nombreCanal(entrada), ["NEW ERA III"]) == "MOVISTAR PLUS FHD")
    }

    @Test func elProveedorConOSinNumeral() {
        #expect(sin("M+ LaLiga (NEW ERA)", ["NEW ERA III"]) == "M+ LaLiga")
        #expect(sin("DAZN 2 | NEW ERA II", ["New Era"]) == "DAZN 2")
        #expect(sin("Eurosport 1 - Elcano 2", ["Elcano"]) == "Eurosport 1")
    }

    @Test(arguments: ["-->", "->", "=>", "==>", "»", "|", "-", "–", "—", "→", "·", ":", "/"])
    func todosLosSeparadores(_ separador: String) {
        #expect(sin("DAZN F1 \(separador) Elcano", ["Elcano"]) == "DAZN F1")
    }

    @Test func separadoresPegadosYParentesis() {
        #expect(sin("DAZN F1 {Elcano}", ["Elcano"]) == "DAZN F1")
        #expect(sin("DAZN F1 ( Elcano )", ["Elcano"]) == "DAZN F1")
        #expect(sin("DAZN F1|Elcano", ["Elcano"]) == "DAZN F1")
    }

    @Test func delanteConSeparadorOParentesisOComoUltimasPalabras() {
        #expect(sin("ELCANO | DAZN 1", ["Elcano"]) == "DAZN 1")
        #expect(sin("[Elcano] DAZN 1", ["Elcano"]) == "DAZN 1")
        #expect(sin("DAZN 1 ELCANO", ["Elcano"]) == "DAZN 1")
        #expect(sin("DAZN 1 Elcano", ["Elcano"]) == "DAZN 1")
        #expect(sin("DAZN 1 HD (Elcano) --> ", ["Elcano"]) == "DAZN 1 HD")
        #expect(sin("DAZN 1 | Elcano | HD", ["Elcano"]) == "DAZN 1 | HD")
    }

    @Test func nuncaSueltoAlPrincipioNiEnMitad() {
        #expect(sin("Casa de Papel TV", ["Casa"]) == "Casa de Papel TV")
        #expect(sin("Elcano DAZN 1", ["Elcano"]) == "Elcano DAZN 1")
        #expect(sin("DAZN Elcano Liga", ["Elcano"]) == "DAZN Elcano Liga")
        #expect(sin("Canal - Casa de Papel TV", ["Casa"]) == "Canal - Casa de Papel TV")
        #expect(sin("Casa-Blanca TV", ["Casa"]) == "Casa-Blanca TV")
    }

    @Test func parentesisAMedias() {
        #expect(sin("Canal (Elcano 1080p)", ["Elcano"]) == "Canal (1080p)")
        #expect(sin("Canal (1080p Elcano)", ["Elcano"]) == "Canal (1080p)")
        #expect(sin("Canal [Elcano - 1080p]", ["Elcano"]) == "Canal [1080p]")
        #expect(sin("Canal ( HD ) | Elcano", ["Elcano"]) == "Canal (HD)")
    }

    @Test func sinMayusculasNiTildesQueValgan() {
        #expect(sin("M+ Vamos | orion", ["Orión"]) == "M+ Vamos")
        #expect(sin("M+ Vamos (ORIÓN)", ["orion"]) == "M+ Vamos")
        #expect(sin("Canal Sur Andalucía [Cénit]", ["cenit"]) == "Canal Sur Andalucía")
    }

    @Test func soloPalabrasEnteras() {
        #expect(sin("Eurosport 1", ["Sport"]) == "Eurosport 1")
        #expect(sin("Faroe Islands TV", ["Faro"]) == "Faroe Islands TV")
        #expect(sin("LaLiga TV 1080", ["Elcano"]) == "LaLiga TV 1080")
    }

    @Test func siNoQuedaNombreElOriginal() {
        #expect(sin("Elcano", ["Elcano"]) == "Elcano")
        #expect(sin("(New Era)", ["New Era"]) == "(New Era)")
        #expect(sin("DAZN 1", ["DAZN"]) == "DAZN 1")
    }

    @Test func sinProveedoresElNombreQuedaIgualConLosEspaciosEnOrden() {
        #expect(sin("  DAZN   LaLiga ", []) == "DAZN LaLiga")
        #expect(sin("DAZN LaLiga", ["", nil, nil, "  "]) == "DAZN LaLiga")
    }

    @Test func variosProveedoresYCaracteresRaros() {
        #expect(sin("M+ LaLiga (Casa) | Elcano", ["Casa", "Elcano"]) == "M+ LaLiga")
        #expect(sin("DAZN 1 | TV+ Pro", ["TV+ Pro"]) == "DAZN 1")
        #expect(sin("DAZN 1 [a.b]", ["a.b"]) == "DAZN 1")
        #expect(sin("DAZN 1 axb", ["a.b"]) == "DAZN 1 axb")
    }

    // MARK: Lo propio de la app

    @Test func plegarConservaElLargo() {
        let texto = "Canal Sur Andalucía [Cénit] İ 🇪🇸 e\u{301}"
        #expect(NombreCartel.plegar(texto).utf16.count == texto.utf16.count)
        #expect(NombreCartel.plegar("ORIÓN Cénit") == "orion cenit")
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

    @Test func laListaTambienSeQuita() {
        let entrada = EntradaFuente(
            id: String(repeating: "c", count: 40), titulo: "DAZN 1 HD | ELCANO", ih: false, origen: "m3u",
            listaId: "l1", canal: "")
        let presentacion = PresentacionFuente(tipo: "M3U", lista: "Elcano", proveedor: "", etiqueta: "M3U · Elcano", corto: "Elcano")
        #expect(NombreCartel.nombre(entrada, presentacion) == "DAZN 1 HD")
    }

    @Test func laTeselaSinProveedorVuelveALaSigla() {
        let vacia = PresentacionFuente(tipo: "", lista: "", proveedor: "", etiqueta: "", corto: "  ")
        #expect(NombreCartel.proveedorTesela(vacia) == nil)
    }
}
