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

    /// El favorito «Viejo» que venía de la lista sincronizada.
    private var viejo: Item { item("Viejo", .fav, id: String(repeating: "a", count: 40), lista: true) }
    private var reciente: Item { item("Canal de prueba", .recent, id: String(repeating: "b", count: 40)) }
    private var biblioteca: LibraryView {
        LibraryView(
            web: [item("L1"), item("L2"), item("L3")], webSyncedAt: "2026-09-23T10:00:00.000Z", webSources: [],
            activeWebSourceId: "", favorites: [viejo, item("F2", .fav)], history: [reciente])
    }

    /// Partida en tres: junta tardaba 420 ms en tiparse en la CI (límite 400; CI 36226198913).
    @Test func canalCaido() {
        let viejo = self.viejo
        #expect(ReglasBiblioteca.caido(viejo, idsLista: ["otro"]))
        #expect(!ReglasBiblioteca.caido(viejo, idsLista: [viejo.id]))
        var noSincronizado = viejo
        noSincronizado.fromWebSync = false
        #expect(!ReglasBiblioteca.caido(noSincronizado, idsLista: ["otro"]))
        #expect(!ReglasBiblioteca.caido(viejo, idsLista: []))
    }

    @Test func pieYConocido() {
        let reciente = self.reciente
        let biblioteca = self.biblioteca
        #expect(ReglasBiblioteca.pie(biblioteca, demo: true).hasPrefix("6 canales en biblioteca · lista sincronizada 23 sept"))
        #expect(ReglasBiblioteca.pie(biblioteca, demo: true).hasSuffix(" · demo"))
        var sinFecha = biblioteca
        sinFecha.webSyncedAt = nil
        #expect(ReglasBiblioteca.pie(sinFecha, demo: false) == "6 canales en biblioteca")
        #expect(ReglasBiblioteca.conocido(biblioteca, hash: reciente.id)?.title == "Canal de prueba")
        #expect(ReglasBiblioteca.conocido(biblioteca, hash: String(repeating: "f", count: 40)) == nil)
        #expect(ReglasBiblioteca.conocido(nil, hash: "x") == nil)
    }

    @Test func favoritoNuevoYEnTuBiblioteca() {
        let reciente = self.reciente
        let biblioteca = self.biblioteca
        #expect(ReglasBiblioteca.tituloFavoritoPorDefecto("abcdef0123") == "Canal abcdef")
        let ahora = Date(timeIntervalSince1970: 1_790_000_000)
        let deRecientes = ReglasBiblioteca.favoritoNuevo(
            hash: reciente.id, escrito: "  Mi   canal ", categoria: "Deportes", ih: nil, biblioteca: biblioteca, ahora: ahora)
        #expect(deRecientes.title == "Mi canal")
        #expect(deRecientes.category == "Deportes")
        #expect(deRecientes.type == .fav)
        #expect(deRecientes.date == FechaISO.texto(ahora))
        #expect(deRecientes.fromWebSync == false)
        #expect(deRecientes.ih == false)
        let sinCategoria = ReglasBiblioteca.favoritoNuevo(
            hash: "abcdef0123", escrito: " ", categoria: "", ih: true, biblioteca: nil, ahora: ahora)
        #expect(sinCategoria.title == "Canal abcdef")
        #expect(sinCategoria.category == "Guardado")
        #expect(sinCategoria.ih == true)
        #expect(ReglasBiblioteca.favoritoNuevo(hash: "x", escrito: "", categoria: nil, ih: nil, biblioteca: nil, ahora: ahora).category == "Guardado")
        if let deLaLista = biblioteca.web.first {
            let item = ReglasBiblioteca.favoritoNuevo(
                hash: deLaLista.id, escrito: "", categoria: "Cine", ih: false, biblioteca: biblioteca, ahora: ahora)
            #expect(item.fromWebSync == true)
            #expect(item.category == "Cine")
        }
        #expect(ReglasBiblioteca.enTuBiblioteca(biblioteca, texto: "l").map(\.title) == ["Canal de prueba", "L1", "L2", "L3"])
        #expect(ReglasBiblioteca.enTuBiblioteca(biblioteca, texto: "e").map(\.title) == ["Viejo", "Canal de prueba"])
    }
}

@Suite struct EnAntenaTests {
    @Test func estadoConVentanaDeDosHoras() {
        #expect(IndiceAntena.fase(faltan: 30, marcador: nil) == .proximo)
        #expect(IndiceAntena.fase(faltan: -30, marcador: nil) == .directo)
        #expect(IndiceAntena.fase(faltan: -130, marcador: nil) == .terminado)
        #expect(IndiceAntena.fase(faltan: nil, marcador: nil) == .proximo)
        #expect(IndiceAntena.fase(faltan: 20, marcador: marcador("in")) == .directo)
        #expect(IndiceAntena.fase(faltan: -30, marcador: marcador("post")) == .terminado)
    }

    @Test func soloElMismoCanalSinDuda() {
        let reloj = RelojMadrid(fecha: "2026-09-23", minutos: 20 * 60)
        let indice = IndiceAntena(agenda: agenda([("2026-09-23", [partido("a", "21:00", ["DAZN"])])]), reloj: reloj)
        #expect(indice.para(titulo: "DAZN", alias: nil, marcadores: [:]).siguiente?.partido.id == "a")
        #expect(indice.para(titulo: "DAZN 1", alias: nil, marcadores: [:]) == .vacio)
        let conAlias = IndiceAntena(agenda: agenda([("2026-09-23", [partido("b", "21:00", ["M+ LaLiga"])])]), reloj: reloj)
        #expect(conAlias.para(titulo: "M. LaLiga", alias: "M+ LaLiga", marcadores: [:]).siguiente?.partido.id == "b")
    }

    @Test func directoSiguienteYDespues() {
        let reloj = RelojMadrid(fecha: "2026-09-23", minutos: 21 * 60)
        let partidos = [
            partido("tarde", "18:00", ["DAZN 1"]), partido("ahora", "20:30", ["DAZN 1"]),
            partido("luego", "23:00", ["DAZN 1"]), partido("antes", "21:45", ["DAZN 1"]),
            partido("otro", "21:10", ["La 1"]),
        ]
        let indice = IndiceAntena(agenda: agenda([("2026-09-23", partidos)]), reloj: reloj)
        let resultado = indice.para(titulo: "DAZN 1 HD", alias: nil, marcadores: [:])
        #expect(resultado.directo?.partido.id == "ahora")
        #expect(resultado.siguiente == nil)
        #expect(resultado.despues.map(\.partido.id) == ["antes", "luego"])
        let tranquilo = IndiceAntena(agenda: agenda([("2026-09-23", Array(partidos[2...]))]), reloj: reloj)
            .para(titulo: "DAZN 1", alias: nil, marcadores: [:])
        #expect(tranquilo.directo == nil)
        #expect(tranquilo.siguiente?.partido.id == "antes")
        #expect(tranquilo.despues.map(\.partido.id) == ["luego"])
    }

    @Test func partidosDeHoyYVentanaDeMarcadores() {
        let reloj = RelojMadrid(fecha: "2026-09-23", minutos: 30)
        let dias = agenda([
            ("2026-09-22", [partido("ayer-tarde", "22:45", ["X"], fecha: "2026-09-22"), partido("ayer", "18:00", ["X"], fecha: "2026-09-22")]),
            ("2026-09-23", [partido("hoy", "21:00", ["X"])]),
        ])
        #expect(IndiceAntena(agenda: dias, reloj: reloj).partidos.map(\.id) == ["ayer-tarde", "hoy"])
        let hoy = agenda([("2026-09-23", [partido("hoy", "21:00", ["X"])])])
        #expect(IndiceAntena(agenda: hoy, reloj: RelojMadrid(fecha: "2026-09-23", minutos: 20 * 60 + 50)).hacenFaltaMarcadores())
        #expect(!IndiceAntena(agenda: hoy, reloj: RelojMadrid(fecha: "2026-09-23", minutos: 18 * 60)).hacenFaltaMarcadores())
    }

    @Test func minutoYDescanso() {
        #expect(IndiceAntena.minuto(marcador("in", reloj: "72'")) == "72'")
        #expect(IndiceAntena.minuto(marcador("in", reloj: "45+2\u{2019}")) == "45+2'")
        #expect(IndiceAntena.minuto(marcador("in", reloj: "")) == nil)
        #expect(IndiceAntena.minuto(nil) == nil)
        #expect(IndiceAntena.descanso(marcador("in", reloj: "HT", detalle: "Halftime")))
        #expect(!IndiceAntena.descanso(marcador("in")))
    }

    @Test func emitiendoAhoraSinRepetir() {
        let reloj = RelojMadrid(fecha: "2026-09-23", minutos: 21 * 60)
        let indice = IndiceAntena(agenda: agenda([("2026-09-23", [partido("ahora", "20:30", ["DAZN 1"])])]), reloj: reloj)
        let dazn = item("DAZN 1 HD", .fav, id: String(repeating: "d", count: 40))
        let otro = item("La 1", .recent)
        let entradas = ReglasEmitiendo.entradas([dazn, otro, dazn], indice: indice, marcadores: [:])
        #expect(entradas.map(\.item.id) == [dazn.id])
        #expect(ReglasEmitiendo.entradas([dazn], indice: .vacio, marcadores: [:]).isEmpty)
    }
}

@Suite struct ZappingYMenuTests {
    @Test func listaDeZapping() {
        let fav = item("Fav", .fav, id: "f")
        let web = [
            item("D1", id: "d1", categoria: "Deportes"), item("G1", id: "g1", categoria: "Generalistas"),
            item("D2", id: "d2", categoria: "Deportes"), item("Fav", id: "f", categoria: "Deportes"),
            item("S", id: "s"),
        ]
        let lista = Zapping.lista(favoritos: [fav], web: web)
        #expect(lista.map(\.id) == ["f", "d1", "d2", "g1", "s"])
        #expect(Zapping.destino(lista, actual: "d2", paso: 1)?.id == "g1")
        #expect(Zapping.destino(lista, actual: "f", paso: -1)?.id == "s")
        #expect(Zapping.destino(lista, actual: "otro", paso: 1)?.id == "f")
        #expect(Zapping.destino([], actual: nil, paso: 1) == nil)
        #expect(Zapping.destino(Array(lista.prefix(1)), actual: "f", paso: 1) == nil)
    }

    @Test func menuDeCanal() {
        let favorito = OpcionesCanal.menu(origen: .coleccion(.favorites), esFavorito: true, enBiblioteca: true)
        #expect(favorito.map(\.opcion.titulo) == [
            "Quitar de favoritos", "Abrir en la app de AceStream", "Copiar URL del stream (VLC)",
            "Copiar enlace acestream://", "Copiar hash", "Copiar nombre", "Renombrar",
        ])
        #expect(favorito[1].opcion.separadaAntes && favorito[6].opcion.separadaAntes)
        let reciente = OpcionesCanal.menu(origen: .coleccion(.history), esFavorito: false, enBiblioteca: true)
        #expect(reciente.first?.opcion.titulo == "Añadir a favoritos")
        #expect(reciente.last?.opcion.titulo == "Quitar de recientes")
        #expect(reciente.last?.opcion.peligro == true)
        #expect(reciente.last?.opcion.separadaAntes == false)
        #expect(OpcionesCanal.menu(origen: .coleccion(.web), esFavorito: false, enBiblioteca: true).last?.opcion.titulo == "Eliminar de la lista")
        #expect(OpcionesCanal.menu(origen: .busqueda, esFavorito: false, enBiblioteca: false).count == 6)
        #expect(OpcionesCanal.urlStream(origen: "http://umbrel.local:7792", hash: "ab", ih: true) == "http://umbrel.local:7792/ace/getstream?infohash=ab")
        #expect(OpcionesCanal.urlStream(origen: "http://x", hash: "ab", ih: false) == "http://x/ace/getstream?id=ab")
        #expect(OpcionesCanal.enlace("ab") == "acestream://ab")
    }
}
