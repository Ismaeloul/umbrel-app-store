import Foundation
import Observation

/// Agenda: pinta lo guardado en disco al instante y la refresca después.
@MainActor
@Observable
final class AgendaViewModel {
    private(set) var agenda: FootballSchedule?
    private(set) var actualizadaEn: Date?
    /// Empieza en true para no enseñar «no hay partidos» antes de mirar la caché.
    private(set) var cargando = true
    private(set) var fallo: String?

    private let entorno: Entorno

    init(entorno: Entorno) {
        self.entorno = entorno
    }

    /// Días con algún partido.
    var dias: [FootballDay] {
        agenda?.days.filter { !$0.matches.isEmpty } ?? []
    }

    /// El día que se enseña al abrir: hoy si hay partidos; si no, el primero que venga.
    static func diaInicial(_ fechas: [String], ahora: Date = .now) -> String? {
        let hoy = FormatoAgenda.clave(ahora)
        if fechas.contains(hoy) { return hoy }
        return fechas.first { $0 > hoy } ?? fechas.last
    }

    /// Primero la caché (arranque en frío < 1 s), luego la red.
    func arrancar() async {
        if agenda == nil, let guardada = await entorno.cache.leer(FootballSchedule.self, de: .agenda) {
            agenda = guardada.valor
            actualizadaEn = guardada.guardadoEn
        }
        await refrescar()
    }

    func refrescar() async {
        cargando = true
        defer { cargando = false }
        do {
            let nueva = try await entorno.api.enviar(API.agenda)
            agenda = nueva
            actualizadaEn = .now
            fallo = nil
            try? await entorno.cache.guardar(nueva, en: .agenda)
        } catch {
            let convertido = APIError.desde(error)
            switch convertido {
            case .necesitaEmparejar, .cancelado:
                return
            default:
                fallo = convertido.mensaje
            }
        }
    }
}

/// Los partidos de una competición dentro de un día.
struct GrupoLiga: Hashable, Identifiable {
    var competicion: String
    var pais: String
    var partidos: [FootballMatch]
    var id: String { competicion }
}

/// «Para ti» o «Todos».
enum ModoAgenda: String, Hashable, CaseIterable {
    case paraTi
    case todos
}

/// Fecha y minuto del día en Madrid (`madridClock` de la web).
struct RelojMadrid: Equatable {
    /// `YYYY-MM-DD`.
    var fecha: String
    /// Minutos desde la medianoche de Madrid.
    var minutos: Int

    init(fecha: String, minutos: Int) {
        self.fecha = fecha
        self.minutos = minutos
    }

    init(_ ahora: Date) {
        let c = FormatoAgenda.calendario.dateComponents([.year, .month, .day, .hour, .minute], from: ahora)
        fecha = String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
        minutos = (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }
}

/// Fase de un partido para su insignia y el orden de la agenda.
enum FasePartido: Equatable {
    case directo
    case terminado
    /// Faltan 60 min o menos.
    case pronto
    /// Faltan 6 h o menos.
    case proximo
}

struct EstadoPartido: Equatable {
    var fase: FasePartido
    /// «En directo», «Terminado», «En 48 min», «En 1 h 18 min».
    var texto: String
}

/// Reglas de la agenda portadas de apps/web/src/features/agenda/domain.ts:
/// el reloj de Madrid (no el del teléfono), la insignia de estado, el orden
/// de los grupos y el filtro de «Para ti».
enum ReglasAgenda {
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
            return faltan > -120
                ? EstadoPartido(fase: .directo, texto: "En directo") : EstadoPartido(fase: .terminado, texto: "Terminado")
        }
        if faltan <= 60 { return EstadoPartido(fase: .pronto, texto: "En \(faltan) min") }
        if faltan <= 360 { return EstadoPartido(fase: .proximo, texto: "En \(faltan / 60) h \(faltan % 60) min") }
        return nil
    }

    private static func rango(_ estado: EstadoPartido?) -> Int {
        switch estado?.fase {
        case .directo: 0
        case .terminado: 2
        default: 1
        }
    }

    private static func inicio(_ partido: FootballMatch) -> Double {
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
}

/// Textos de la agenda (fechas en hora de Madrid, como las da el servidor).
enum FormatoAgenda {
    /// `YYYY-MM-DD` de una fecha en Madrid.
    static func clave(_ fecha: Date) -> String {
        let c = calendario.dateComponents([.year, .month, .day], from: fecha)
        return String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
    }

    /// Para la tira de días: «Hoy», «Mañana», «Ayer» o «Jue», y el número del día.
    static func partesDia(_ texto: String, ahora: Date = .now) -> (arriba: String, numero: String) {
        guard let fecha = dia(texto) else { return ("", texto) }
        let cal = calendario
        let numero = String(cal.component(.day, from: fecha))
        if cal.isDate(fecha, inSameDayAs: ahora) { return ("Hoy", numero) }
        if let manana = cal.date(byAdding: .day, value: 1, to: ahora), cal.isDate(fecha, inSameDayAs: manana) {
            return ("Mañana", numero)
        }
        if let ayer = cal.date(byAdding: .day, value: -1, to: ahora), cal.isDate(fecha, inSameDayAs: ayer) {
            return ("Ayer", numero)
        }
        let estilo = Date.FormatStyle(locale: Locale(identifier: "es_ES"), calendar: cal, timeZone: zona)
            .weekday(.abbreviated)
        let corto = fecha.formatted(estilo).replacingOccurrences(of: ".", with: "")
        return (corto.prefix(1).uppercased() + corto.dropFirst(), numero)
    }

    static var zona: TimeZone { TimeZone(identifier: "Europe/Madrid") ?? .current }

    static var calendario: Calendar {
        var calendario = Calendar(identifier: .gregorian)
        calendario.timeZone = zona
        calendario.locale = Locale(identifier: "es_ES")
        return calendario
    }

    /// `YYYY-MM-DD` → mediodía de ese día en Madrid.
    static func dia(_ texto: String) -> Date? {
        let partes = texto.split(separator: "-").compactMap { Int($0) }
        guard partes.count == 3 else { return nil }
        return calendario.date(
            from: DateComponents(year: partes[0], month: partes[1], day: partes[2], hour: 12))
    }

    /// «Hoy», «Mañana», «Ayer» o «jueves, 24 sept».
    static func etiqueta(dia texto: String, ahora: Date = .now) -> String {
        guard let fecha = dia(texto) else { return texto }
        let cal = Self.calendario
        if cal.isDate(fecha, inSameDayAs: ahora) { return "Hoy" }
        if let manana = cal.date(byAdding: .day, value: 1, to: ahora),
            cal.isDate(fecha, inSameDayAs: manana)
        {
            return "Mañana"
        }
        if let ayer = cal.date(byAdding: .day, value: -1, to: ahora),
            cal.isDate(fecha, inSameDayAs: ayer)
        {
            return "Ayer"
        }
        let estilo = Date.FormatStyle(locale: Locale(identifier: "es_ES"), calendar: cal, timeZone: zona)
            .weekday(.wide).day().month(.abbreviated)
        return fecha.formatted(estilo)
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
