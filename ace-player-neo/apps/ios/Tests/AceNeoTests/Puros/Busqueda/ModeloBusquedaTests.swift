import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* search/model.ts, `normalizeHash` de @ace/shared (domain/hash.ts) y `pastedTitle` (paste-hash) (M5). */

@Suite struct ModeloBusquedaTests {
    private let hash = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"

    @Test func limpiarYMinimo() {
        #expect(ModeloBusqueda.limpiar("  dazn   1 ") == "dazn 1")
        #expect(ModeloBusqueda.limpiar(String(repeating: "x", count: 100)).count == 80)
        #expect(!ModeloBusqueda.sePuedeBuscar("a"))
        #expect(ModeloBusqueda.sePuedeBuscar(" ab "))
    }

    @Test func fases() {
        #expect(ModeloBusqueda.fase(escrito: "", comprometido: "", cargando: false, error: false, cuenta: nil) == .reposo)
        #expect(ModeloBusqueda.fase(escrito: "d", comprometido: "", cargando: false, error: false, cuenta: nil) == .corta)
        #expect(ModeloBusqueda.fase(escrito: "dazn", comprometido: "d", cargando: false, error: false, cuenta: nil) == .reposo)
        #expect(ModeloBusqueda.fase(escrito: "dazn", comprometido: "dazn", cargando: true, error: false, cuenta: nil) == .buscando("dazn"))
        #expect(ModeloBusqueda.fase(escrito: "dazn", comprometido: "dazn", cargando: false, error: true, cuenta: nil) == .error("dazn"))
        #expect(ModeloBusqueda.fase(escrito: "dazn", comprometido: "dazn", cargando: false, error: false, cuenta: 0) == .vacia("dazn"))
        #expect(ModeloBusqueda.fase(escrito: "dazn", comprometido: "dazn", cargando: false, error: false, cuenta: 3) == .resultados("dazn", 3))
    }

    @Test func normalizarHash() {
        #expect(ModeloBusqueda.normalizarHash("acestream://\(hash.uppercased())") == hash)
        #expect(ModeloBusqueda.normalizarHash("http://x/ace/getstream?id=\(hash)") == hash)
        #expect(ModeloBusqueda.normalizarHash("https://x/?content_id=\(hash)&a=1") == hash)
        #expect(ModeloBusqueda.normalizarHash("mira esto: \(hash) ya") == hash)
        #expect(ModeloBusqueda.normalizarHash("  \(hash)  ") == hash)
        #expect(ModeloBusqueda.normalizarHash("dazn") == nil)
        #expect(ModeloBusqueda.normalizarHash(String(hash.prefix(39))) == nil)
        #expect(ModeloBusqueda.normalizarHash("") == nil)
    }

    @Test func tituloYAnuncios() {
        #expect(ModeloBusqueda.tituloPegado(hash, conocido: nil) == "Stream a1b2c3d4")
        #expect(ModeloBusqueda.tituloPegado(hash, conocido: "  ") == "Stream a1b2c3d4")
        #expect(ModeloBusqueda.tituloPegado(hash, conocido: "DAZN 1") == "DAZN 1")
        #expect(ModeloBusqueda.anuncio(.buscando("dazn"), enlace: nil, conocido: nil) == "Buscando «dazn» en el motor…")
        #expect(ModeloBusqueda.anuncio(.resultados("dazn", 1), enlace: nil, conocido: nil) == "1 resultado para «dazn».")
        #expect(ModeloBusqueda.anuncio(.resultados("dazn", 2), enlace: nil, conocido: nil) == "2 resultados para «dazn».")
        #expect(ModeloBusqueda.anuncio(.vacia("x y"), enlace: nil, conocido: nil) == "Sin resultados para «x y».")
        #expect(ModeloBusqueda.anuncio(.reposo, enlace: hash, conocido: nil) == "Enlace detectado: Content ID \(hash).")
        #expect(ModeloBusqueda.anuncio(.reposo, enlace: hash, conocido: "DAZN 1") == "Enlace detectado: DAZN 1.")
    }
}
