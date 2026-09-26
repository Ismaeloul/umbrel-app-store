import Foundation

/* Fechas en español como las pinta la web (b-arquitectura §2.1.3, M2; riesgo 19): tablas propias en vez de
   `DateFormatter` (el «sept» de ICU en Node frente al «sep» de otras versiones), probadas con vectores
   sacados de `Intl` en Node. Fuentes: `Intl.DateTimeFormat('es-ES', …)` de agenda/domain.ts (días y
   meses), `formatWhen`/`clock` de health/model.ts, `pairedText` de devices/model.ts, `shortDate` de
   library/model.ts, `sourceDate` de directories/model.ts y `openedClock` de where-playing/model.ts.
   El tiempo entra siempre por parámetro (regla 7: nada de relojes aquí) y la zona también: la web usa
   Madrid para la agenda y la hora del dispositivo para lo demás. */

/// `When` de health/model.ts.
struct Cuando: Hashable, Sendable {
    /// «20:31».
    var hora: String
    /// «ahora mismo», «hace 5 min», «hace 2 h», «ayer», «21 sept».
    var relativo: String
}

enum FechasES {
    /// `Intl` es-ES, `month: 'short'` (y `MONTHS` de health/model.ts).
    static let mesesCortos = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"]
    /// `month: 'long'`.
    static let mesesLargos = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
        "diciembre",
    ]
    /// `weekday: 'short'` (domingo primero, como `getUTCDay`).
    static let diasCortos = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]
    /// `weekday: 'long'`.
    static let diasLargos = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]

    static let madrid = TimeZone(identifier: "Europe/Madrid") ?? TimeZone(secondsFromGMT: 3600) ?? .current
    static let utc = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? .current

    /// Calendario gregoriano en una zona.
    static func calendario(_ zona: TimeZone) -> Calendar {
        var calendario = Calendar(identifier: .gregorian)
        calendario.timeZone = zona
        return calendario
    }

    /// Año, mes (1…12), día, hora, minuto y día de la semana (0 = domingo) de un instante en una zona.
    static func partes(_ fecha: Date, zona: TimeZone)
        -> (ano: Int, mes: Int, dia: Int, hora: Int, minuto: Int, diaSemana: Int)
    {
        let c = calendario(zona).dateComponents([.year, .month, .day, .hour, .minute, .weekday], from: fecha)
        return (c.year ?? 1970, c.month ?? 1, c.day ?? 1, c.hour ?? 0, c.minute ?? 0, (c.weekday ?? 1) - 1)
    }

    private static func dos(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }

    /// «20:51» (24 h, dos cifras) en esa zona: `madridHour`, `clock`, `openedClock`.
    static func hora(_ fecha: Date, zona: TimeZone) -> String {
        let p = partes(fecha, zona: zona)
        return "\(dos(p.hora)):\(dos(p.minuto))"
    }

    /// `YYYY-MM-DD` del instante en esa zona.
    static func diaISO(_ fecha: Date, zona: TimeZone) -> String {
        let p = partes(fecha, zona: zona)
        let ano = String(p.ano)
        return "\(String(repeating: "0", count: max(0, 4 - ano.count)))\(ano)-\(dos(p.mes))-\(dos(p.dia))"
    }

    /// Mediodía UTC de un día `YYYY-MM-DD` (como `new Date(`${date}T12:00:00Z`)`), o `nil`.
    static func mediodia(_ dia: String) -> Date? {
        let trozos = dia.split(separator: "-").compactMap { Int($0) }
        guard trozos.count == 3, dia.count == 10 else { return nil }
        var c = DateComponents()
        c.year = trozos[0]
        c.month = trozos[1]
        c.day = trozos[2]
        c.hour = 12
        return calendario(utc).date(from: c)
    }

    /// `addDays`: `YYYY-MM-DD` desplazado `dias` días (sin husos).
    static func sumarDias(_ dia: String, _ dias: Int) -> String {
        guard let base = mediodia(dia) else { return dia }
        return diaISO(base.addingTimeInterval(Double(dias) * 86_400), zona: utc)
    }

    /// «jue» (`weekday: 'short'` sin punto) de un día `YYYY-MM-DD`.
    static func diaSemanaCorto(_ dia: String) -> String? {
        mediodia(dia).map { diasCortos[partes($0, zona: utc).diaSemana] }
    }

    /// «jueves» de un día `YYYY-MM-DD`.
    static func diaSemanaLargo(_ dia: String) -> String? {
        mediodia(dia).map { diasLargos[partes($0, zona: utc).diaSemana] }
    }

    /// «24 sept» (`day: 'numeric', month: 'short'`) de un día `YYYY-MM-DD`.
    static func diaMesCorto(_ dia: String) -> String? {
        mediodia(dia).map { fecha in
            let p = partes(fecha, zona: utc)
            return "\(p.dia) \(mesesCortos[p.mes - 1])"
        }
    }

    /// «24 de septiembre» (`day: 'numeric', month: 'long'`) de un día `YYYY-MM-DD`.
    static func diaMesLargo(_ dia: String) -> String? {
        mediodia(dia).map { fecha in
            let p = partes(fecha, zona: utc)
            return "\(p.dia) de \(mesesLargos[p.mes - 1])"
        }
    }

    /// «jueves, 24 de septiembre» (el `long` de `dayLabel`, para lectores de pantalla).
    static func fechaLarga(_ dia: String) -> String? {
        guard let semana = diaSemanaLargo(dia), let mes = diaMesLargo(dia) else { return nil }
        return "\(semana), \(mes)"
    }

    /// «23 sept» de un instante en esa zona (`shortDate` de library/model.ts).
    static func fechaCorta(_ fecha: Date, zona: TimeZone) -> String {
        let p = partes(fecha, zona: zona)
        return "\(p.dia) \(mesesCortos[p.mes - 1])"
    }

    /// «23 sept 2026» (`pairedText` de devices/model.ts, sin el punto).
    static func fechaConAno(_ fecha: Date, zona: TimeZone) -> String {
        let p = partes(fecha, zona: zona)
        return "\(p.dia) \(mesesCortos[p.mes - 1]) \(p.ano)"
    }

    /// «23 sept, 20:30» (`sourceDate` de directories/model.ts).
    static func fechaYHora(_ fecha: Date, zona: TimeZone) -> String {
        "\(fechaCorta(fecha, zona: zona)), \(hora(fecha, zona: zona))"
    }

    /// Instante de un texto ISO 8601 como lo lee `new Date(iso)` (con o sin milisegundos), o `nil`.
    static func leerISO(_ texto: String) -> Date? {
        FechaISO.parse(texto)
    }

    /// `formatWhen`: cuándo pasó algo, para leerlo de un vistazo, en la zona del aparato.
    static func cuando(_ iso: String, ahora: Date, zona: TimeZone) -> Cuando {
        guard let momento = leerISO(iso) else { return Cuando(hora: "—", relativo: "") }
        let hora = hora(momento, zona: zona)
        let diferencia = max(0, ahora.timeIntervalSince(momento) * 1000)
        let minutos = Int((diferencia / 60_000).rounded(.down))
        if minutos < 1 { return Cuando(hora: hora, relativo: "ahora mismo") }
        if minutos < 60 { return Cuando(hora: hora, relativo: "hace \(minutos) min") }
        let hoy = diaISO(ahora, zona: zona)
        if diaISO(momento, zona: zona) == hoy { return Cuando(hora: hora, relativo: "hace \(minutos / 60) h") }
        let ayer = calendario(zona).date(byAdding: .day, value: -1, to: ahora).map { diaISO($0, zona: zona) }
        if diaISO(momento, zona: zona) == ayer { return Cuando(hora: hora, relativo: "ayer") }
        return Cuando(hora: hora, relativo: fechaCorta(momento, zona: zona))
    }
}
