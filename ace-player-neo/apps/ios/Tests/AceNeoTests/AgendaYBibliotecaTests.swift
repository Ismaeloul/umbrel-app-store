import XCTest

@testable import AceNeo

private func partido(
    _ id: String, _ hora: String, _ competicion: String, local: String = "Local", visitante: String = "Visitante",
    fecha: String = "2026-09-23", canales: [String] = []
) -> FootballMatch {
    FootballMatch(
        id: id, date: fecha, time: hora, start: nil, title: "\(local) - \(visitante)", home: local, away: visitante,
        competition: competicion, country: "", channels: canales.enumerated().map { FootballChannelRef(id: "c\($0.offset)", name: $0.element) })
}

private func item(_ id: String, _ titulo: String, categoria: String = "", fecha: String = "2026-09-23T10:00:00.000Z", web: Bool = false)
    -> Item
{
    Item(
        id: id, title: titulo, alias: nil, type: web ? .web : .fav, category: categoria, date: fecha,
        fromWebSync: web, ih: false)
}

/// Reglas de la agenda portadas de la web: reloj de Madrid, insignias, orden y «Para ti».
final class ReglasAgendaTests: XCTestCase {
    /// 23-sep-2026 a las 10:00 en Madrid.
    private let reloj = RelojMadrid(fecha: "2026-09-23", minutos: 600)

    func testDiasSinHusos() {
        XCTAssertEqual(ReglasAgenda.numeroDia("2026-09-23"), 20719)
        XCTAssertEqual(ReglasAgenda.numeroDia("1970-01-01"), 0)
        XCTAssertEqual(ReglasAgenda.numeroDia("1969-12-31"), -1)
        XCTAssertEqual(ReglasAgenda.numeroDia("2024-02-29"), 19782)
        XCTAssertEqual(ReglasAgenda.numeroDia("2000-03-01"), 11017)
        XCTAssertNil(ReglasAgenda.numeroDia("23/09/2026"))
        XCTAssertNil(ReglasAgenda.minutosDeHora("Por confirmar"))
        XCTAssertEqual(ReglasAgenda.minutosDeHora("18:30"), 1110)
    }

    func testRelojDeMadridYNoDelTelefono() {
        // 23-sep-2026 18:30 UTC = 20:30 en Madrid (horario de verano).
        let reloj = RelojMadrid(Date(timeIntervalSince1970: 1_790_188_200))
        XCTAssertEqual(reloj.fecha, "2026-09-23")
        XCTAssertEqual(reloj.minutos, 20 * 60 + 30)
    }

    func testInsigniasComoLaWeb() {
        XCTAssertNil(ReglasAgenda.estado(partido("a", "18:30", "LaLiga"), reloj: reloj, marcador: nil), "Faltan más de 6 h")
        XCTAssertEqual(
            ReglasAgenda.estado(partido("a", "15:00", "LaLiga"), reloj: reloj, marcador: nil),
            EstadoPartido(fase: .proximo, texto: "En 5 h 0 min"))
        XCTAssertEqual(
            ReglasAgenda.estado(partido("a", "10:45", "LaLiga"), reloj: reloj, marcador: nil),
            EstadoPartido(fase: .pronto, texto: "En 45 min"))
        XCTAssertEqual(ReglasAgenda.estado(partido("a", "09:30", "LaLiga"), reloj: reloj, marcador: nil)?.fase, .directo)
        XCTAssertEqual(ReglasAgenda.estado(partido("a", "07:30", "LaLiga"), reloj: reloj, marcador: nil)?.fase, .terminado)
        let enJuego = LiveScore(home: 1, away: 0, state: "in", clock: "54'", detail: "", confidence: 1)
        XCTAssertEqual(ReglasAgenda.estado(partido("a", "22:00", "LaLiga"), reloj: reloj, marcador: enJuego)?.fase, .directo)
        XCTAssertNil(ReglasAgenda.estado(partido("a", "Por confirmar", "LaLiga"), reloj: reloj, marcador: nil))
    }

    func testGruposPorCompeticionConLoQueVaEnDirectoPrimero() {
        let partidos = [
            partido("1", "21:00", "LaLiga"),
            partido("2", "07:00", "Amistoso"),  // terminado
            partido("3", "09:30", "Premier League"),  // en directo
            partido("4", "12:00", "LaLiga"),
            partido("5", "13:00", " "),
        ]
        let grupos = ReglasAgenda.porCompeticion(partidos, reloj: reloj)
        XCTAssertEqual(grupos.map(\.competicion), ["Premier League", "LaLiga", "Fútbol", "Amistoso"])
        XCTAssertEqual(grupos[1].partidos.map(\.id), ["4", "1"], "Dentro, por hora")
    }

    func testParaTiSoloConGustosYPorDefectoSiLosHay() {
        let gustos = GustosFutbol(leagues: ["LaLiga"], teams: ["Real Madrid"])
        XCTAssertEqual(ReglasAgenda.modoEfectivo(nil, gustos: gustos), .paraTi)
        XCTAssertEqual(ReglasAgenda.modoEfectivo(.todos, gustos: gustos), .todos)
        XCTAssertEqual(ReglasAgenda.modoEfectivo(.paraTi, gustos: .vacios), .todos, "Sin gustos no hay «Para ti»")

        let partidos = [
            partido("1", "21:00", "LaLiga EA Sports"),
            partido("2", "20:00", "Torneo Proyección", local: "Central Córdoba Reserva", visitante: "Atlético Tucumán Reserva"),
            partido("3", "19:00", "Copa del Rey", local: "Real Madrid", visitante: "Getafe"),
        ]
        XCTAssertEqual(ReglasAgenda.visibles(partidos, modo: .paraTi, gustos: gustos).map(\.id), ["1", "3"])
        XCTAssertEqual(ReglasAgenda.visibles(partidos, modo: .todos, gustos: gustos).count, 3)
        XCTAssertTrue(ParaTi.destacado(partidos[2], gustos))
        XCTAssertFalse(ParaTi.destacado(partidos[0], gustos))
    }

    func testTiraDeDias() {
        let ahora = Date(timeIntervalSince1970: 1_790_150_400)  // 23-sep-2026 10:00 en Madrid
        XCTAssertEqual(FormatoAgenda.partesDia("2026-09-23", ahora: ahora).arriba, "Hoy")
        XCTAssertEqual(FormatoAgenda.partesDia("2026-09-24", ahora: ahora).arriba, "Mañana")
        let viernes = FormatoAgenda.partesDia("2026-09-25", ahora: ahora)
        XCTAssertEqual(viernes.numero, "25")
        XCTAssertTrue(viernes.arriba.hasPrefix("V"), viernes.arriba)
        XCTAssertEqual(FormatoAgenda.partidos(1), "1 partido")
        XCTAssertEqual(FormatoAgenda.partidos(3), "3 partidos")
    }
}

/// Biblioteca como la de la web: listas agrupadas, recientes por tramos, lo que emite cada canal.
final class ReglasBibliotecaTests: XCTestCase {
    func testListasAgrupadasPorCategoriaEnOrdenAlfabetico() {
        let canales = [
            item("1", "DAZN 1", categoria: "Deportes", web: true),
            item("2", "La 1", categoria: "generalistas", web: true),
            item("3", "Sin nada", web: true),
            item("4", "DAZN 2", categoria: "Deportes", web: true),
            item("5", "Clan", categoria: "Álbum infantil", web: true),
        ]
        let grupos = ReglasBiblioteca.porCategoria(canales)
        XCTAssertEqual(grupos.map(\.categoria), ["Álbum infantil", "Deportes", "General", "generalistas"])
        XCTAssertEqual(grupos[1].items.map(\.id), ["1", "4"], "Sin cambiar el orden dentro")
        XCTAssertEqual(ReglasBiblioteca.filtrar(canales, texto: "album").map(\.id), ["5"], "Sin tildes")
        XCTAssertEqual(ReglasBiblioteca.filtrar(canales, texto: "DEPORTES").count, 2, "También por categoría")
    }

    func testRecientesPorTramos() {
        var calendario = Calendar(identifier: .gregorian)
        calendario.timeZone = TimeZone(identifier: "Europe/Madrid")!
        let ahora = Date(timeIntervalSince1970: 1_790_150_400)  // 23-sep-2026 10:00 en Madrid
        let recientes = [
            item("1", "A", fecha: "2026-09-23T07:00:00.000Z"),
            item("2", "B", fecha: "2026-09-22T12:00:00.000Z"),
            item("3", "C", fecha: "2026-09-19T12:00:00.000Z"),
            item("4", "D", fecha: "2026-08-01T12:00:00.000Z"),
            item("5", "E", fecha: "no es fecha"),
        ]
        let grupos = ReglasBiblioteca.porTramos(recientes, ahora: ahora, calendario: calendario)
        XCTAssertEqual(grupos.map(\.tramo), ["Hoy", "Ayer", "Esta semana", "Antes", "Hoy"])
    }

    func testSeccionInicialSubtitulosYCanalCaido() throws {
        let arranque = try JSONDecoder().decode(BootstrapResponse.self, from: Fixtures.datos("v1/bootstrap.json"))
        XCTAssertEqual(ReglasBiblioteca.seccionInicial(arranque.library), .favoritos)
        var sinFavoritos = arranque.library
        sinFavoritos.favorites = []
        XCTAssertEqual(ReglasBiblioteca.seccionInicial(sinFavoritos), .recientes)
        sinFavoritos.history = []
        XCTAssertEqual(ReglasBiblioteca.seccionInicial(sinFavoritos), .listas)

        XCTAssertNil(ReglasBiblioteca.subtitulo(item("1", "X", categoria: "Guardado"), seccion: .favoritos))
        XCTAssertEqual(ReglasBiblioteca.subtitulo(item("1", "X", categoria: "Deportes"), seccion: .favoritos), "Deportes")
        XCTAssertEqual(ReglasBiblioteca.subtitulo(item("1", "X", categoria: "Guardado"), seccion: .listas), "Guardado")

        let caido = item("abc", "Canal", web: true)
        XCTAssertTrue(ReglasBiblioteca.caido(caido, idsLista: ["otro"]))
        XCTAssertFalse(ReglasBiblioteca.caido(caido, idsLista: ["abc"]))
        XCTAssertFalse(ReglasBiblioteca.caido(caido, idsLista: []), "Sin lista cargada no se marca nada")
        XCTAssertTrue(ReglasBiblioteca.pie(arranque.library).hasPrefix("4 canales en biblioteca"))
    }

    func testQueEmiteCadaCanalHoy() {
        let reloj = RelojMadrid(fecha: "2026-09-23", minutos: 20 * 60)
        let agenda = FootballSchedule(
            generatedAt: "", timezone: "Europe/Madrid", country: "Spain", source: .demo, attribution: "", demo: true,
            limited: false, partial: false,
            days: [
                FootballDay(
                    date: "2026-09-23",
                    matches: [
                        partido("jugando", "19:30", "LaLiga", local: "Real Madrid", visitante: "Getafe", canales: ["M+ LaLiga TV"]),
                        partido("luego", "22:00", "LaLiga", local: "Betis", visitante: "Sevilla", canales: ["DAZN LaLiga"]),
                        partido("antes", "21:00", "Premier", local: "Arsenal", visitante: "Chelsea", canales: ["DAZN LaLiga"]),
                    ]),
                FootballDay(date: "2026-09-24", matches: [partido("manana", "20:00", "LaLiga", fecha: "2026-09-24", canales: ["DAZN 1"])]),
            ], stale: nil)
        let indice = IndiceAntena(agenda: agenda, reloj: reloj)
        XCTAssertEqual(indice.para(titulo: "M+ LALIGA FHD --> ELCANO", alias: nil, marcadores: [:])?.partido.id, "jugando")
        XCTAssertEqual(indice.para(titulo: "M+ LALIGA FHD --> ELCANO", alias: nil, marcadores: [:])?.enDirecto, true)
        let siguiente = indice.para(titulo: "DAZN LaLiga FHD", alias: nil, marcadores: [:])
        XCTAssertEqual(siguiente?.partido.id, "antes", "El siguiente de hoy, el más cercano")
        XCTAssertEqual(siguiente?.enDirecto, false)
        XCTAssertNil(indice.para(titulo: "DAZN 1", alias: nil, marcadores: [:]), "Mañana no cuenta")
        XCTAssertNil(indice.para(titulo: "DAZN", alias: nil, marcadores: [:]), "La familia no basta")
        let terminado = LiveScore(home: 2, away: 1, state: "post", clock: "", detail: "", confidence: 1)
        XCTAssertNil(indice.para(titulo: "M+ LaLiga TV", alias: nil, marcadores: ["jugando": terminado]))
        XCTAssertEqual(LogoCanal.dorsal("DAZN 1 FHD --> NEW ERA 3"), "1")
        XCTAssertEqual(LogoCanal.dorsal("Eurosport"), "E")
        XCTAssertEqual(LogoCanal.dorsal("Ñ"), "N")
    }
}

/// «Dónde se está reproduciendo»: cómo se cuenta cada sesión.
final class DondeSuenaTests: XCTestCase {
    private func visor(
        _ cliente: ClientKind, dispositivo: String?, visor: String? = nil, nombre: String? = nil, plataforma: ClientKind? = nil,
        reproduciendo: Bool? = nil
    ) -> SessionSummary.Viewer {
        SessionSummary.Viewer(
            client: cliente, deviceId: dispositivo, lastBeatAt: "2026-09-23T18:30:00.000Z", viewerId: visor,
            deviceName: nombre, platform: plataforma, playing: reproduciendo)
    }

    func testEsteDispositivoPorElIdOPorElVisor() {
        XCTAssertTrue(DondeSuena.esEste(visor(.ios, dispositivo: "dev_1"), dispositivo: "dev_1", visorLocal: "ios_x"))
        XCTAssertTrue(DondeSuena.esEste(visor(.ios, dispositivo: nil, visor: "ios_x"), dispositivo: "dev_1", visorLocal: "ios_x"))
        XCTAssertFalse(DondeSuena.esEste(visor(.web, dispositivo: "web_1", visor: "web_v"), dispositivo: "dev_1", visorLocal: "ios_x"))
        XCTAssertFalse(DondeSuena.esEste(visor(.web, dispositivo: nil), dispositivo: nil, visorLocal: "ios_x"))
    }

    func testNombresEIconos() {
        XCTAssertEqual(DondeSuena.nombre(visor(.web, dispositivo: nil, nombre: "Chrome · Windows")), "Chrome · Windows")
        XCTAssertEqual(DondeSuena.icono(visor(.web, dispositivo: nil, nombre: "Chrome · Windows")), "desktopcomputer")
        XCTAssertEqual(DondeSuena.icono(visor(.web, dispositivo: nil, nombre: "Safari · iPhone")), "iphone")
        XCTAssertEqual(DondeSuena.icono(visor(.web, dispositivo: nil, nombre: "Chrome · Android")), "iphone")
        XCTAssertEqual(DondeSuena.icono(visor(.ios, dispositivo: "dev_1", nombre: "iPhone de Isma", plataforma: .ios)), "iphone")
        XCTAssertEqual(DondeSuena.nombre(visor(.web, dispositivo: nil)), "Navegador", "Sin nombre, por su plataforma")
        XCTAssertEqual(DondeSuena.nombre(visor(.ios, dispositivo: "dev_1", nombre: "  ")), "iPhone")
    }

    func testTituloProtocoloYOrden() {
        let aqui = SessionSummary(
            id: "s_1", hash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", mode: .hls, openedAt: "2026-09-23T18:00:00.000Z",
            viewers: [visor(.ios, dispositivo: "dev_1")], title: "", protocolo: .hlsFmp4)
        let alla = SessionSummary(
            id: "s_2", hash: "b2c3d4e5f60718293a4b5c6d7e8f901234567890", mode: .progressive,
            openedAt: "2026-09-23T19:00:00.000Z", viewers: [visor(.web, dispositivo: "web_1")], title: "DAZN 1")
        XCTAssertEqual(DondeSuena.titulo(aqui, conocido: "BOING"), "BOING")
        XCTAssertEqual(DondeSuena.titulo(aqui, conocido: nil), "Canal a1b2c3d4…")
        XCTAssertEqual(DondeSuena.titulo(alla, conocido: "otro"), "DAZN 1")
        XCTAssertEqual(DondeSuena.protocolo(aqui), "HLS para iPhone")
        XCTAssertEqual(DondeSuena.protocolo(alla), "MPEG-TS", "Sin protocolo, por el modo de la sesión")
        XCTAssertEqual(DondeSuena.ordenar([alla, aqui], dispositivo: "dev_1", visorLocal: nil).map(\.id), ["s_1", "s_2"])
        XCTAssertEqual(DondeSuena.ordenar([aqui, alla], dispositivo: nil, visorLocal: nil).map(\.id), ["s_2", "s_1"], "Las más recientes primero")
    }
}

/// El borrador de gustos (preferences/model.ts de la web).
final class GustosEditablesTests: XCTestCase {
    func testMarcarYDesmarcarPorClave() {
        var gustos = GustosFutbol(teams: ["real madrid"])
        gustos = GustosEditables.alternar(gustos, .equipos, "Real Madrid")
        XCTAssertEqual(gustos.teams, [], "«real madrid» es el mismo que «Real Madrid»")
        gustos = GustosEditables.alternar(gustos, .ligas, "LaLiga")
        XCTAssertEqual(gustos.leagues, ["LaLiga"])
    }

    func testAnadirAMano() {
        let (conBarca, nombre) = GustosEditables.anadir(.vacios, .equipos, "  barcelona ")
        XCTAssertEqual(nombre, "Barcelona", "Se marca el chip fijo con esa clave")
        XCTAssertEqual(conBarca.teams, ["Barcelona"])
        let (igual, repetido) = GustosEditables.anadir(conBarca, .equipos, "BARCELONA")
        XCTAssertEqual(igual.teams, ["Barcelona"])
        XCTAssertEqual(repetido, "Barcelona")
        XCTAssertNil(GustosEditables.anadir(.vacios, .equipos, "x").1, "Menos de 2 caracteres no vale")
        let (propio, _) = GustosEditables.anadir(.vacios, .nacionalidades, "Japón")
        XCTAssertEqual(GustosEditables.opciones(propio, .nacionalidades).last, "Japón")
        XCTAssertEqual(GustosEditables.bandera("Japón"), "🌍")
        XCTAssertEqual(GustosEditables.bandera("España"), "🇪🇸")
    }

    func testTopesYLimpieza() {
        let muchas = (1...20).map { "Liga \($0)" }
        let limpias = GustosEditables.limpiar(muchas + ["liga 1", "", "  "], tipo: .ligas)
        XCTAssertEqual(limpias.count, 12, "Como mucho 12 ligas")
        var llenas = GustosFutbol(leagues: limpias)
        llenas = GustosEditables.alternar(llenas, .ligas, "Serie A")
        XCTAssertEqual(llenas.leagues.count, 12, "Con la lista llena no se añade")
    }
}
