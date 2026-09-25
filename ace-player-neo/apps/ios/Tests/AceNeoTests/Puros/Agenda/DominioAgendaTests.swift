import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Casos de apps/web/src/features/agenda/domain.test.ts, cards.test.ts y score-reveal.test.ts portados a
   Swift Testing (M5). «Ahora» = miércoles 23-sep-2026, 20:30 en Madrid (18:30 UTC), como test-utils.tsx. */

enum EjemploAgenda {
    static let ahora = Date(timeIntervalSince1970: 1_790_188_200)
    static let hoy = "2026-09-23"
    static var reloj: RelojMadrid { RelojMadrid(ahora) }

    /// `matchAt`: un partido que empieza `minutos` después de `ahora` (fecha y hora de Madrid).
    static func partido(
        _ minutos: Int, id: String = UUID().uuidString, local: String? = nil, visitante: String? = nil,
        competicion: String = "LaLiga", canales: [String] = ["M+ LaLiga"], conInicio: Bool = true
    ) -> FootballMatch {
        let inicio = ahora.addingTimeInterval(Double(minutos) * 60)
        let reloj = RelojMadrid(inicio)
        let casa = local ?? "Local \(id.prefix(4))"
        let fuera = visitante ?? "Visitante \(id.prefix(4))"
        return FootballMatch(
            id: id, date: reloj.fecha, time: String(format: "%02d:%02d", reloj.minutos / 60, reloj.minutos % 60),
            start: conInicio ? Int64(inicio.timeIntervalSince1970 * 1000) : nil, title: "\(casa) vs \(fuera)",
            home: casa, away: fuera, competition: competicion, country: "Spain",
            channels: canales.enumerated().map { FootballChannelRef(id: "c\($0.offset)", name: $0.element) })
    }

    static func marcador(_ l: Int, _ v: Int, reloj: String = "", detalle: String = "", estado: String = "in")
        -> LiveScore
    {
        LiveScore(home: l, away: v, state: estado, clock: reloj, detail: detalle, confidence: 1)
    }
}

@Suite struct RelojYEstadoTests {
    typealias E = EjemploAgenda

    @Test func relojDeMadrid() {
        #expect(E.reloj == RelojMadrid(fecha: E.hoy, minutos: 20 * 60 + 30))
        #expect(RelojMadrid(Date(timeIntervalSince1970: 1_790_202_600)).fecha == "2026-09-24")  // 22:30 UTC
        #expect(FechasAgenda.hora(E.ahora) == "20:30")
        #expect(FechasAgenda.hora(iso: nil) == nil)
        #expect(FechasAgenda.hora(iso: "no es fecha") == nil)
    }

    @Test func minutosYEstados() {
        let a = { (hora: String) in
            FootballMatch(
                id: "x", date: E.hoy, time: hora, start: nil, title: "", home: "", away: "", competition: "", country: "",
                channels: [])
        }
        #expect(ReglasAgenda.minutosParaPartido(a("21:00"), reloj: E.reloj) == 30)
        #expect(ReglasAgenda.minutosParaPartido(a("Por confirmar"), reloj: E.reloj) == nil)
        #expect(ReglasAgenda.estado(a("20:30"), reloj: E.reloj, marcador: nil) == EstadoPartido(fase: .directo, texto: "En directo"))
        #expect(ReglasAgenda.estado(a("18:31"), reloj: E.reloj, marcador: nil)?.fase == .directo)
        #expect(ReglasAgenda.estado(a("18:30"), reloj: E.reloj, marcador: nil) == EstadoPartido(fase: .terminado, texto: "Terminado"))
        #expect(ReglasAgenda.estado(a("21:18"), reloj: E.reloj, marcador: nil) == EstadoPartido(fase: .pronto, texto: "En 48 min"))
        #expect(ReglasAgenda.estado(a("21:30"), reloj: E.reloj, marcador: nil)?.texto == "En 60 min")
        #expect(ReglasAgenda.estado(a("21:48"), reloj: E.reloj, marcador: nil) == EstadoPartido(fase: .proximo, texto: "En 1 h 18 min"))
        #expect(ReglasAgenda.estado(a("18:00"), reloj: E.reloj, marcador: E.marcador(0, 0))?.fase == .directo)
        #expect(ReglasAgenda.estado(a("20:00"), reloj: E.reloj, marcador: E.marcador(0, 0, estado: "post"))?.fase == .terminado)
        #expect(ReglasAgenda.estado(a("20:00"), reloj: E.reloj, marcador: E.marcador(0, 0, estado: "pre"))?.fase == .directo)
    }

    @Test func unidadesJuntas() {
        #expect(ReglasAgenda.unidadesJuntas("En 2 h 28 min") == "En 2\u{00A0}h 28\u{00A0}min")
        #expect(ReglasAgenda.unidadesJuntas("En 48 min") == "En 48\u{00A0}min")
        #expect(ReglasAgenda.unidadesJuntas("En directo") == "En directo")
    }

    @Test func dias() {
        #expect(ReglasAgenda.etiquetaDia(E.hoy, hoy: E.hoy).principal == "Hoy")
        #expect(ReglasAgenda.etiquetaDia(E.hoy, hoy: E.hoy).numero == "23")
        #expect(ReglasAgenda.etiquetaDia("2026-09-24", hoy: E.hoy).principal == "Mañana")
        #expect(ReglasAgenda.etiquetaDia("2026-09-22", hoy: E.hoy).principal == "Ayer")
        #expect(ReglasAgenda.etiquetaDia("2026-09-25", hoy: E.hoy).principal == "Vie")
        #expect(ReglasAgenda.etiquetaDia("2026-09-25", hoy: E.hoy).larga == "viernes, 25 de septiembre")
        #expect(ReglasAgenda.etiquetaDia("2026-09-30", hoy: E.hoy).principal == "Mié")
        #expect(ReglasAgenda.sumarDias("2026-12-31", 1) == "2027-01-01")
        #expect(ReglasAgenda.sumarDias("2024-03-01", -1) == "2024-02-29")
        let dias = ["2026-09-22", E.hoy, "2026-09-24"]
        #expect(ReglasAgenda.diaPorDefecto(dias, hoy: E.hoy) == E.hoy)
        #expect(ReglasAgenda.diaPorDefecto(["2026-09-24"], hoy: E.hoy) == "2026-09-24")
        #expect(ReglasAgenda.diaPorDefecto([], hoy: E.hoy) == nil)
        #expect(ReglasAgenda.resolverDia(dias, elegido: "2026-09-24", hoy: E.hoy) == "2026-09-24")
        #expect(ReglasAgenda.resolverDia(dias, elegido: "2026-01-01", hoy: E.hoy) == E.hoy)
    }
}

@Suite struct ParaTiYGruposTests {
    typealias E = EjemploAgenda
    let gustos = GustosFutbol(leagues: ["LaLiga"], teams: ["Barcelona"], nationalities: ["España"])

    @Test func modoEfectivo() {
        #expect(ReglasAgenda.modoEfectivo(nil, gustos: .vacios) == .todos)
        #expect(ReglasAgenda.modoEfectivo(.paraTi, gustos: .vacios) == .todos)
        #expect(ReglasAgenda.modoEfectivo(nil, gustos: gustos) == .paraTi)
        #expect(ReglasAgenda.modoEfectivo(.todos, gustos: gustos) == .todos)
    }

    @Test func esLaUnion() {
        let barca = E.partido(0, id: "barca", local: "FC Barcelona", visitante: "Juventus", competicion: "Amistoso")
        let barcaSc = E.partido(0, id: "sc", local: "Barcelona SC", visitante: "Emelec", competicion: "Amistoso")
        let liga = E.partido(0, id: "liga", local: "Real Sociedad", visitante: "Villarreal", competicion: "La Liga EA Sports")
        let espana = E.partido(0, id: "esp", local: "España", visitante: "Marruecos", competicion: "Amistoso")
        let premier = E.partido(0, id: "pl", local: "Arsenal", visitante: "Liverpool", competicion: "Premier League")
        let todos = [barca, barcaSc, liga, espana, premier]
        #expect(ReglasAgenda.visibles(todos, modo: .paraTi, gustos: gustos).map(\.id) == ["barca", "liga", "esp"])
        #expect(ReglasAgenda.visibles(todos, modo: .todos, gustos: gustos).count == 5)
        #expect(ParaTi.destacado(barca, gustos))
        #expect(!ParaTi.destacado(barcaSc, gustos))
    }

    @Test func bloquesPorCompeticion() {
        let terminado = E.partido(-200, id: "done", competicion: "LaLiga")
        let directo = E.partido(-30, id: "live", competicion: "LaLiga")
        let proximo = E.partido(60, id: "next", competicion: "LaLiga")
        let ucl = E.partido(15, id: "ucl", competicion: "Champions League")
        let soloTerminado = E.partido(-300, id: "seriea", competicion: "Serie A")
        let grupos = ReglasAgenda.porCompeticion([terminado, soloTerminado, proximo, ucl, directo], reloj: E.reloj)
        #expect(grupos.map(\.competicion) == ["LaLiga", "Champions League", "Serie A"])
        #expect(grupos.first?.partidos.map(\.id) == ["live", "next", "done"])
        #expect(ReglasAgenda.porCompeticion([E.partido(10, competicion: "")], reloj: E.reloj).first?.competicion == "Fútbol")
    }

    @Test func directosYDestacado() {
        let a = E.partido(-20, id: "a", local: "Girona")
        let b = E.partido(-10, id: "b", local: "Real Madrid")
        let c = E.partido(40, id: "c")
        let mios = GustosFutbol(teams: ["Real Madrid"])
        #expect(ReglasAgenda.enDirecto([a, b, c], reloj: E.reloj, marcadores: [:]) == 2)
        #expect(ReglasAgenda.destacado([a, b, c], reloj: E.reloj, marcadores: [:], gustos: mios)?.id == "b")
        #expect(ReglasAgenda.destacado([a, b, c], reloj: E.reloj, marcadores: [:], gustos: .vacios)?.id == "a")
        #expect(ReglasAgenda.destacado([c], reloj: E.reloj, marcadores: [:], gustos: .vacios)?.id == "c")
        let terminado = E.partido(-300, id: "t")
        #expect(ReglasAgenda.destacado([terminado], reloj: E.reloj, marcadores: [:], gustos: .vacios)?.id == "t")
        #expect(ReglasAgenda.destacado([], reloj: E.reloj, marcadores: [:], gustos: .vacios) == nil)
    }

    @Test func titulo() {
        var partido = E.partido(0, local: "A", visitante: "B")
        partido.title = "A - B"
        #expect(ReglasAgenda.titulo(partido) == "A vs B")
        partido.away = ""
        #expect(ReglasAgenda.titulo(partido) == "A - B")
    }
}

@Suite struct MarcadoresTests {
    typealias E = EjemploAgenda

    @Test func cuandoSePiden() {
        #expect(Marcadores.hacenFalta([E.partido(14)], ahora: E.ahora))
        #expect(!Marcadores.hacenFalta([E.partido(16)], ahora: E.ahora))
        #expect(Marcadores.hacenFalta([E.partido(-209)], ahora: E.ahora))
        #expect(!Marcadores.hacenFalta([E.partido(-211)], ahora: E.ahora))
        #expect(!Marcadores.hacenFalta([E.partido(0, conInicio: false)], ahora: E.ahora))
        #expect(Marcadores.intervalo(["a": E.marcador(0, 0)]) == 8)
        #expect(Marcadores.intervalo(["a": E.marcador(0, 0, estado: "pre")]) == 45)
        #expect(Marcadores.intervalo(nil) == 45)
    }

    @Test func pintableYMinuto() {
        #expect(Marcadores.pintable(E.marcador(0, 0, estado: "pre")) == nil)
        #expect(Marcadores.pintable(E.marcador(1, 0, estado: "post")) != nil)
        #expect(Marcadores.pintable(nil) == nil)
        #expect(Marcadores.minuto(E.marcador(0, 0, reloj: "72'")) == MinutoDirecto(minuto: "72", descanso: false))
        #expect(Marcadores.minuto(E.marcador(0, 0, reloj: "45'+2'")) == MinutoDirecto(minuto: "45+2", descanso: false))
        #expect(Marcadores.minuto(E.marcador(0, 0, reloj: "45'", detalle: "HT")) == MinutoDirecto(minuto: "45", descanso: true))
        #expect(Marcadores.minuto(E.marcador(0, 0, reloj: "", detalle: "Final")) == nil)
        #expect(Marcadores.minuto(E.marcador(0, 0, estado: "post")) == nil)
    }

    @Test func progreso() {
        let partido = E.partido(-30)
        #expect(abs(Marcadores.progreso(partido, ahora: E.ahora, marcador: E.marcador(0, 0, reloj: "45'")) - 0.5) < 0.001)
        #expect(abs(Marcadores.progreso(partido, ahora: E.ahora, marcador: nil) - 30.0 / 90) < 0.001)
        #expect(Marcadores.progreso(partido, ahora: E.ahora, marcador: E.marcador(0, 0, estado: "post")) == 1)
        #expect(Marcadores.progreso(E.partido(-52), ahora: E.ahora, marcador: nil) == 0.5)
    }

    @Test func destapado() {
        #expect(Destapado.estado(E.marcador(1, 0), destapado: false) == .tapado)
        #expect(Destapado.estado(E.marcador(1, 0), destapado: true) == .destapado)
        #expect(Destapado.estado(E.marcador(0, 0, estado: "pre"), destapado: true) == nil)
        #expect(Destapado.estado(nil, destapado: false) == nil)
        let conPartido = CanalReproducible(
            id: "h", titulo: "t", partido: ContextoPartido(id: "p", titulo: "", competicion: "", canal: ""))
        #expect(Destapado.partidoViendo(canal: conPartido, activo: true) == "p")
        #expect(Destapado.partidoViendo(canal: conPartido, activo: false) == nil)
        #expect(Destapado.partidoViendo(canal: CanalReproducible(id: "h", titulo: "t"), activo: true) == nil)
        #expect(Destapado.tapadoFueraDeLaAgenda(viendo: true, destapado: false))
        #expect(!Destapado.tapadoFueraDeLaAgenda(viendo: true, destapado: true))
        #expect(!Destapado.tapadoFueraDeLaAgenda(viendo: false, destapado: false))
    }
}

@Suite struct SenalPartidoTests {
    typealias E = EjemploAgenda

    private func precalentado(_ estado: PreheatStatus, jugables: Int = 0) -> PreheatPublic {
        PreheatPublic(
            matchId: "x", stage: .scan, status: estado, updatedAt: nil, candidateCount: 6, checked: 2, playable: jugables,
            total: 6, error: "")
    }

    private func progreso(_ estado: ScanJobStatus, jugables: Int = 0, reintento: String? = nil) -> ScanProgressData {
        ScanProgressData(
            jobId: "j", kind: .preheat, status: estado, total: 4, checked: 1, playable: jugables, failed: 0, waiting: 0,
            retryAt: reintento, matchId: "x")
    }

    @Test func ventana() {
        #expect(SenalesPartido.enVentana(E.partido(45), ahora: E.ahora))
        #expect(!SenalesPartido.enVentana(E.partido(46), ahora: E.ahora))
        #expect(SenalesPartido.enVentana(E.partido(-120), ahora: E.ahora))
        #expect(!SenalesPartido.enVentana(E.partido(-121), ahora: E.ahora))
    }

    @Test func desdePrecalentado() {
        #expect(SenalesPartido.desdePrecalentado(nil).estado == .pending)
        #expect(SenalesPartido.desdePrecalentado(precalentado(.scanning)).estado == .checking)
        #expect(SenalesPartido.desdePrecalentado(precalentado(.scanning, jugables: 2)).estado == .ok)
        #expect(SenalesPartido.desdePrecalentado(precalentado(.ready, jugables: 3)).resumen == "3 de 6 fuentes verificadas")
        #expect(SenalesPartido.desdePrecalentado(precalentado(.ready)).estado == .fail)
        #expect(SenalesPartido.desdePrecalentado(precalentado(.noSources)) == SenalPartido(estado: .fail, etiqueta: "Sin fuentes", resumen: "No hay fuentes para este partido"))
        #expect(SenalesPartido.desdePrecalentado(precalentado(.scannerOffline)).estado == .pending)
        #expect(SenalesPartido.desdePrecalentado(precalentado(.resolving)).estado == .checking)
        #expect(SenalesPartido.desdePrecalentado(precalentado(.failed)).estado == .fail)
    }

    @Test func desdeComprobacion() {
        #expect(SenalesPartido.desdeComprobacion(progreso(.running))?.estado == .checking)
        #expect(SenalesPartido.desdeComprobacion(progreso(.running, jugables: 1))?.estado == .ok)
        let espera = SenalesPartido.desdeComprobacion(progreso(.waiting, reintento: "2026-09-23T18:51:00.000Z"))
        #expect(espera?.estado == .fail)
        #expect(espera?.etiqueta == "Sin señal · reintento 20:51")
        #expect(SenalesPartido.desdeComprobacion(progreso(.complete))?.estado == .fail)
        #expect(SenalesPartido.desdeComprobacion(progreso(.cancelled)) == nil)
    }

    @Test func peticion() {
        #expect(SenalesPartido.peticion(E.partido(10, canales: []), ahora: E.ahora, terminado: false, comprobacion: nil) == .ninguna)
        #expect(SenalesPartido.peticion(E.partido(10), ahora: E.ahora, terminado: true, comprobacion: nil) == .ninguna)
        #expect(SenalesPartido.peticion(E.partido(10), ahora: E.ahora, terminado: false, comprobacion: nil) == .precalentado)
        #expect(SenalesPartido.peticion(E.partido(120), ahora: E.ahora, terminado: false, comprobacion: nil) == .fija(SenalesPartido.desdePrecalentado(nil)))
        #expect(SenalesPartido.peticion(E.partido(400), ahora: E.ahora, terminado: false, comprobacion: nil) == .ninguna)
        let viva = progreso(.running, jugables: 1)
        #expect(SenalesPartido.peticion(E.partido(400), ahora: E.ahora, terminado: false, comprobacion: viva) == .fija(SenalesPartido.desdeComprobacion(viva)!))
        #expect(SenalesPartido.palabra(SenalPartido(estado: .ok, resumen: "")) == "Señal")
        #expect(SenalesPartido.palabra(SenalPartido(estado: .fail, etiqueta: "Sin fuentes", resumen: "")) == "Sin fuentes")
    }
}

@Suite struct TarjetasYBibliotecaTests {
    typealias E = EjemploAgenda

    private func item(_ titulo: String, id: String, alias: String? = nil) -> Item {
        Item(id: id, title: titulo, alias: alias, type: .web, category: "", date: "2026-09-23T18:30:00.000Z", fromWebSync: true, ih: false)
    }

    @Test func cuando() {
        #expect(TarjetasAgenda.cuando(E.partido(60), reloj: E.reloj, marcador: nil).rotulo == "Hoy 21:30")
        #expect(TarjetasAgenda.cuando(E.partido(1440), reloj: E.reloj, marcador: nil).rotulo == "Mañana 20:30")
        #expect(TarjetasAgenda.cuando(E.partido(-10), reloj: E.reloj, marcador: E.marcador(0, 0, reloj: "13'")).rotulo == "En directo · 13'")
        #expect(TarjetasAgenda.cuando(E.partido(-50), reloj: E.reloj, marcador: E.marcador(0, 0, reloj: "45'", detalle: "HT")).rotulo == "Descanso")
        #expect(TarjetasAgenda.cuando(E.partido(-10), reloj: E.reloj, marcador: nil).rotulo == "En directo")
        #expect(TarjetasAgenda.cuando(E.partido(-300), reloj: E.reloj, marcador: nil).rotulo == "Final")
        var sinHora = E.partido(60)
        sinHora.time = "Por confirmar"
        #expect(TarjetasAgenda.cuando(sinHora, reloj: E.reloj, marcador: nil).rotulo == "Por confirmar")
    }

    @Test func tonosYLados() {
        #expect(TarjetasAgenda.tono(.ok) == .ok)
        #expect(TarjetasAgenda.tono(.checking) == .neutral)
        #expect(TarjetasAgenda.tono(.pending) == .neutral)
        var partido = E.partido(0, local: "Real Madrid", visitante: "")
        partido.title = "Real Madrid (amistoso)"
        #expect(TarjetasAgenda.lado(partido, local: true).nombre == "Real Madrid")
        #expect(TarjetasAgenda.lado(partido, local: false).nombre == "…")
        #expect(ColoresPartido.iniciales("Atlético de Madrid", corto: nil) == "AM")
        #expect(ColoresPartido.iniciales("Tottenham", corto: nil) == "TOT")
        #expect(ColoresPartido.iniciales("Real Madrid", corto: "rma") == "RMA")
        #expect(ColoresPartido.mismoOrigen("/api/v1/x") == "/api/v1/x")
        #expect(ColoresPartido.mismoOrigen("//cdn/x") == nil)
        #expect(ColoresPartido.mismoOrigen("https://x") == nil)
    }

    @Test func parVersus() {
        // Dos rojos (Sevilla–Girona): el visitante pasa a su segundo color.
        let sevilla = ColoresPartido.Paleta(primario: ColoresPartido.hex("#d80919")!, secundario: nil)
        let girona = ColoresPartido.Paleta(primario: ColoresPartido.hex("#cd2534")!, secundario: ColoresPartido.hex("#ffffff"))
        let par = ColoresPartido.parVersus(sevilla, girona)
        #expect(par.visitante == ColoresPartido.hex("#ffffff"))
        // Sin segundo color: se oscurece la mitad más clara.
        let sinSegundo = ColoresPartido.parVersus(sevilla, ColoresPartido.Paleta(primario: ColoresPartido.hex("#cd2534")!, secundario: nil))
        #expect(ColoresPartido.distancia(sinSegundo.local, sinSegundo.visitante) >= 0.1)
        #expect(ColoresPartido.hex("#abc") == ColoresPartido.hex("#aabbcc"))
        #expect(ColoresPartido.hex("nope") == nil)
    }

    @Test func biblioteca70() {
        let biblioteca = LibraryView(
            web: [item("DAZN 1", id: "a"), item("Canal raro", id: "b", alias: "M+ LaLiga TV")], webSyncedAt: nil,
            webSources: [], activeWebSourceId: "", favorites: [item("DAZN 1", id: "a")], history: [])
        let busqueda = BusquedaBiblioteca(biblioteca: biblioteca)
        #expect(busqueda.tamano == 2)
        #expect(busqueda.tiene("DAZN"))
        #expect(!busqueda.tiene("DAZN 2"))
        #expect(busqueda.tiene("M+ LaLiga TV"))
        #expect(!busqueda.tiene("LaLiga TV Hypermotion"))
        let partido = E.partido(0, canales: ["DAZN", "GOL Play"])
        #expect(busqueda.canales(partido) == [InfoCanal(nombre: "DAZN", enBiblioteca: true), InfoCanal(nombre: "GOL Play", enBiblioteca: false)])
    }

    @Test func menuDeLaTarjeta() {
        let partido = E.partido(-10, local: "Real Madrid", visitante: "Getafe", competicion: "Copa del Rey")
        let gustos = Preferences(onboardingComplete: true, country: "Spain", leagues: [], teams: ["Real Madrid"], nationalities: [])
        let menu = OpcionesPartido.menu(partido, disponible: true, marcador: .tapado, gustos: gustos)
        #expect(menu.map(\.opcion.titulo) == ["Ver canal", "Ver marcador", "Dejar de seguir a Real Madrid", "Seguir a Getafe", "Seguir Copa del Rey"])
        #expect(menu[2].opcion.separadaAntes)
        #expect(!menu[3].opcion.separadaAntes)
        let sinCanales = E.partido(10, local: "A", visitante: "B", competicion: "Fútbol", canales: [])
        let otro = OpcionesPartido.menu(sinCanales, disponible: false, marcador: nil, gustos: nil)
        #expect(otro.map(\.opcion.titulo) == ["Seguir a A", "Seguir a B"])
        #expect(!otro[0].opcion.separadaAntes)
        #expect(OpcionesPartido.menu(partido, disponible: false, marcador: .destapado, gustos: nil).prefix(2).map(\.opcion.titulo) == ["Buscar canal", "Tapar el marcador"])
        #expect(OpcionesPartido.etiquetaTarjeta(sinCanales, canales: []) == "A vs B: canal por confirmar")
    }
}
