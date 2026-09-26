import Foundation

/* Números y tiempos en lenguaje claro de Ajustes (health/model.ts: `plural`, `seconds`, `formatUptime`,
   `clock`, `formatWhen`; devices/model.ts y directories/model.ts los usan también). Con el reloj y la
   zona horaria DEL DISPOSITIVO (a7 §14.2), no de Madrid: quien llama pasa el calendario (los tests,
   uno con zona fija). */

enum TiemposSalud {
    /// Meses cortos de `Intl` es-ES sin punto (health/model.ts `MONTHS`).
    static let meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"]

    /// «1 partido», «3 partidos».
    static func plural(_ n: Int, _ uno: String, _ varios: String) -> String {
        "\(n) \(n == 1 ? uno : varios)"
    }

    /// 2300 → «2,3 s»; 800 → «0,8 s»; 4000 → «4 s» (`Intl.NumberFormat` es-ES, un decimal como mucho).
    static func segundos(_ ms: Double) -> String {
        let decimas = (ms / 100).rounded()
        let entero = Int(decimas / 10)
        let resto = Int(abs(decimas.truncatingRemainder(dividingBy: 10)))
        return resto == 0 ? "\(entero) s" : "\(entero),\(resto) s"
    }

    /// Tiempo activo del backend: «12 min», «3 h 5 min», «3 h», «4 días».
    static func tiempoActivo(_ segundosTotales: Int) -> String {
        let minutos = max(0, segundosTotales / 60)
        if minutos < 60 { return "\(minutos) min" }
        let horas = minutos / 60
        if horas < 48 {
            let resto = minutos % 60
            return resto > 0 ? "\(horas) h \(resto) min" : "\(horas) h"
        }
        return plural(horas / 24, "día", "días")
    }

    /// «20:31» en la hora del dispositivo.
    static func reloj(_ fecha: Date, calendario: Calendar = .current) -> String {
        let c = calendario.dateComponents([.hour, .minute], from: fecha)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// Una fecha ISO 8601 del servidor, con o sin milésimas (`Date.parse`).
    static func leer(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let conMilesimas = ISO8601DateFormatter()
        conMilesimas.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let fecha = conMilesimas.date(from: iso) { return fecha }
        return ISO8601DateFormatter().date(from: iso)
    }

    /// Cuándo pasó algo (health/model.ts `formatWhen`): la hora y «ahora mismo», «hace 5 min», «hace 3 h»,
    /// «ayer» o «21 sept». Sin fecha válida: hora «—» y relativo vacío.
    static func cuando(_ iso: String, ahora: Date, calendario: Calendar = .current) -> (hora: String, relativo: String) {
        guard let fecha = leer(iso) else { return ("—", "") }
        let hora = reloj(fecha, calendario: calendario)
        let minutos = Int(max(0, ahora.timeIntervalSince(fecha)) / 60)
        if minutos < 1 { return (hora, "ahora mismo") }
        if minutos < 60 { return (hora, "hace \(minutos) min") }
        if calendario.isDate(fecha, inSameDayAs: ahora) { return (hora, "hace \(minutos / 60) h") }
        if let ayer = calendario.date(byAdding: .day, value: -1, to: ahora), calendario.isDate(fecha, inSameDayAs: ayer) {
            return (hora, "ayer")
        }
        let c = calendario.dateComponents([.day, .month], from: fecha)
        return (hora, "\(c.day ?? 0) \(meses[((c.month ?? 1) - 1 + 12) % 12])")
    }

    /// «23 sept 2026» (`Intl.DateTimeFormat` es-ES día, mes corto y año, sin el punto).
    static func fechaLarga(_ fecha: Date, calendario: Calendar = .current) -> String {
        let c = calendario.dateComponents([.day, .month, .year], from: fecha)
        return "\(c.day ?? 0) \(meses[((c.month ?? 1) - 1 + 12) % 12]) \(c.year ?? 0)"
    }

    /// «23 sept, 20:30» (`toLocaleString` es-ES con día, mes corto, hora y minutos).
    static func fechaConHora(_ fecha: Date, calendario: Calendar = .current) -> String {
        let c = calendario.dateComponents([.day, .month], from: fecha)
        return "\(c.day ?? 0) \(meses[((c.month ?? 1) - 1 + 12) % 12]), \(reloj(fecha, calendario: calendario))"
    }

    /// Primera letra en mayúscula (health/model.ts `sentence`): algunos mensajes del backend empiezan en minúscula.
    static func frase(_ texto: String) -> String {
        let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let primera = limpio.first else { return "" }
        return String(primera).uppercased(with: Locale(identifier: "es_ES")) + limpio.dropFirst()
    }
}
