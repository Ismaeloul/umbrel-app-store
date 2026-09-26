import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Casos de apps/web/src/features/library/{model,on-air}.test.ts y player/zapping.ts portados a Swift
   Testing (M5). */

private func item(
    _ titulo: String, _ tipo: ItemType = .web, id: String? = nil, categoria: String = "", fecha: String = "2026-09-23T10:00:00.000Z",
    alias: String? = nil, lista: Bool = false
) -> Item {
    let hash = id ?? String((String(titulo.unicodeScalars.map { String($0.value, radix: 16) }.joined()) + String(repeating: "0", count: 40)).prefix(40))
    return Item(id: hash, title: titulo, alias: alias, type: tipo, category: categoria, date: fecha, fromWebSync: lista, ih: false)
}

private func partido(_ id: String, _ hora: String, _ canales: [String], fecha: String = "2026-09-23") -> FootballMatch {
    FootballMatch(
        id: id, date: fecha, time: hora, start: nil, title: "\(id) local - \(id) visitante", home: "\(id) local",
        away: "\(id) visitante", competition: "LaLiga", country: "Spain",
        channels: canales.enumerated().map { FootballChannelRef(id: "\(id)-\($0.offset)", name: $0.element) })
}

private func agenda(_ dias: [(String, [FootballMatch])]) -> FootballSchedule {
    FootballSchedule(
        generatedAt: "", timezone: "Europe/Madrid", country: "Spain", source: .demo, attribution: "", demo: true,
        limited: false, partial: false, days: dias.map { FootballDay(date: $0.0, matches: $0.1) }, stale: nil)
}

private func marcador(_ estado: String, reloj: String = "72'", detalle: String = "") -> LiveScore {
    LiveScore(home: 1, away: 0, state: estado, clock: reloj, detail: detalle, confidence: 0.9)
}

@Suite struct ModeloBibliotecaTests {
    @Test func pestanaInicial() {
        #expect(ReglasBiblioteca.seccionInicial(favoritos: 1, recientes: 1) == .favoritos)
        #expect(ReglasBiblioteca.seccionInicial(favoritos: 0, recientes: 1) == .recientes)
        #expect(ReglasBiblioteca.seccionInicial(favoritos: 0, recientes: 0) == .listas)
    }

    @Test func filtroPorTituloOCategoria() {
        let items = [
            item("Fútbol Uno", categoria: "Deportes"), item("La 1", categoria: "Generalistas"),
            item("ESPN", categoria: "Internacional", alias: "Deportes USA"),
        ]
        #expect(ReglasBiblioteca.filtrar(items, texto: "futbol").map(\.title) == ["Fútbol Uno"])
        #expect(ReglasBiblioteca.filtrar(items, texto: "GENERAL").map(\.title) == ["La 1"])
        #expect(ReglasBiblioteca.filtrar(items, texto: "  ").count == 3)
        #expect(ReglasBiblioteca.filtrar(items, texto: "nada").isEmpty)
        #expect(ReglasBiblioteca.filtrar(items, texto: "usa").isEmpty, "El alias no cuenta (filterItems)")
    }

    @Test func categoriasEnOrden() {
        let grupos = ReglasBiblioteca.porCategoria([
            item("B", categoria: "Música"), item("A", categoria: ""), item("C", categoria: "Deportes"),
            item("D", categoria: "deportes extra"),
        ])
        #expect(grupos.map(\.categoria) == ["Deportes", "deportes extra", "General", "Música"])
    }

    @Test func recientesPorTramos() {
        let ahora = Date(timeIntervalSince1970: 1_790_186_400)  // 23-sep-2026 20:00 en Madrid
        var calendario = Calendar(identifier: .gregorian)
        calendario.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
        let hace = { (horas: Double) in FechaISO.texto(ahora.addingTimeInterval(-horas * 3600)) }
        let grupos = ReglasBiblioteca.porTramos(
            [
                item("uno", .recent, fecha: hace(1)), item("dos", .recent, fecha: hace(22)),
                item("tres", .recent, fecha: hace(72)), item("cuatro", .recent, fecha: hace(720)),
                item("cinco", .recent, fecha: "no es fecha"),
            ], ahora: ahora, calendario: calendario)
        #expect(grupos.map(\.tramo) == ["Hoy", "Ayer", "Esta semana", "Antes", "Hoy"])
    }

    @Test func subtitulos() {
        let guardado = item("X", .fav, categoria: "Guardado")
        #expect(ReglasBiblioteca.subtituloBusqueda(categoria: "Deportes", disponibilidad: 0.914) == "Deportes · disp. 91%")
        #expect(ReglasBiblioteca.subtituloBusqueda(categoria: "", disponibilidad: nil) == "Búsqueda")
        #expect(ReglasBiblioteca.subtitulo(item("X", categoria: "Cine"), coleccion: .web) == "Cine")
        #expect(ReglasBiblioteca.subtitulo(guardado, coleccion: .favorites) == "\(guardado.id.prefix(14))…")
        #expect(ReglasBiblioteca.subtitulo(item("X", .fav, categoria: "Deportes"), coleccion: .favorites) == "Deportes")
        #expect(ReglasBiblioteca.subtitulo(guardado, coleccion: .web) == "Guardado")
        #expect(ReglasBiblioteca.porcentajeDisponible(1.7) == 100)
        #expect(ReglasBiblioteca.porcentajeDisponible(-1) == 0)
        #expect(ReglasBiblioteca.porcentajeDisponible(nil) == nil)
    }

    private static let viejo = item("Viejo", .fav, id: String(repeating: "a", count: 40), lista: true)
    private static let reciente = item("Canal de prueba", .recent, id: String(repeating: "b", count: 40))
    private static let ahora = Date(timeIntervalSince1970: 1_790_000_000)

    private static func biblioteca() -> LibraryView {
        let web: [Item] = [item("L1"), item("L2"), item("L3")]
        let favoritos: [Item] = [viejo, item("F2", .fav)]
        return LibraryView(
            web: web, webSyncedAt: "2026-09-23T10:00:00.000Z", webSources: [], activeWebSourceId: "",
            favorites: favoritos, history: [reciente])
    }

    @Test func canalCaido() {
        let viejo: Item = Self.viejo
        #expect(ReglasBiblioteca.caido(viejo, idsLista: ["otro"]))
        #expect(!ReglasBiblioteca.caido(viejo, idsLista: [viejo.id]))
        var noSincronizado: Item = viejo
        noSincronizado.fromWebSync = false
        #expect(!ReglasBiblioteca.caido(noSincronizado, idsLista: ["otro"]))
        #expect(!ReglasBiblioteca.caido(viejo, idsLista: []))
    }

    @Test func pieYConocido() {
        let biblioteca: LibraryView = Self.biblioteca()
        let pie: String = ReglasBiblioteca.pie(biblioteca, demo: true)
        #expect(pie.hasPrefix("6 canales en biblioteca · lista sincronizada 23 sept"))
        #expect(pie.hasSuffix(" · demo"))
        var sinFecha: LibraryView = biblioteca
        sinFecha.webSyncedAt = nil
        #expect(ReglasBiblioteca.pie(sinFecha, demo: false) == "6 canales en biblioteca")
        #expect(ReglasBiblioteca.conocido(biblioteca, hash: Self.reciente.id)?.title == "Canal de prueba")
        #expect(ReglasBiblioteca.conocido(biblioteca, hash: String(repeating: "f", count: 40)) == nil)
        #expect(ReglasBiblioteca.conocido(nil, hash: "x") == nil)
        #expect(ReglasBiblioteca.enTuBiblioteca(biblioteca, texto: "l").map(\.title) == ["Canal de prueba", "L1", "L2", "L3"])
        #expect(ReglasBiblioteca.enTuBiblioteca(biblioteca, texto: "e").map(\.title) == ["Viejo", "Canal de prueba"])
    }

    @Test func favoritoNuevoDeRecientes() {
        #expect(ReglasBiblioteca.tituloFavoritoPorDefecto("abcdef0123") == "Canal abcdef")
        let deRecientes: Item = ReglasBiblioteca.favoritoNuevo(
            hash: Self.reciente.id, escrito: "  Mi   canal ", categoria: "Deportes", ih: nil, biblioteca: Self.biblioteca(),
            ahora: Self.ahora)
        #expect(deRecientes.title == "Mi canal")
        #expect(deRecientes.category == "Deportes")
        #expect(deRecientes.type == .fav)
        #expect(deRecientes.date == FechaISO.texto(Self.ahora))
        #expect(deRecientes.fromWebSync == false)
        #expect(deRecientes.ih == false)
    }

    @Test func favoritoNuevoSinCategoriaYDeLaLista() {
        let sinCategoria: Item = ReglasBiblioteca.favoritoNuevo(
            hash: "abcdef0123", escrito: " ", categoria: "", ih: true, biblioteca: nil, ahora: Self.ahora)
        #expect(sinCategoria.title == "Canal abcdef")
        #expect(sinCategoria.category == "Guardado")
        #expect(sinCategoria.ih == true)
        let sinNada: Item = ReglasBiblioteca.favoritoNuevo(
            hash: "x", escrito: "", categoria: nil, ih: nil, biblioteca: nil, ahora: Self.ahora)
        #expect(sinNada.category == "Guardado")
        let biblioteca: LibraryView = Self.biblioteca()
        if let deLaLista = biblioteca.web.first {
            let nuevo: Item = ReglasBiblioteca.favoritoNuevo(
                hash: deLaLista.id, escrito: "", categoria: "Cine", ih: false, biblioteca: biblioteca, ahora: Self.ahora)
            #expect(nuevo.fromWebSync == true)
            #expect(nuevo.category == "Cine")
        }
    }
}
