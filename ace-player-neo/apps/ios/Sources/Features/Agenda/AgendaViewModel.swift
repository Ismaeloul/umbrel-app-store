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

/// Textos de la agenda (fechas en hora de Madrid, como las da el servidor).
enum FormatoAgenda {
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
}
