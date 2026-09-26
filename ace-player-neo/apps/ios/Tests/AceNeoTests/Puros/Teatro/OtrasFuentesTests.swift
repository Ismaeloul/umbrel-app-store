import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Lo que el teatro pone encima de las reglas de otros módulos: la cabecera del canal suelto (ChannelCenter.tsx),
   el botón de las plegadas (SourceList.tsx) y los equipos para Palco. Los gestos son los de M2
   (GestosYHapticaTests) y las fuentes, los de M3 (ReglasFuentesTests, vectores-fuentes.json, OpcionesTests). */

private func item(_ id: String, _ titulo: String, tipo: ItemType, alias: String? = nil) -> Item {
    Item(id: id, title: titulo, alias: alias, type: tipo, category: "", date: "", fromWebSync: false, ih: false)
}

private func biblioteca(web: [Item] = [], favoritos: [Item] = [], recientes: [Item] = []) -> LibraryView {
    LibraryView(
        web: web, webSyncedAt: nil,
        webSources: [WebSourceSummary(id: "l1", name: "Directorio de Isma", url: "", type: .m3u, count: 0)],
        activeWebSourceId: "l1", favorites: favoritos, history: recientes)
}

struct OtrasFuentesTests {
    @Test func hermanasDeLaBiblioteca() {
        let dazn1 = item("a", "DAZN 1", tipo: .fav)
        let dazn1HD = item("b", "DAZN 1 HD", tipo: .web)
        let movistar = item("c", "Movistar Liga de Campeones", tipo: .web)
        let lib = biblioteca(web: [dazn1HD, movistar], favoritos: [dazn1])
        let hermanas = OtrasFuentes.hermanas(lib, hash: "a")
        #expect(hermanas.map(\.id) == ReglasFuentes.hermanas(lib, id: "a").map(\.id))
        #expect(hermanas.map(\.id).contains("a") && hermanas.map(\.id).contains("b") && !hermanas.map(\.id).contains("c"))
        #expect(OtrasFuentes.cuenta(hermanas) == hermanas.count)
        #expect(OtrasFuentes.hermanas(lib, hash: "zzz").isEmpty)
        #expect(OtrasFuentes.cuenta([dazn1]) == 0)
    }

    @Test func origenYTitulo() {
        let fav = item("a", "DAZN 1", tipo: .fav)
        let web = item("b", "DAZN 1 HD", tipo: .web)
        let lib = biblioteca(web: [web], favoritos: [fav])
        #expect(OtrasFuentes.origen(nil, biblioteca: lib) == "Fuera de tu biblioteca")
        #expect(OtrasFuentes.origen(fav, biblioteca: lib) == "En tus favoritos")
        #expect(OtrasFuentes.origen(web, biblioteca: lib) == "De tu lista Directorio de Isma")
        #expect(OtrasFuentes.origen(item("r", "X", tipo: .recent), biblioteca: lib) == "En tus recientes")
        #expect(OtrasFuentes.item(lib, hash: "b")?.title == "DAZN 1 HD")
        #expect(OtrasFuentes.titulo(nil, reproductor: nil, hash: "0123456789abcdef") == "Canal 01234567")
        #expect(OtrasFuentes.titulo(nil, reproductor: "DAZN", hash: "0123456789abcdef") == "DAZN")
    }
}
