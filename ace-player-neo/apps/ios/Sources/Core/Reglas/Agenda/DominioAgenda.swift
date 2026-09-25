import Foundation

// Port de apps/web/src/features/agenda/domain.ts (M5; a3 §9). Parte vino rescatada en la poda (fase 0.2,
// b-arquitectura §1.11) de Features/Agenda/AgendaViewModel.swift; M5 la revalida con los casos de
// domain.test.ts (Tests/AceNeoTests/Puros/Agenda). Todo con la hora de MADRID (regla 28): quien llama pasa
// la hora (R14). `FormatoAgenda.equipos` lo usa también la sesión de fuentes rescatada (M3).

/// Los partidos de una competición dentro de un día (`CompetitionGroup`).
struct GrupoLiga: Hashable, Identifiable {
    var competicion: String
    var pais: String
    var partidos: [FootballMatch]
    var id: String { competicion }
}

/// «Para ti» o «Todos» (`AgendaMode`).
enum ModoAgenda: String, Hashable, CaseIterable, Sendable {
    case paraTi
    case todos
}

/// Fase de un partido (`MatchPhase`: live · done · soon · next).
enum FasePartido: Equatable, Sendable {
    case directo
    case terminado
    /// Faltan 60 min o menos.
    case pronto
    /// Faltan 6 h o menos.
    case proximo
}

/// `MatchStatus`.
struct EstadoPartido: Equatable, Sendable {
    var fase: FasePartido
    /// «En directo», «Terminado», «En 48 min», «En 1 h 18 min».
    var texto: String
}

/// Minuto de un partido en juego (`LiveMinute`): «72», «45+2» (sin comillas).
struct MinutoDirecto: Equatable, Sendable {
    var minuto: String
    var descanso: Bool
}

/// Etiquetas de un día (`DayLabel`).
struct EtiquetaDia: Equatable, Sendable {
    /// «Hoy», «Mañana», «Ayer» o el día abreviado («Jue»).
    var principal: String
    /// Número del día («23»).
    var numero: String
    /// «jueves, 24 de septiembre» (lectores de pantalla y resumen).
    var larga: String
}

/// Un canal del partido y si está en tu biblioteca (`ChannelInfo`).
struct InfoCanal: Equatable, Hashable, Sendable {
    var nombre: String
    var enBiblioteca: Bool
}

enum ReglasAgenda {
    /// Minutos de ventana de un partido sin marcador (en directo hasta 120 min después del inicio).
    static let ventanaDirecto = 120

    /// `defaultDay`: hoy si la agenda lo trae; si no, el primero.
    static func diaPorDefecto(_ fechas: [String], hoy: String) -> String? {
        if fechas.contains(hoy) { return hoy }
        return fechas.first
    }

    /// `resolveDay`: el elegido sigue existiendo; si no, el de por defecto.
    static func resolverDia(_ fechas: [String], elegido: String?, hoy: String) -> String? {
        if let elegido, fechas.contains(elegido) { return elegido }
        return diaPorDefecto(fechas, hoy: hoy)
    }

    /// El día que se enseña al abrir (compatibilidad: `defaultDay` con la hora).
    static func diaInicial(_ fechas: [String], ahora: Date) -> String? {
        diaPorDefecto(fechas, hoy: RelojMadrid(ahora).fecha)
    }

    /// Días desde el 1-1-1970 de una fecha `YYYY-MM-DD` (sin husos).
    static func numeroDia(_ texto: String) -> Int? {
        let partes = texto.split(separator: "-", omittingEmptySubsequences: false)
        guard partes.count == 3, partes[0].count == 4, partes[1].count == 2, partes[2].count == 2,
            partes.allSatisfy({ $0.allSatisfy { $0.isASCII && $0.isNumber } }),
            let a = Int(partes[0]), let m = Int(partes[1]), let d = Int(partes[2])
        else { return nil }
        // Días desde la época civil (algoritmo de Howard Hinnant).
        let y = m <= 2 ? a - 1 : a
        let era = (y >= 0 ? y : y - 399) / 400
        let anoEra = y - era * 400
        let diaAno = (153 * ((m + 9) % 12) + 2) / 5 + d - 1
        let diaEra = anoEra * 365 + anoEra / 4 - anoEra / 100 + diaAno
        return era * 146_097 + diaEra - 719_468
    }

    /// `YYYY-MM-DD` de un número de día (inverso de `numeroDia`).
    static func fecha(numeroDia z0: Int) -> String {
        let z = z0 + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        let y = yoe + era * 400 + (m <= 2 ? 1 : 0)
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    /// `addDays`: YYYY-MM-DD desplazado `dias` días.
    static func sumarDias(_ fecha: String, _ dias: Int) -> String {
        guard let base = numeroDia(fecha) else { return fecha }
        return self.fecha(numeroDia: base + dias)
    }

    /// «HH:MM» → minutos desde medianoche (nil con «Por confirmar»).
    static func minutosDeHora(_ hora: String) -> Int? {
        let partes = hora.split(separator: ":", omittingEmptySubsequences: false)
        guard partes.count == 2, partes[0].count == 2, partes[1].count == 2,
            partes.allSatisfy({ $0.allSatisfy { $0.isASCII && $0.isNumber } }),
            let h = Int(partes[0]), let m = Int(partes[1])
        else { return nil }
        return h * 60 + m
    }

    /// `minutesToMatch`: minutos que faltan (negativo si ya empezó).
    static func minutosParaPartido(_ partido: FootballMatch, reloj: RelojMadrid) -> Int? {
        guard let minutos = minutosDeHora(partido.time), let dia = numeroDia(partido.date),
            let hoy = numeroDia(reloj.fecha)
        else { return nil }
        return (dia - hoy) * 1440 + minutos - reloj.minutos
    }

    /// `matchStatus`: en directo desde el inicio hasta 120 min después; el marcador de ESPN manda si llega.
    static func estado(_ partido: FootballMatch, reloj: RelojMadrid, marcador: LiveScore?) -> EstadoPartido? {
        if marcador?.state == "in" { return EstadoPartido(fase: .directo, texto: "En directo") }
        if marcador?.state == "post" { return EstadoPartido(fase: .terminado, texto: "Terminado") }
        guard let faltan = minutosParaPartido(partido, reloj: reloj) else { return nil }
        if faltan <= 0 {
            return faltan > -ventanaDirecto
                ? EstadoPartido(fase: .directo, texto: "En directo") : EstadoPartido(fase: .terminado, texto: "Terminado")
        }
        if faltan <= 60 { return EstadoPartido(fase: .pronto, texto: "En \(faltan) min") }
        if faltan <= 360 { return EstadoPartido(fase: .proximo, texto: "En \(faltan / 60) h \(faltan % 60) min") }
        return nil
    }

    /// `keepUnitsTogether`: cifra y unidad unidas por espacio duro al pintar («En 2 h 28 min»).
    static func unidadesJuntas(_ texto: String) -> String {
        let palabras = texto.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        var salida = ""
        for (i, palabra) in palabras.enumerated() {
            if i > 0 {
                let anterior = palabras[i - 1]
                let esUnidad = palabra == "h" || palabra == "min"
                let esCifra = !anterior.isEmpty && anterior.allSatisfy { $0.isASCII && $0.isNumber }
                salida += esUnidad && esCifra ? "\u{00A0}" : " "
            }
            salida += palabra
        }
        return salida
    }

    private static func rango(_ estado: EstadoPartido?) -> Int {
        switch estado?.fase {
        case .directo: 0
        case .terminado: 2
        default: 1
        }
    }

    /// `startOf`: inicio en ms (o fecha + hora aproximada, solo para ordenar el mismo día).
    static func inicio(_ partido: FootballMatch) -> Double {
        if let start = partido.start { return Double(start) }
        guard let minutos = minutosDeHora(partido.time), let dia = numeroDia(partido.date) else { return .infinity }
        return Double(dia) * 86_400_000 + Double(minutos) * 60_000
    }

    /// `groupByCompetition`: un bloque por competición; dentro, los que van en
    /// directo, luego los próximos y los terminados al final, cada tramo por
    /// hora. Los bloques salen en el orden de su primer partido pendiente.
    private struct Decorado {
        let partido: FootballMatch
        let indice: Int
        let rango: Int
        let inicio: Double
    }

    static func porCompeticion(
        _ partidos: [FootballMatch], reloj: RelojMadrid, marcadores: [String: LiveScore] = [:]
    ) -> [GrupoLiga] {
        var decorados: [Decorado] = []
        for (indice, partido) in partidos.enumerated() {
            let fase = rango(estado(partido, reloj: reloj, marcador: marcadores[partido.id]))
            decorados.append(Decorado(partido: partido, indice: indice, rango: fase, inicio: inicio(partido)))
        }
        decorados.sort { a, b in
            if a.rango != b.rango { return a.rango < b.rango }
            if a.inicio != b.inicio { return a.inicio < b.inicio }
            return a.indice < b.indice
        }
        var grupos: [GrupoLiga] = []
        var posicion: [String: Int] = [:]
        for item in decorados {
            let limpio = item.partido.competition.trimmingCharacters(in: .whitespacesAndNewlines)
            let nombre = limpio.isEmpty ? "Fútbol" : limpio
            if let indice = posicion[nombre] {
                grupos[indice].partidos.append(item.partido)
            } else {
                posicion[nombre] = grupos.count
                grupos.append(GrupoLiga(competicion: nombre, pais: item.partido.country, partidos: [item.partido]))
            }
        }
        // Ya van en el orden de su primer partido (el decorado está ordenado).
        return grupos
    }

    /// `countLive`: cuántos van en directo.
    static func enDirecto(_ partidos: [FootballMatch], reloj: RelojMadrid, marcadores: [String: LiveScore]) -> Int {
        partidos.filter { estado($0, reloj: reloj, marcador: marcadores[$0.id])?.fase == .directo }.count
    }

    /// `featuredMatch`: tu equipo en directo → cualquiera en directo → el próximo no terminado → el primero.
    static func destacado(
        _ partidos: [FootballMatch], reloj: RelojMadrid, marcadores: [String: LiveScore], gustos: GustosFutbol
    ) -> FootballMatch? {
        let conEstado = partidos.map { ($0, estado($0, reloj: reloj, marcador: marcadores[$0.id])) }
        let directos = conEstado.filter { $0.1?.fase == .directo }.map(\.0)
        if let mio = directos.first(where: { ParaTi.destacado($0, gustos) }) { return mio }
        if let primero = directos.first { return primero }
        let pendientes = conEstado.filter { $0.1?.fase != .terminado }.map(\.0)
        let ordenados = pendientes.enumerated().sorted { a, b in
            let ia = inicio(a.element)
            let ib = inicio(b.element)
            return ia != ib ? ia < ib : a.offset < b.offset
        }
        return ordenados.first?.element ?? partidos.first
    }

    /// `effectiveMode`: «Para ti» solo si hay gustos; si no se ha tocado, con gustos se abre en «Para ti».
    static func modoEfectivo(_ querido: ModoAgenda?, gustos: GustosFutbol) -> ModoAgenda {
        guard ParaTi.tieneGustos(gustos) else { return .todos }
        return querido ?? .paraTi
    }

    /// `visibleMatches`: los del día con el filtro, en el orden de la agenda.
    static func visibles(_ partidos: [FootballMatch], modo: ModoAgenda, gustos: GustosFutbol) -> [FootballMatch] {
        guard modo == .paraTi, ParaTi.tieneGustos(gustos) else { return partidos }
        return partidos.filter { ParaTi.enParaTi($0, gustos) }
    }

    /// `matchTitle`: «Local vs Visitante» o el `title` si no hay visitante.
    static func titulo(_ partido: FootballMatch) -> String {
        partido.away.isEmpty ? partido.title : "\(partido.home) vs \(partido.away)"
    }

    /// `dayLabel`: «Hoy», «Mañana», «Ayer» o el día abreviado; el número y la etiqueta larga.
    static func etiquetaDia(_ fecha: String, hoy: String) -> EtiquetaDia {
        guard let dia = numeroDia(fecha) else { return EtiquetaDia(principal: fecha, numero: "", larga: fecha) }
        let partes = fecha.split(separator: "-")
        let numero = String(Int(partes[2]) ?? 0)
        let mes = Int(partes[1]) ?? 1
        // 1-1-1970 fue jueves: 0 = jueves.
        let semana = ((dia % 7) + 7 + 4) % 7  // 0 = domingo
        let principal: String
        if fecha == hoy {
            principal = "Hoy"
        } else if fecha == sumarDias(hoy, 1) {
            principal = "Mañana"
        } else if fecha == sumarDias(hoy, -1) {
            principal = "Ayer"
        } else {
            principal = FechasAgenda.diasCortos[semana]
        }
        let larga = "\(FechasAgenda.diasLargos[semana]), \(numero) de \(FechasAgenda.meses[mes - 1])"
        return EtiquetaDia(principal: principal, numero: numero, larga: larga)
    }
}

/// Deslizar a los lados para cambiar de día (agenda) o de pestaña (Canales): `classifySwipe` de lib/gestures.ts
/// con el eje x (a3 §6.7, a5 §3.4). Propio de M5 hasta que llegue `Deslizamiento` (M2, Core/Reglas/Gestos).
enum GestoLateral {
    /// Distancia que cuenta (`threshold`), velocidad (0,45 pt/ms) con al menos 24 pt, y eje dominante 1,4×.
    static let umbral = 56.0
    static let velocidad = 450.0
    static let minimoRapido = 24.0

    /// +1 = siguiente (el dedo va a la izquierda), −1 = anterior, 0 = nada.
    static func paso(dx: Double, dy: Double, vx: Double) -> Int {
        let ax = abs(dx)
        let ay = abs(dy)
        let lejos = max(ax, ay) >= umbral || (abs(vx) >= velocidad && max(ax, ay) >= minimoRapido)
        guard lejos, ax > ay * 1.4 else { return 0 }
        return dx < 0 ? 1 : -1
    }

    /// Mientras arrastras la lista de la agenda: `clamp(dx × 0,3, −60, +60)`.
    static func resistencia(_ dx: Double) -> Double { min(60, max(-60, dx * 0.3)) }
}

/// Tablas propias (como `Intl` en es-ES: «Jue», «jueves», «septiembre»): no dependen del idioma del iPhone.
enum FechasAgenda {
    static let diasCortos = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
    static let diasLargos = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
    static let meses = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
        "noviembre", "diciembre",
    ]

    /// «20:51» en hora de Madrid (`madridHour`).
    static func hora(_ fecha: Date) -> String {
        let reloj = RelojMadrid(fecha)
        return String(format: "%02d:%02d", reloj.minutos / 60, reloj.minutos % 60)
    }

    /// `madridHour` de un texto ISO (nil si no es fecha).
    static func hora(iso: String?) -> String? {
        guard let iso, let fecha = FechaISO.parse(iso) else { return nil }
        return hora(fecha)
    }
}

/// «¿Está este canal en tu biblioteca?» (`buildLibraryLookup`): directorio activo + favoritos + recientes,
/// sin repetir, por título y alias, con `channelMatchScore ≥ 70` (`LIBRARY_MIN_SCORE`).
struct BusquedaBiblioteca: Sendable {
    static let puntuacionMinima = 70
    static let vacia = BusquedaBiblioteca(biblioteca: nil)

    private let claves: [String]
    let tamano: Int

    init(biblioteca: LibraryView?) {
        var vistos = Set<String>()
        var claves: [String] = []
        let todos = (biblioteca?.web ?? []) + (biblioteca?.favorites ?? []) + (biblioteca?.history ?? [])
        for item in todos where !item.id.isEmpty && !vistos.contains(item.id) {
            vistos.insert(item.id)
            for nombre in [item.title, item.alias].compactMap({ $0 }) {
                let clave = Canales.clave(nombre)
                if !clave.isEmpty { claves.append(clave) }
            }
        }
        self.claves = claves
        tamano = vistos.count
    }

    func tiene(_ canal: String) -> Bool {
        let buscada = Canales.clave(canal)
        guard !buscada.isEmpty else { return false }
        return claves.contains { Canales.puntuacionDeClaves(buscada, $0) >= Self.puntuacionMinima }
    }

    /// `channelInfo`: los canales del partido y si están en tu biblioteca.
    func canales(_ partido: FootballMatch) -> [InfoCanal] {
        partido.channels.map(\.name).filter { !$0.isEmpty }.map { InfoCanal(nombre: $0, enBiblioteca: tiene($0)) }
    }
}

/// Textos de la agenda (fechas en hora de Madrid, como las da el servidor).
enum FormatoAgenda {
    /// `YYYY-MM-DD` de una fecha en Madrid.
    static func clave(_ fecha: Date) -> String { RelojMadrid(fecha).fecha }

    /// Para la tira de días: «Hoy», «Mañana», «Ayer» o «Jue», y el número del día.
    static func partesDia(_ texto: String, ahora: Date) -> (arriba: String, numero: String) {
        let etiqueta = ReglasAgenda.etiquetaDia(texto, hoy: clave(ahora))
        return (etiqueta.principal, etiqueta.numero.isEmpty ? texto : etiqueta.numero)
    }

    static var zona: TimeZone { TimeZone(identifier: "Europe/Madrid") ?? .current }

    static var calendario: Calendar {
        var calendario = Calendar(identifier: .gregorian)
        calendario.timeZone = zona
        calendario.locale = Locale(identifier: "es_ES")
        return calendario
    }

    /// «Hoy», «Mañana», «Ayer» o «sábado, 26 sept» (etiqueta corta de un día).
    static func etiqueta(dia texto: String, ahora: Date) -> String {
        guard let numero = ReglasAgenda.numeroDia(texto) else { return texto }
        let hoy = clave(ahora)
        let etiqueta = ReglasAgenda.etiquetaDia(texto, hoy: hoy)
        if ["Hoy", "Mañana", "Ayer"].contains(etiqueta.principal) { return etiqueta.principal }
        let semana = ((numero % 7) + 7 + 4) % 7
        let mes = Int(texto.split(separator: "-")[1]) ?? 1
        let corto = FechasAgenda.meses[mes - 1] == "septiembre" ? "sept" : String(FechasAgenda.meses[mes - 1].prefix(3))
        return "\(FechasAgenda.diasLargos[semana]), \(etiqueta.numero) \(corto)"
    }

    /// «Local – Visitante», o el título si no se pudo separar.
    static func equipos(_ partido: FootballMatch) -> String {
        partido.away.isEmpty ? partido.title : "\(partido.home) – \(partido.away)"
    }

    /// «LaLiga · M+ LaLiga, DAZN 1».
    static func detalle(_ partido: FootballMatch) -> String {
        let canales = partido.channels.map(\.name).joined(separator: ", ")
        return canales.isEmpty ? partido.competition : "\(partido.competition) · \(canales)"
    }

    /// «1 partido» / «3 partidos».
    static func partidos(_ n: Int) -> String {
        n == 1 ? "1 partido" : "\(n) partidos"
    }
}
