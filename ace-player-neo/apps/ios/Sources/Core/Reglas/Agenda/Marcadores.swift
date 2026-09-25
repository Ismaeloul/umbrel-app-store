import Foundation

/* Marcadores de la agenda (M5; a3 §8.4, §9.3, §6.4.2): cuándo se piden y cada cuánto (`scoresWanted`,
   `scoresInterval`), qué se pinta (`paintableScore`), el minuto (`liveMinute`) y el progreso de la barra
   (`matchProgressAt`), portados de agenda/domain.ts. */

enum Marcadores {
    /// Cada 8 s si hay algo en juego (domain.ts `SCORES_LIVE_MS`).
    static let intervaloDirecto: Double = 8
    /// Cada 45 s si no (`SCORES_IDLE_MS`).
    static let intervaloReposo: Double = 45
    /// Ventana: 15 min antes del inicio a 3,5 h después (`SCORE_BEFORE_MS`, `SCORE_AFTER_MS`).
    static let antesMs: Double = 15 * 60_000
    static let despuesMs: Double = 3.5 * 3_600_000

    /// `scoresWanted`: solo si el día que MIRAS tiene un partido (con `start`) en su ventana.
    static func hacenFalta(_ partidos: [FootballMatch], ahora: Date) -> Bool {
        let ms = ahora.timeIntervalSince1970 * 1000
        return partidos.contains { partido in
            guard let start = partido.start else { return false }
            let inicio = Double(start)
            return ms >= inicio - antesMs && ms <= inicio + despuesMs
        }
    }

    /// `scoresInterval` (segundos).
    static func intervalo(_ marcadores: [String: LiveScore]?) -> Double {
        (marcadores ?? [:]).values.contains { $0.state == "in" } ? intervaloDirecto : intervaloReposo
    }

    /// `paintableScore`: «pre» nunca se pinta (siempre llega 0-0).
    static func pintable(_ marcador: LiveScore?) -> LiveScore? {
        guard let marcador, marcador.state == "in" || marcador.state == "post" else { return nil }
        return marcador
    }

    /// `liveMinute`: «72», «45+2»; descanso si el detalle empieza por ht/half/halftime/descanso/entretiempo.
    static func minuto(_ marcador: LiveScore?) -> MinutoDirecto? {
        guard let marcador, marcador.state == "in" else { return nil }
        let detalle = marcador.detail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for prefijo in ["ht", "half", "halftime", "descanso", "entretiempo"] where detalle.hasPrefix(prefijo) {
            let resto = detalle.dropFirst(prefijo.count)
            if resto.first.map({ !($0.isLetter || $0.isNumber || $0 == "_") }) ?? true {
                return MinutoDirecto(minuto: "45", descanso: true)
            }
        }
        let fuente = marcador.clock.isEmpty ? marcador.detail : marcador.clock
        let limpio = String(fuente.filter { $0 != "'" && $0 != "\u{2019}" && $0 != "\u{2032}" && !$0.isWhitespace })
        let partes = limpio.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        let cifras: (String) -> Bool = { !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } }
        guard let base = partes.first, cifras(base), base.count <= 3 else { return nil }
        if partes.count == 1 { return MinutoDirecto(minuto: base, descanso: false) }
        guard partes.count == 2, cifras(partes[1]), partes[1].count <= 2 else { return nil }
        return MinutoDirecto(minuto: "\(base)+\(partes[1])", descanso: false)
    }

    /// `matchProgressAt`: 0…1 por el minuto; si no, por el reloj (45 + 15 de descanso + 45).
    static func progreso(_ partido: FootballMatch, ahora: Date, marcador: LiveScore?) -> Double {
        if marcador?.state == "post" { return 1 }
        if let minuto = minuto(marcador) {
            if minuto.descanso { return 0.5 }
            let base = Int(minuto.minuto.split(separator: "+").first ?? "") ?? 0
            return min(1, Double(base) / 90)
        }
        guard let start = partido.start else { return 0 }
        let transcurrido = (ahora.timeIntervalSince1970 * 1000 - Double(start)) / 60_000
        if transcurrido <= 0 { return 0 }
        if transcurrido <= 45 { return transcurrido / 90 }
        if transcurrido <= 60 { return 0.5 }
        return min(1, (transcurrido - 15) / 90)
    }
}

/// Lectura del marcador de ESPN (rescatada en la poda; la usan otras pantallas).
enum Marcador {
    /// «54'» o «45'+2'» → 54 / 45.
    static func minuto(_ marcador: LiveScore) -> Int? {
        let cifras = marcador.clock.prefix { $0.isNumber }
        return Int(cifras)
    }

    /// Progreso del partido (0…1) para la barra.
    static func progreso(_ marcador: LiveScore?, inicio: Date?, ahora: Date) -> Double {
        switch marcador?.state {
        case "post": return 1
        case "in": return min(1, Double(marcador.flatMap(minuto) ?? 1) / 90)
        default:
            guard let inicio, ahora > inicio else { return 0 }
            return min(1, ahora.timeIntervalSince(inicio) / (105 * 60))
        }
    }

    /// «1–0».
    static func texto(_ marcador: LiveScore) -> String {
        "\(marcador.home)–\(marcador.away)"
    }

    /// «54'», «Descanso», «Final».
    static func reloj(_ marcador: LiveScore) -> String {
        if marcador.state == "post" { return "Final" }
        let detalle = marcador.detail.lowercased()
        if detalle.contains("descanso") || detalle.contains("halftime") || detalle == "ht" { return "Descanso" }
        return marcador.clock.isEmpty ? "En directo" : marcador.clock
    }
}
