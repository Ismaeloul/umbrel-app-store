import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Nombre de debajo del cartel, sin el proveedor (Isma, 26-sep): los casos de `channelNameWithoutProvider` en
   apps/web/src/features/sources/model.test.ts (rediseno/iptv) portados uno a uno. */

struct CasoSinProveedor: Sendable, CustomTestStringConvertible {
    let nombre: String
    let proveedores: [String?]
    let esperado: String

    init(_ nombre: String, _ proveedores: [String?], _ esperado: String) {
        self.nombre = nombre
        self.proveedores = proveedores
        self.esperado = esperado
    }

    var testDescription: String { nombre }
}

private let casosIsma: [CasoSinProveedor] = [
    CasoSinProveedor("MOVISTAR PLUS FHD --> NEW ERA III", ["New Era"], "MOVISTAR PLUS FHD"),
    CasoSinProveedor("DAZN 1 HD | ELCANO", ["Elcano"], "DAZN 1 HD"),
    CasoSinProveedor("M+ LaLiga (NEW ERA)", ["New Era"], "M+ LaLiga"),
    CasoSinProveedor("LaLiga TV [Elcano] 1080", ["Elcano"], "LaLiga TV 1080"),
    CasoSinProveedor("M+ LaLiga (NEW ERA)", ["NEW ERA III"], "M+ LaLiga"),
    CasoSinProveedor("DAZN 2 | NEW ERA II", ["New Era"], "DAZN 2"),
    CasoSinProveedor("Eurosport 1 - Elcano 2", ["Elcano"], "Eurosport 1"),
]

private let casosSeparadores: [CasoSinProveedor] =
    ["-->", "->", "=>", "==>", "»", "|", "-", "–", "—", "→", "·", ":", "/"].map { sep in
        CasoSinProveedor("DAZN F1 \(sep) Elcano", ["Elcano"], "DAZN F1")
    } + [
        CasoSinProveedor("DAZN F1 {Elcano}", ["Elcano"], "DAZN F1"),
        CasoSinProveedor("DAZN F1 ( Elcano )", ["Elcano"], "DAZN F1"),
        CasoSinProveedor("DAZN F1|Elcano", ["Elcano"], "DAZN F1"),
    ]

private let casosPosicion: [CasoSinProveedor] = [
    CasoSinProveedor("ELCANO | DAZN 1", ["Elcano"], "DAZN 1"),
    CasoSinProveedor("[Elcano] DAZN 1", ["Elcano"], "DAZN 1"),
    CasoSinProveedor("DAZN 1 ELCANO", ["Elcano"], "DAZN 1"),
    CasoSinProveedor("DAZN 1 Elcano", ["Elcano"], "DAZN 1"),
    CasoSinProveedor("DAZN 1 HD (Elcano) --> ", ["Elcano"], "DAZN 1 HD"),
    CasoSinProveedor("DAZN 1 | Elcano | HD", ["Elcano"], "DAZN 1 | HD"),
    CasoSinProveedor("Casa de Papel TV", ["Casa"], "Casa de Papel TV"),
    CasoSinProveedor("Elcano DAZN 1", ["Elcano"], "Elcano DAZN 1"),
    CasoSinProveedor("DAZN Elcano Liga", ["Elcano"], "DAZN Elcano Liga"),
    CasoSinProveedor("Canal - Casa de Papel TV", ["Casa"], "Canal - Casa de Papel TV"),
    CasoSinProveedor("Casa-Blanca TV", ["Casa"], "Casa-Blanca TV"),
]

private let casosParentesis: [CasoSinProveedor] = [
    CasoSinProveedor("Canal (Elcano 1080p)", ["Elcano"], "Canal (1080p)"),
    CasoSinProveedor("Canal (1080p Elcano)", ["Elcano"], "Canal (1080p)"),
    CasoSinProveedor("Canal [Elcano - 1080p]", ["Elcano"], "Canal [1080p]"),
    CasoSinProveedor("Canal ( HD ) | Elcano", ["Elcano"], "Canal (HD)"),
    CasoSinProveedor("M+ Vamos | orion", ["Orión"], "M+ Vamos"),
    CasoSinProveedor("M+ Vamos (ORIÓN)", ["orion"], "M+ Vamos"),
    CasoSinProveedor("Canal Sur Andalucía [Cénit]", ["cenit"], "Canal Sur Andalucía"),
]

private let casosBordes: [CasoSinProveedor] = [
    CasoSinProveedor("Eurosport 1", ["Sport"], "Eurosport 1"),
    CasoSinProveedor("Faroe Islands TV", ["Faro"], "Faroe Islands TV"),
    CasoSinProveedor("LaLiga TV 1080", ["Elcano"], "LaLiga TV 1080"),
    CasoSinProveedor("Elcano", ["Elcano"], "Elcano"),
    CasoSinProveedor("(New Era)", ["New Era"], "(New Era)"),
    CasoSinProveedor("DAZN 1", ["DAZN"], "DAZN 1"),
    CasoSinProveedor("  DAZN   LaLiga ", [], "DAZN LaLiga"),
    CasoSinProveedor("DAZN LaLiga", ["", nil, "  "], "DAZN LaLiga"),
    CasoSinProveedor("M+ LaLiga (Casa) | Elcano", ["Casa", "Elcano"], "M+ LaLiga"),
    CasoSinProveedor("DAZN 1 | TV+ Pro", ["TV+ Pro"], "DAZN 1"),
    CasoSinProveedor("DAZN 1 [a.b]", ["a.b"], "DAZN 1"),
    CasoSinProveedor("DAZN 1 axb", ["a.b"], "DAZN 1 axb"),
]

@Suite("Nombre de debajo del cartel, sin el proveedor (Isma, 26-sep)")
struct NombreSinProveedorTests {
    private func comprobar(_ caso: CasoSinProveedor) {
        #expect(ReglasFuentes.nombreSinProveedor(caso.nombre, proveedores: caso.proveedores) == caso.esperado)
    }

    @Test("Los casos de Isma y el proveedor con o sin numeral", arguments: casosIsma)
    func isma(_ caso: CasoSinProveedor) { comprobar(caso) }

    @Test("Todos los separadores", arguments: casosSeparadores)
    func separadores(_ caso: CasoSinProveedor) { comprobar(caso) }

    @Test("Delante o al final con separador; nunca suelto delante ni en mitad", arguments: casosPosicion)
    func posicion(_ caso: CasoSinProveedor) { comprobar(caso) }

    @Test("Paréntesis a medias y sin mayúsculas ni tildes que valgan", arguments: casosParentesis)
    func parentesis(_ caso: CasoSinProveedor) { comprobar(caso) }

    @Test("Palabras enteras, sin nombre el original, sin proveedores y caracteres raros", arguments: casosBordes)
    func bordes(_ caso: CasoSinProveedor) { comprobar(caso) }

    @Test("Parte del nombre de la tesela: la flecha ya se fue y lo que queda sale igual")
    func trasNombreCanal() {
        let nombre = ReglasFuentes.parteCanal("MOVISTAR PLUS FHD --> NEW ERA III")
        #expect(ReglasFuentes.nombreSinProveedor(nombre, proveedores: ["NEW ERA III"]) == "MOVISTAR PLUS FHD")
    }

    @Test("El plegado no cambia el largo en UTF-16")
    func plegado() {
        let texto = "Canal Sur Andalucía [CÉNIT] İ"
        let plegado = ReglasFuentes.plegarProveedor(texto)
        #expect(plegado.utf16.count == texto.utf16.count)
        #expect(plegado.hasPrefix("canal sur andalucia [cenit]"))
    }
}
