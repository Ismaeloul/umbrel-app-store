import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* El nombre de la fila de canal sin el proveedor que ya se lee encima (petición de Isma, M5). */

struct NombreFilaTests {
    @Test func bajoLaListaDelProveedorSoloQuedaElCanal() {
        #expect(ReglasBiblioteca.nombreFila("DAZN 1 FHD --> NEW ERA", yaSeLee: ["NEW ERA"]) == "DAZN 1 FHD")
        #expect(ReglasBiblioteca.nombreFila("M+ LaLiga FHD --> ELCANO", yaSeLee: ["EL CANO"]) == "M+ LaLiga FHD")
        #expect(ReglasBiblioteca.nombreFila("M+ LaLiga --> Elcano", yaSeLee: ["Directorio de Élcano"]) == "M+ LaLiga")
    }

    @Test func otrasFlechasTambien() {
        #expect(ReglasBiblioteca.nombreFila("DAZN 2 ==> New Era", yaSeLee: ["", "new era"]) == "DAZN 2")
        #expect(ReglasBiblioteca.nombreFila("DAZN 2 → New Era", yaSeLee: ["Deportes", "NEW ERA"]) == "DAZN 2")
    }

    @Test func siElProveedorNoSeLeeEnOtroSitioElTituloQuedaEntero() {
        #expect(ReglasBiblioteca.nombreFila("DAZN 1 FHD --> NEW ERA", yaSeLee: ["Principal", "Deportes"]) == "DAZN 1 FHD --> NEW ERA")
        #expect(ReglasBiblioteca.nombreFila("DAZN 1 FHD --> NEW ERA", yaSeLee: []) == "DAZN 1 FHD --> NEW ERA")
    }

    @Test func sinProveedorOSinCanalNoCambia() {
        #expect(ReglasBiblioteca.nombreFila("DAZN 1 FHD", yaSeLee: ["DAZN"]) == "DAZN 1 FHD")
        #expect(ReglasBiblioteca.nombreFila("--> NEW ERA", yaSeLee: ["NEW ERA"]) == "--> NEW ERA")
    }
}
