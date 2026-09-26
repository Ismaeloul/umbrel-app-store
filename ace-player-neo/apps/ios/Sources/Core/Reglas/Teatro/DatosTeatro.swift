import Foundation

/* Reglas del teatro de un partido que la web toma de features/agenda/domain.ts (matchStatus, liveMinute,
   paintableScore, matchProgressAt, dayLabel, madridClock, channelInfo) y de MatchHead.tsx, Scoreboard.tsx y
   WhereAired.tsx. Todo en hora de Madrid (a4 §23.3-13). Puro: el «ahora» llega de fuera (Reloj). */

enum FaseTeatro: Sendable, Equatable { case directo, terminado, pronto, proximo }

struct EstadoTeatro: Sendable, Equatable {
    var fase: FaseTeatro
    /// «En directo», «Terminado», «En 48 min», «En 1 h 18 min».
    var texto: String
}

struct MinutoTeatro: Sendable, Equatable {
    /// «72», «45+2».
    var minuto: String
    var descanso: Bool
}

struct CanalEmision: Sendable, Hashable, Identifiable {
    var nombre: String
    var enBiblioteca: Bool
    var id: String { nombre }
}

enum DatosTeatro {
    static let zonaMadrid = TimeZone(identifier: "Europe/Madrid") ?? .current
    /// `LIBRARY_MIN_SCORE` de @ace/shared (domain/channels.ts): un canal de la agenda está en tu biblioteca desde 70.
    static let puntuacionBiblioteca = 70

    private static var calendario: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zonaMadrid
        return c
    }

    /// Fecha (AAAA-MM-DD) y minutos desde la medianoche en Madrid (`madridClock`).
    static func relojMadrid(_ ahora: Date) -> (fecha: String, minutos: Int) {
        let c = calendario.dateComponents([.year, .month, .day, .hour, .minute], from: ahora)
        let fecha = String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
        return (fecha, (c.hour ?? 0) * 60 + (c.minute ?? 0))
    }

    private static func numeroDia(_ iso: String) -> Int? {
        let partes = iso.split(separator: "-").compactMap { Int($0) }
        guard partes.count == 3 else { return nil }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .current
        guard let fecha = utc.date(from: DateComponents(year: partes[0], month: partes[1], day: partes[2])) else {
            return nil
        }
        return Int((fecha.timeIntervalSince1970 / 86_400).rounded(.down))
    }

    /// «HH:MM» → (h, m); nil con «Por confirmar».
    static func hora(_ texto: String) -> (h: Int, m: Int)? {
        let partes = texto.split(separator: ":")
        guard texto.count == 5, partes.count == 2, let h = Int(partes[0]), let m = Int(partes[1]) else { return nil }
        return (h, m)
    }

    /// Minutos que faltan (`minutesToMatch`); negativo si ya empezó.
    static func minutosParaPartido(fecha: String, hora texto: String, ahora: Date) -> Int? {
        let reloj = relojMadrid(ahora)
        guard let h = hora(texto), let dia = numeroDia(fecha), let hoy = numeroDia(reloj.fecha) else { return nil }
        return (dia - hoy) * 1440 + h.h * 60 + h.m - reloj.minutos
    }

    /// `matchStatus`: manda el marcador de ESPN si sabe más que el reloj.
    static func estado(_ partido: FootballMatch, marcador: LiveScore?, ahora: Date) -> EstadoTeatro? {
        if marcador?.state == "in" { return EstadoTeatro(fase: .directo, texto: "En directo") }
        if marcador?.state == "post" { return EstadoTeatro(fase: .terminado, texto: "Terminado") }
        guard let faltan = minutosParaPartido(fecha: partido.date, hora: partido.time, ahora: ahora) else { return nil }
        if faltan <= 0 {
            return faltan > -120
                ? EstadoTeatro(fase: .directo, texto: "En directo") : EstadoTeatro(fase: .terminado, texto: "Terminado")
        }
        if faltan <= 60 { return EstadoTeatro(fase: .pronto, texto: "En \(faltan) min") }
        if faltan <= 360 { return EstadoTeatro(fase: .proximo, texto: "En \(faltan / 60) h \(faltan % 60) min") }
        return nil
    }

    /// «pre» nunca se pinta: siempre llega 0-0 (`paintableScore`).
    static func pintable(_ marcador: LiveScore?) -> LiveScore? {
        guard let marcador, marcador.state == "in" || marcador.state == "post" else { return nil }
        return marcador
    }

    /// Minuto del marcador de ESPN («72'», «45'+2'», «HT»…) (`liveMinute`).
    static func minuto(_ marcador: LiveScore?) -> MinutoTeatro? {
        guard let marcador, marcador.state == "in" else { return nil }
        let detalle = marcador.detail.trimmingCharacters(in: .whitespaces)
        let descanso = #"^(ht|half|halftime|descanso|entretiempo)\b"#
        if detalle.range(of: descanso, options: [.regularExpression, .caseInsensitive]) != nil {
            return MinutoTeatro(minuto: "45", descanso: true)
        }
        let fuente = marcador.clock.isEmpty ? detalle : marcador.clock
        let limpio = fuente.replacingOccurrences(of: #"['’′\s]"#, with: "", options: .regularExpression)
        let partes = limpio.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        guard let base = partes.first, (1...3).contains(base.count), Int(base) != nil else { return nil }
        if partes.count == 1 { return MinutoTeatro(minuto: String(Int(base) ?? 0), descanso: false) }
        guard partes.count == 2, (1...2).contains(partes[1].count), Int(partes[1]) != nil else { return nil }
        return MinutoTeatro(minuto: "\(Int(base) ?? 0)+\(partes[1])", descanso: false)
    }

    /// El estado del kicker: «En directo · 72'», «Descanso», «Final», «En 48 min» o la hora (`statusLine`).
    static func lineaEstado(_ partido: FootballMatch, marcador: LiveScore?, ahora: Date) -> String {
        let estado = estado(partido, marcador: marcador, ahora: ahora)
        if estado?.fase == .directo {
            guard let m = minuto(marcador) else { return "En directo" }
            return m.descanso ? "Descanso" : "En directo · \(m.minuto)'"
        }
        if estado?.fase == .terminado { return "Final" }
        if let estado { return estado.texto }
        return hora(partido.time) != nil ? partido.time : "Hora por confirmar"
    }

    /// «AMISTOSO · EN DIRECTO · 61'» (en mayúsculas lo pone el estilo).
    static func kicker(_ partido: FootballMatch, marcador: LiveScore?, ahora: Date) -> String {
        [partido.competition, lineaEstado(partido, marcador: marcador, ahora: ahora)].filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    /// El título que se lee: «Local vs Visitante» o el `title` si no hay visitante (`matchTitle`).
    static func tituloLectura(_ partido: FootballMatch) -> String {
        partido.away.isEmpty ? partido.title : "\(partido.home) vs \(partido.away)"
    }

    /// «FC Barcelona 1, Juventus 1[, final]».
    static func etiquetaMarcador(_ partido: FootballMatch, _ marcador: LiveScore, terminado: Bool) -> String {
        let visitante = partido.away.isEmpty ? "visitante" : partido.away
        return "\(partido.home) \(marcador.home), \(visitante) \(marcador.away)\(terminado ? ", final" : "")"
    }

    /// Progreso 0…1 de la barra del partido (`matchProgressAt`).
    static func progreso(_ partido: FootballMatch, marcador: LiveScore?, ahora: Date) -> Double {
        if marcador?.state == "post" { return 1 }
        if let m = minuto(marcador) {
            if m.descanso { return 0.5 }
            let base = Int(m.minuto.split(separator: "+").first ?? "") ?? 0
            return min(1, Double(base) / 90)
        }
        guard let inicio = partido.start else { return 0 }
        let pasados = (ahora.timeIntervalSince1970 * 1000 - Double(inicio)) / 60_000
        if pasados <= 0 { return 0 }
        if pasados <= 45 { return pasados / 90 }
        if pasados <= 60 { return 0.5 }
        return min(1, (pasados - 15) / 90)
    }

    /// Cifra y unidad juntas al pintar («En 2 h 28 min» → espacios duros; `keepUnitsTogether`).
    static func unidadesJuntas(_ texto: String) -> String {
        texto.replacingOccurrences(of: #"(\d+) (h|min)\b"#, with: "$1\u{00A0}$2", options: .regularExpression)
    }

    private static let diasCortos = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]
    private static let diasLargos = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
    private static let mesesCortos = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"]
    private static let mesesLargos = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
        "noviembre", "diciembre",
    ]

    /// `dayLabel`: «Hoy»/«Mañana»/«Ayer» o «Jue», «26 sept» y «jueves, 24 de septiembre».
    static func dia(_ fecha: String, hoy: String) -> (principal: String, secundario: String, largo: String) {
        guard let n = numeroDia(fecha), let h = numeroDia(hoy) else { return (fecha, fecha, fecha) }
        let partes = fecha.split(separator: "-").compactMap { Int($0) }
        let semana = ((n + 4) % 7 + 7) % 7  // 1970-01-01 fue jueves
        let mes = max(0, min(11, partes[1] - 1))
        let principal = nombreDia(n - h, semana: semana)
        let secundario = "\(partes[2]) \(mesesCortos[mes])"
        return (principal, secundario, "\(diasLargos[semana]), \(partes[2]) de \(mesesLargos[mes])")
    }

    private static func nombreDia(_ diferencia: Int, semana: Int) -> String {
        switch diferencia {
        case 0: return "Hoy"
        case 1: return "Mañana"
        case -1: return "Ayer"
        default:
            let corto: String = diasCortos[semana]
            let inicial: String = corto.prefix(1).uppercased()
            return inicial + String(corto.dropFirst())
        }
    }

    /// El pie de «Dónde se emite»: «Amistoso · Hoy, 21:00» (WhereAired.tsx).
    static func pieEmision(_ partido: FootballMatch, hoy: String) -> String {
        let d = dia(partido.date, hoy: hoy)
        let dia = ["Hoy", "Mañana", "Ayer"].contains(d.principal) ? d.principal : "\(d.principal) \(d.secundario)"
        let cuando = hora(partido.time) != nil ? "\(dia), \(partido.time)" : "\(dia), hora por confirmar"
        return [partido.competition, cuando].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// `channelInfo`: los canales anunciados y si están en tu biblioteca (≥ 70 por nombre o tvg-id).
    static func canales(_ partido: FootballMatch, biblioteca: [Item]) -> [CanalEmision] {
        // Por pasos y con tipos: en una sola cadena tardaba 220 ms en tiparse en la CI (36228460732).
        var nombres: [String] = []
        for item in biblioteca {
            nombres.append(item.title)
            if let alias = item.alias { nombres.append(alias) }
        }
        let claves: [String] = nombres.map { (nombre: String) -> String in Canales.clave(nombre) }.filter { !$0.isEmpty }
        var vistos = Set<String>()
        var resultado: [CanalEmision] = []
        for canal in partido.channels where !canal.name.isEmpty && vistos.insert(canal.name).inserted {
            let buscada: String = Canales.clave(canal.name)
            let esta: Bool = !buscada.isEmpty && claves.contains { (clave: String) -> Bool in
                Canales.puntuacionDeClaves(buscada, clave) >= puntuacionBiblioteca
            }
            resultado.append(CanalEmision(nombre: canal.name, enBiblioteca: esta))
        }
        return resultado
    }
}
