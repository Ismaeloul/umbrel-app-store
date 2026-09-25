import UIKit
import XCTest

@testable import AceNeo

/* Reglas puras del rediseño «Palco»: colores de la tarjeta versus, chip de
   fecha y hora, cápsula de señal sin sesión, marcador tapado, goles deducidos
   del marcador, secciones y destacado de la agenda, resumen de fuentes,
   escudos en el contrato y la caché de imágenes. */

private func partido(
    _ id: String, _ hora: String, _ competicion: String, local: String = "Local", visitante: String = "Visitante",
    fecha: String = "2026-09-25", canales: [String] = []
) -> FootballMatch {
    FootballMatch(
        id: id, date: fecha, time: hora, start: nil, title: "\(local) - \(visitante)", home: local, away: visitante,
        competition: competicion, country: "",
        channels: canales.enumerated().map { FootballChannelRef(id: "c\($0.offset)", name: $0.element) })
}

private func marcador(_ home: Int, _ away: Int, estado: String = "in", reloj: String = "54'") -> LiveScore {
    LiveScore(home: home, away: away, state: estado, clock: reloj, detail: "", confidence: 1)
}

// MARK: - Tarjeta versus

final class ColoresVersusTests: XCTestCase {
    func testColoresDistintosNoChocan() {
        let blanco = RGB(hex: "#ffffff")!
        let azul = RGB(hex: "#005999")!
        XCTAssertFalse(ColoresVersus.chocan(blanco, azul))
        let eleccion = ColoresVersus.elegir(
            local: TeamColors(primary: "#ffffff", secondary: "#febe10"), visitante: TeamColors(primary: "#005999"),
            nombreLocal: "Real Madrid", nombreVisitante: "Getafe")
        XCTAssertEqual(eleccion.local, blanco)
        XCTAssertEqual(eleccion.visitante, azul)
        XCTAssertFalse(eleccion.oscurecida)
    }

    func testMismoColorUsaElSecundarioDelVisitante() {
        let eleccion = ColoresVersus.elegir(
            local: TeamColors(primary: "#ffffff"), visitante: TeamColors(primary: "#ffffff", secondary: "#f58220"),
            nombreLocal: "Real Madrid", nombreVisitante: "Valencia")
        XCTAssertEqual(eleccion.visitante, RGB(hex: "#f58220"))
        XCTAssertFalse(eleccion.oscurecida)
    }

    func testSinSecundarioQueSirvaSeOscureceLaDerecha() {
        let eleccion = ColoresVersus.elegir(
            local: TeamColors(primary: "#ffffff"), visitante: TeamColors(primary: "#fafafa"),
            nombreLocal: "A", nombreVisitante: "B")
        XCTAssertTrue(eleccion.oscurecida)
        XCTAssertLessThan(eleccion.visitante.luminancia, eleccion.local.luminancia)
        XCTAssertFalse(ColoresVersus.chocan(eleccion.local, eleccion.visitante))
    }

    func testTonoParecidoConLuzParecidaChoca() {
        XCTAssertTrue(ColoresVersus.chocan(RGB(hex: "#ff0000")!, RGB(hex: "#ff2a00")!))
        XCTAssertFalse(ColoresVersus.chocan(RGB(hex: "#ff0000")!, RGB(hex: "#0000ff")!))
        XCTAssertTrue(ColoresVersus.chocan(RGB(hex: "#1d3f9a")!, RGB(hex: "#1f419c")!), "Casi el mismo azul")
    }

    func testSinColoresDelServidorSeUsaElNombre() {
        XCTAssertNil(RGB(hex: "azul"))
        XCTAssertNil(RGB(hex: "#12"))
        let a = ColoresVersus.principal(nil, nombre: "Real Madrid")
        let b = ColoresVersus.principal(nil, nombre: "Real Madrid")
        XCTAssertEqual(a, b, "Determinista")
        XCTAssertNotEqual(a, ColoresVersus.principal(nil, nombre: "Getafe"))
    }

    func testMonograma() {
        XCTAssertEqual(EquipoEscudo(nombre: "Real Madrid", ficha: TeamBadge(id: "1", name: "Real Madrid", short: "RMA")).monograma, "RMA")
        XCTAssertEqual(EquipoEscudo(nombre: "Real Madrid").monograma, "RM")
        XCTAssertEqual(EquipoEscudo(nombre: "Atlético de Madrid").monograma, "AM", "«de» no cuenta")
        XCTAssertEqual(EquipoEscudo(nombre: "Real Club Deportivo").monograma, "RCD")
        XCTAssertEqual(EquipoEscudo(nombre: "Getafe").monograma, "GE")
    }
}

final class ChipHoraTests: XCTestCase {
    func testDiaYHoraLocales() {
        let texto = FormatoAgenda.chipHora(partido("a", "21:00", "LaLiga", fecha: "2026-09-25"), marcador: nil, enDirecto: false)
        XCTAssertEqual(texto, "VIE 21:00")
        XCTAssertEqual(FormatoAgenda.diaSemanaCorto("2026-09-27"), "DOM")
        XCTAssertEqual(FormatoAgenda.diaSemanaCorto("no es fecha"), "")
    }

    func testEnDirectoConMinuto() {
        let texto = FormatoAgenda.chipHora(partido("a", "21:00", "LaLiga"), marcador: marcador(1, 0, reloj: "13'"), enDirecto: true)
        XCTAssertEqual(texto, "EN DIRECTO · 13'")
        XCTAssertEqual(FormatoAgenda.chipHora(partido("a", "21:00", "LaLiga"), marcador: nil, enDirecto: true), "EN DIRECTO")
    }

    func testFinalYPorConfirmar() {
        XCTAssertEqual(
            FormatoAgenda.chipHora(partido("a", "21:00", "LaLiga"), marcador: marcador(2, 1, estado: "post"), enDirecto: false),
            "FINAL")
        XCTAssertEqual(
            FormatoAgenda.chipHora(partido("a", "Por confirmar", "LaLiga", fecha: "2026-09-25"), marcador: nil, enDirecto: false),
            "VIE POR CONFIRMAR")
    }

    func testRelojDelMarcador() {
        XCTAssertEqual(Marcador.reloj(marcador(1, 0, reloj: "54'")), "54'")
        XCTAssertEqual(Marcador.reloj(marcador(1, 0, estado: "post")), "Final")
        XCTAssertEqual(Marcador.texto(marcador(3, 2)), "3–2")
    }
}

// MARK: - Cápsula de señal

final class CapsulaSenalTests: XCTestCase {
    func testSinSesion() {
        XCTAssertEqual(ReglasSenal.capsula(marcador: nil, faltan: 30, resumen: nil)?.texto, "Señal lista")
        XCTAssertEqual(ReglasSenal.capsula(marcador: nil, faltan: 30, resumen: nil)?.tono, .ok)
        XCTAssertEqual(ReglasSenal.capsula(marcador: nil, faltan: 120, resumen: nil)?.texto, "Se comprueba 45 min antes")
        XCTAssertEqual(ReglasSenal.capsula(marcador: nil, faltan: 120, resumen: nil, compacta: true)?.texto, "45 min antes")
        XCTAssertNil(ReglasSenal.capsula(marcador: nil, faltan: 600, resumen: nil), "A más de 6 h no se dice nada")
        XCTAssertEqual(ReglasSenal.capsula(marcador: nil, faltan: -20, resumen: nil)?.texto, "Señal lista", "En juego por la hora")
        XCTAssertEqual(ReglasSenal.capsula(marcador: marcador(0, 0), faltan: 600, resumen: nil)?.texto, "Señal lista", "En juego por ESPN")
        XCTAssertEqual(ReglasSenal.capsula(marcador: marcador(2, 1, estado: "post"), faltan: -130, resumen: nil)?.texto, "Final")
        XCTAssertNil(ReglasSenal.capsula(marcador: nil, faltan: nil, resumen: nil), "Sin hora ni marcador, nada")
    }

    func testConSesionMandaElResumen() {
        let ok = ResumenFuentes(tono: .ok, etiqueta: "Señal", detalle: "2 de 5 verificadas", total: 5, verificadas: 2)
        XCTAssertEqual(ReglasSenal.capsula(marcador: nil, faltan: 30, resumen: ok)?.texto, "Señal")
        XCTAssertEqual(ReglasSenal.capsula(marcador: nil, faltan: 30, resumen: ok)?.punto, true)
        let comprobando = ResumenFuentes(tono: .comprobando, etiqueta: "Comprobando", detalle: "", total: 3, verificadas: 0)
        XCTAssertEqual(ReglasSenal.capsula(marcador: nil, faltan: 600, resumen: comprobando)?.texto, "Comprobando")
        let caidas = ResumenFuentes(tono: .fallo, etiqueta: "Sin señal", detalle: "", total: 3, verificadas: 0)
        XCTAssertEqual(ReglasSenal.capsula(marcador: nil, faltan: 30, resumen: caidas)?.tono, .fallo)
        XCTAssertEqual(
            ReglasSenal.capsula(marcador: nil, faltan: 30, resumen: .vacio)?.texto, "Señal lista",
            "Sin datos del resumen se usa la regla sin sesión")
    }
}

// MARK: - Marcador tapado y goles

final class AntiSpoilerTests: XCTestCase {
    func testSoloSeTapaElQueSeVeYEnJuego() {
        let enJuego = marcador(1, 0)
        XCTAssertTrue(AntiSpoiler.tapado(partido: "a", marcador: enJuego, viendo: "a", destapados: []))
        XCTAssertFalse(AntiSpoiler.tapado(partido: "a", marcador: enJuego, viendo: "b", destapados: []), "Otro partido: se ve")
        XCTAssertFalse(AntiSpoiler.tapado(partido: "a", marcador: enJuego, viendo: nil, destapados: []), "Sin nada sonando: se ve")
        XCTAssertFalse(AntiSpoiler.tapado(partido: "a", marcador: marcador(2, 1, estado: "post"), viendo: "a", destapados: []), "Terminado: se ve")
    }

    func testDestaparYVolverATapar() {
        var destapados: Set<String> = []
        XCTAssertTrue(AntiSpoiler.tapado(partido: "a", marcador: marcador(1, 0), viendo: "a", destapados: destapados))
        destapados.insert("a")
        XCTAssertFalse(AntiSpoiler.tapado(partido: "a", marcador: marcador(1, 0), viendo: "a", destapados: destapados))
        // Al cambiar de canal se vacía el conjunto: se vuelve a tapar.
        destapados = []
        XCTAssertTrue(AntiSpoiler.tapado(partido: "a", marcador: marcador(1, 0), viendo: "a", destapados: destapados))
    }
}

final class RegistroGolesTests: XCTestCase {
    func testAnotaLosGolesQueSuben() {
        let antes = ["a": marcador(0, 0, reloj: "10'")]
        let despues = ["a": marcador(1, 0, reloj: "54'"), "b": marcador(1, 1)]
        let goles = RegistroGoles.anotar(anteriores: antes, nuevos: despues, goles: [:])
        XCTAssertEqual(goles["a"]?.count, 1)
        XCTAssertEqual(goles["a"]?.first?.lado, .local)
        XCTAssertEqual(goles["a"]?.first?.minuto, "54'")
        XCTAssertNil(goles["b"], "Sin lectura anterior no se inventa nada")

        let dosMas = RegistroGoles.anotar(anteriores: despues, nuevos: ["a": marcador(1, 2, reloj: "70'")], goles: goles)
        XCTAssertEqual(dosMas["a"]?.count, 3)
        XCTAssertEqual(dosMas["a"]?.filter { $0.lado == .visitante }.count, 2)
        XCTAssertEqual(Set(dosMas["a"]?.map(\.id) ?? []).count, 3, "Ids distintos aunque sea el mismo minuto")
    }

    func testUnaCorreccionHaciaAbajoBorraLosGoles() {
        let goles = ["a": [Gol(lado: .local, minuto: "54'", orden: 0)]]
        let corregido = RegistroGoles.anotar(anteriores: ["a": marcador(1, 0)], nuevos: ["a": marcador(0, 0)], goles: goles)
        XCTAssertNil(corregido["a"])
    }
}

// MARK: - Agenda

final class SeccionesAgendaTests: XCTestCase {
    /// 25-sep-2026 a las 20:00 en Madrid.
    private let reloj = RelojMadrid(fecha: "2026-09-25", minutos: 20 * 60)

    private var partidos: [FootballMatch] {
        [
            partido("terminado", "16:00", "LaLiga"),
            partido("directo", "19:30", "Premier League", local: "Arsenal", visitante: "Chelsea"),
            partido("proximo2", "22:00", "LaLiga", local: "Villarreal", visitante: "Real Sociedad"),
            partido("proximo1", "21:30", "Copa del Rey", local: "Real Madrid", visitante: "Getafe"),
        ]
    }

    func testEnDirectoProximosYTerminadosPorHora() {
        let fases = ReglasAgenda.porFase(partidos, reloj: reloj)
        XCTAssertEqual(fases.directo.map(\.id), ["directo"])
        XCTAssertEqual(fases.proximos.map(\.id), ["proximo1", "proximo2"])
        XCTAssertEqual(fases.terminados.map(\.id), ["terminado"])
        XCTAssertFalse(fases.vacio)
        XCTAssertTrue(ReglasAgenda.porFase([], reloj: reloj).vacio)
    }

    func testDestacadoDeLaPortada() {
        let gustos = GustosFutbol(leagues: ["LaLiga"], teams: ["Real Madrid"])
        // Lo que se ve manda.
        XCTAssertEqual(
            ReglasAgenda.destacado(partidos, viendo: "proximo2", reloj: reloj, marcadores: [:], gustos: gustos)?.id, "proximo2")
        // Si no, el primero en directo de «Para ti» (la Premier no es tuya)… no hay: el próximo tuyo.
        XCTAssertEqual(ReglasAgenda.destacado(partidos, viendo: nil, reloj: reloj, marcadores: [:], gustos: gustos)?.id, "proximo1")
        // Sin gustos: el primero en directo de todos.
        XCTAssertEqual(ReglasAgenda.destacado(partidos, viendo: nil, reloj: reloj, marcadores: [:], gustos: .vacios)?.id, "directo")
        // Un partido tuyo en directo por ESPN gana.
        let enJuego = ["proximo2": marcador(0, 0)]
        XCTAssertEqual(ReglasAgenda.destacado(partidos, viendo: nil, reloj: reloj, marcadores: enJuego, gustos: gustos)?.id, "proximo2")
        // Solo terminados: el último.
        XCTAssertEqual(
            ReglasAgenda.destacado([partidos[0]], viendo: nil, reloj: reloj, marcadores: [:], gustos: .vacios)?.id, "terminado")
        XCTAssertNil(ReglasAgenda.destacado([], viendo: nil, reloj: reloj, marcadores: [:], gustos: .vacios))
    }

    func testPrecalentables() {
        // En directo (19:30) y a menos de 45 min (20:30); no los de más tarde ni el terminado.
        let lista = partidos + [partido("pronto", "20:30", "LaLiga")]
        XCTAssertEqual(Set(ReglasAgenda.precalentables(lista, reloj: reloj, marcadores: [:]).map(\.id)), ["directo", "pronto"])
        let terminadoPorESPN = ["directo": marcador(2, 1, estado: "post")]
        XCTAssertEqual(ReglasAgenda.precalentables(lista, reloj: reloj, marcadores: terminadoPorESPN).map(\.id), ["pronto"])
    }
}

// MARK: - Fuentes

final class ResumenFuentesTests: XCTestCase {
    private func entrada(_ id: String, _ estado: ScanCandidateState?, kbps: Double? = nil) -> EntradaFuente {
        EntradaFuente(
            id: id, titulo: "M+ LaLiga --> Elcano", ih: false, origen: "m3u", canal: "M+ LaLiga",
            sonda: estado.map { SondaFuente(estado: $0, kbps: kbps) })
    }

    private func efectivos(_ entradas: [EntradaFuente]) -> [String: Efectivo] {
        var resultado: [String: Efectivo] = [:]
        for e in entradas { resultado[e.id] = ReglasFuentes.efectivo(e, pantalla: .nada, ahora: .now) }
        return resultado
    }

    func testResumenParaLaCapsula() {
        XCTAssertEqual(ReglasFuentes.resumen([], efectivos: [:]).tono, .neutro)
        let conVerificada = [entrada("a", .working), entrada("b", .weak), entrada("c", .checking)]
        let r1 = ReglasFuentes.resumen(conVerificada, efectivos: efectivos(conVerificada))
        XCTAssertEqual(r1.tono, .ok)
        XCTAssertEqual(r1.etiqueta, "Señal")
        XCTAssertEqual(r1.detalle, "1 de 3 verificadas")
        let enCola = [entrada("a", .queued), entrada("b", .checking)]
        XCTAssertEqual(ReglasFuentes.resumen(enCola, efectivos: efectivos(enCola)).etiqueta, "Comprobando")
        XCTAssertEqual(ReglasFuentes.resumen(enCola, efectivos: efectivos(enCola)).detalle, "2 fuentes en cola")
        let flojas = [entrada("a", .weak), entrada("b", .failed)]
        XCTAssertEqual(ReglasFuentes.resumen(flojas, efectivos: efectivos(flojas)).tono, .floja)
        let aMedias = [entrada("a", .failed), entrada("b", .checking)]
        XCTAssertEqual(ReglasFuentes.resumen(aMedias, efectivos: efectivos(aMedias)).detalle, "1 de 2 probadas")
        let caidas = [entrada("a", .failed), entrada("b", .failed)]
        XCTAssertEqual(ReglasFuentes.resumen(caidas, efectivos: efectivos(caidas)).etiqueta, "Sin señal")
    }

    func testCalidadPorCaudalYChips() {
        XCTAssertEqual(ReglasFuentes.calidad(SondaFuente(estado: .working, kbps: 6200)), "1080p")
        XCTAssertEqual(ReglasFuentes.calidad(SondaFuente(estado: .working, kbps: 3000)), "720p")
        XCTAssertEqual(ReglasFuentes.calidad(SondaFuente(estado: .working, kbps: 1200)), "576i")
        XCTAssertNil(ReglasFuentes.calidad(SondaFuente(estado: .working)))
        XCTAssertNil(ReglasFuentes.calidad(nil))
        XCTAssertEqual(ReglasFuentes.chipsCartel(entrada("a", .working, kbps: 6200)), "1080p · Elcano")
        XCTAssertEqual(ReglasFuentes.chipsCartel(entrada("a", .working)), "Elcano")
    }

    func testLaSondaGuardaCodecYCaudal() throws {
        let trabajo = try JSONDecoder().decode(ScanJob.self, from: Fixtures.datos("v1/footballScan.json"))
        let sonda = SondaFuente(try XCTUnwrap(trabajo.candidates.first))
        XCTAssertFalse(sonda.codec.isEmpty)
        XCTAssertNotNil(sonda.kbps)
    }

    func testZapeables() {
        let lista = [entrada("a", .working), entrada("b", .failed), entrada("c", .weak)]
        var ef = efectivos(lista)
        XCTAssertEqual(ReglasFuentes.zapeables(lista, efectivos: ef).map(\.id), ["a", "c"])
        ef["a"] = Efectivo(estado: .failed, motivo: "reported", reportada: true)
        XCTAssertEqual(ReglasFuentes.zapeables(lista, efectivos: ef).map(\.id), ["c"])
    }
}

// MARK: - Escudos en el contrato

final class EscudosDecodificacionTests: XCTestCase {
    private let json = #"""
        {"id":"x","date":"2026-09-25","time":"21:00","start":null,"title":"Real Madrid - Getafe","home":"Real Madrid","away":"Getafe","competition":"Copa del Rey","country":"Spain","channels":[],"homeTeam":{"id":"133738","name":"Real Madrid","short":"RMA","crest":"/api/v1/football/teams/133738/crest?v=3f2a","colors":{"primary":"#ffffff","secondary":"#febe10"}},"awayTeam":{"id":"k-getafe","name":"Getafe","short":null,"crest":null,"colors":null},"competitionBadge":{"id":"4335","name":"Spanish La Liga","logo":"/api/v1/football/competitions/4335/logo?v=9b8c"}}
        """#

    func testDecodificaEscudosYColores() throws {
        let partido = try JSONDecoder().decode(FootballMatch.self, from: Data(json.utf8))
        XCTAssertEqual(partido.homeTeam?.short, "RMA")
        XCTAssertEqual(partido.homeTeam?.crest, "/api/v1/football/teams/133738/crest?v=3f2a")
        XCTAssertEqual(partido.homeTeam?.colors?.primary, "#ffffff")
        XCTAssertEqual(partido.homeTeam?.colors?.secondary, "#febe10")
        XCTAssertEqual(partido.awayTeam?.id, "k-getafe")
        XCTAssertNil(partido.awayTeam?.short)
        XCTAssertNil(partido.awayTeam?.crest)
        XCTAssertNil(partido.awayTeam?.colors)
        XCTAssertEqual(partido.competitionBadge?.logo, "/api/v1/football/competitions/4335/logo?v=9b8c")
        XCTAssertNil(try ComparadorJSON.idaYVuelta(FootballMatch.self, Data(json.utf8)), "Ida y vuelta sin perder nada")
        XCTAssertEqual(partido.equipoLocal.monograma, "RMA")
        XCTAssertEqual(partido.equipoVisitante.monograma, "GE")
    }

    func testSinEscudosSigueDecodificando() throws {
        let antiguo = #"{"id":"x","date":"2026-09-25","time":"21:00","start":null,"title":"A - B","home":"A","away":"B","competition":"LaLiga","country":"","channels":[]}"#
        let partido = try JSONDecoder().decode(FootballMatch.self, from: Data(antiguo.utf8))
        XCTAssertNil(partido.homeTeam)
        XCTAssertNil(partido.competitionBadge)
        XCTAssertNil(try ComparadorJSON.idaYVuelta(FootballMatch.self, Data(antiguo.utf8)))
    }

    func testLaAgendaDeEjemploLlevaEscudos() throws {
        let agenda = try JSONDecoder().decode(FootballSchedule.self, from: Fixtures.datos("v1/footballSchedule.json"))
        let conEscudo = agenda.days.flatMap(\.matches).first { $0.homeTeam != nil }
        XCTAssertNotNil(conEscudo, "El ejemplo del contrato trae escudos")
        XCTAssertTrue(conEscudo?.homeTeam?.crest?.hasPrefix("/api/v1/football/teams/") ?? false)
    }
}

// MARK: - Caché de imágenes

final class CacheImagenesTests: XCTestCase {
    private var directorio: URL!

    override func setUp() {
        super.setUp()
        directorio = FileManager.default.temporaryDirectory
            .appendingPathComponent("AceNeoTests-imagenes-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        try? FileManager.default.removeItem(at: directorio)
        super.tearDown()
    }

    private func cache() -> CacheImagenes {
        CacheImagenes(session: MockURLProtocol.sesion(), directorio: directorio) { url in
            var peticion = URLRequest(url: url)
            peticion.setValue("Bearer prueba", forHTTPHeaderField: "Authorization")
            return peticion
        }
    }

    func testMemoriaDiscoYPeticionesUnidas() async throws {
        let descargas = Contador()
        MockURLProtocol.responder { _ in
            descargas.sumar()
            return (200, ["Content-Type": "image/png"], PNGSimulado.circulo(lado: 8, color: (10, 20, 30)))
        }
        let url = URL(string: "http://umbrel.local:7792/native/api/v1/football/teams/1/crest?v=a")!
        let primera = cache()
        XCTAssertNil(primera.enMemoria(url), "Nada en memoria al principio")

        // Dos peticiones a la vez: una sola descarga.
        async let a = primera.imagen(para: url)
        async let b = primera.imagen(para: url)
        let (ia, ib) = await (a, b)
        XCTAssertNotNil(ia)
        XCTAssertNotNil(ib)
        XCTAssertEqual(descargas.actual, 1)
        XCTAssertNotNil(primera.enMemoria(url), "Ya en memoria: se pinta al instante")
        XCTAssertEqual(MockURLProtocol.peticiones.first?.value(forHTTPHeaderField: "Authorization"), "Bearer prueba")

        // Otra instancia (memoria vacía) la saca del disco sin tocar la red.
        let segunda = cache()
        XCTAssertNil(segunda.enMemoria(url))
        let deDisco = await segunda.imagen(para: url)
        XCTAssertNotNil(deDisco)
        XCTAssertEqual(descargas.actual, 1)
        XCTAssertNotNil(segunda.enMemoria(url))
    }

    func testLaMismaImagenPorOtraDireccionTieneLaMismaClave() {
        let lan = URL(string: "http://umbrel.local:7792/native/api/v1/football/teams/1/crest?v=a")!
        let tailscale = URL(string: "http://100.64.0.1:7792/native/api/v1/football/teams/1/crest?v=a")!
        let otraVersion = URL(string: "http://umbrel.local:7792/native/api/v1/football/teams/1/crest?v=b")!
        XCTAssertEqual(CacheImagenes.clave(lan), CacheImagenes.clave(tailscale))
        XCTAssertNotEqual(CacheImagenes.clave(lan), CacheImagenes.clave(otraVersion), "Otra versión, otra imagen")
        XCTAssertEqual(CacheImagenes.clave(lan).count, 64)
    }

    func testUnErrorNoSeGuarda() async {
        let descargas = Contador()
        MockURLProtocol.responder { _ in
            descargas.sumar()
            return (404, ["Content-Type": "application/json"], Prueba.errorJSON("not_found"))
        }
        let url = URL(string: "http://umbrel.local:7792/native/api/v1/football/teams/2/crest?v=a")!
        let almacen = cache()
        let imagen = await almacen.imagen(para: url)
        XCTAssertNil(imagen)
        XCTAssertNil(almacen.enMemoria(url))
        let otraVez = await almacen.imagen(para: url)
        XCTAssertNil(otraVez)
        XCTAssertEqual(descargas.actual, 2, "Sin imagen no hay nada que cachear: se vuelve a pedir")
        let enCurso = await almacen.peticionesEnCurso
        XCTAssertEqual(enCurso, 0)
    }

    func testElPNGSimuladoEsUnaImagen() {
        let datos = PNGSimulado.circulo(lado: 16, color: (255, 0, 0))
        let imagen = UIImage(data: datos)
        XCTAssertNotNil(imagen)
        XCTAssertEqual(imagen?.size.width, 16)
    }
}
