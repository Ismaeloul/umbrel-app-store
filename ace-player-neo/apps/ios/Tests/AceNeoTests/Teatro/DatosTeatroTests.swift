import Foundation
import Testing

@testable import AceNeo

/* Reglas del teatro de un partido (features/agenda/domain.ts: matchStatus, liveMinute, paintableScore,
   matchProgressAt, dayLabel; MatchHead.tsx › statusLine; WhereAired.tsx) en hora de Madrid. */

/// 24-sep-2026 19:00 en Madrid (T0 de las capturas: 2026-09-24T19:00:00+02:00).
private let t0 = ISO8601DateFormatter().date(from: "2026-09-24T19:00:00+02:00") ?? Date(timeIntervalSince1970: 0)

private func partido(hora: String = "21:00", fecha: String = "2026-09-24", away: String = "Juventus") -> FootballMatch {
    FootballMatch(
        id: "demo-1", date: fecha, time: hora, start: nil, title: "FC Barcelona - Juventus", home: "FC Barcelona",
        away: away, competition: "Amistoso", country: "", channels: [FootballChannelRef(id: "d", name: "DAZN")])
}

private func marcador(_ estado: String, reloj: String = "61'", detalle: String = "") -> LiveScore {
    LiveScore(home: 1, away: 1, state: estado, clock: reloj, detail: detalle, confidence: 1)
}

struct DatosTeatroTests {
    @Test func relojDeMadrid() {
        let reloj = DatosTeatro.relojMadrid(t0)
        #expect(reloj.fecha == "2026-09-24" && reloj.minutos == 19 * 60)
    }

    @Test func estadoDelPartido() {
        #expect(DatosTeatro.estado(partido(hora: "19:48"), marcador: nil, ahora: t0) == EstadoTeatro(fase: .pronto, texto: "En 48 min"))
        #expect(DatosTeatro.estado(partido(hora: "21:28"), marcador: nil, ahora: t0) == EstadoTeatro(fase: .proximo, texto: "En 2 h 28 min"))
        #expect(DatosTeatro.estado(partido(hora: "18:00"), marcador: nil, ahora: t0)?.fase == .directo)
        #expect(DatosTeatro.estado(partido(hora: "16:00"), marcador: nil, ahora: t0)?.fase == .terminado)
        #expect(DatosTeatro.estado(partido(hora: "Por confirmar"), marcador: nil, ahora: t0) == nil)
        #expect(DatosTeatro.estado(partido(hora: "23:59"), marcador: marcador("in"), ahora: t0)?.fase == .directo)
        #expect(DatosTeatro.estado(partido(hora: "18:00"), marcador: marcador("post"), ahora: t0)?.fase == .terminado)
    }

    @Test func minutoYMarcadorPintable() {
        #expect(DatosTeatro.minuto(marcador("in", reloj: "61'")) == MinutoTeatro(minuto: "61", descanso: false))
        #expect(DatosTeatro.minuto(marcador("in", reloj: "45'+2'")) == MinutoTeatro(minuto: "45+2", descanso: false))
        #expect(DatosTeatro.minuto(marcador("in", reloj: "", detalle: "Halftime")) == MinutoTeatro(minuto: "45", descanso: true))
        #expect(DatosTeatro.minuto(marcador("post")) == nil)
        #expect(DatosTeatro.pintable(marcador("pre")) == nil)
        #expect(DatosTeatro.pintable(marcador("in")) != nil)
    }

    @Test func kickerDeLaCabecera() {
        let directo = partido(hora: "18:00")
        #expect(DatosTeatro.kicker(directo, marcador: marcador("in"), ahora: t0) == "Amistoso · En directo · 61'")
        #expect(DatosTeatro.kicker(directo, marcador: marcador("in", reloj: "", detalle: "HT"), ahora: t0) == "Amistoso · Descanso")
        #expect(DatosTeatro.kicker(directo, marcador: nil, ahora: t0) == "Amistoso · En directo")
        #expect(DatosTeatro.kicker(partido(hora: "18:00"), marcador: marcador("post"), ahora: t0) == "Amistoso · Final")
        #expect(DatosTeatro.kicker(partido(hora: "19:48"), marcador: nil, ahora: t0) == "Amistoso · En 48 min")
        #expect(DatosTeatro.kicker(partido(hora: "23:30"), marcador: nil, ahora: t0) == "Amistoso · En 4 h 30 min")
        #expect(DatosTeatro.kicker(partido(hora: "21:00", fecha: "2026-09-25"), marcador: nil, ahora: t0) == "Amistoso · 21:00")
        #expect(DatosTeatro.kicker(partido(hora: "Por confirmar"), marcador: nil, ahora: t0) == "Amistoso · Hora por confirmar")
    }

    @Test func textosQueSeLeen() {
        #expect(DatosTeatro.tituloLectura(partido()) == "FC Barcelona vs Juventus")
        #expect(DatosTeatro.tituloLectura(partido(away: "")) == "FC Barcelona - Juventus")
        #expect(DatosTeatro.etiquetaMarcador(partido(), marcador("in"), terminado: false) == "FC Barcelona 1, Juventus 1")
        #expect(DatosTeatro.etiquetaMarcador(partido(), marcador("post"), terminado: true) == "FC Barcelona 1, Juventus 1, final")
    }

    @Test func progresoDelPartido() {
        #expect(DatosTeatro.progreso(partido(), marcador: marcador("post"), ahora: t0) == 1)
        #expect(DatosTeatro.progreso(partido(), marcador: marcador("in", reloj: "45'"), ahora: t0) == 0.5)
        #expect(DatosTeatro.progreso(partido(), marcador: marcador("in", reloj: "", detalle: "HT"), ahora: t0) == 0.5)
        #expect(DatosTeatro.progreso(partido(), marcador: nil, ahora: t0) == 0)
    }

    @Test func diasYPie() {
        #expect(DatosTeatro.dia("2026-09-24", hoy: "2026-09-24").principal == "Hoy")
        #expect(DatosTeatro.dia("2026-09-25", hoy: "2026-09-24").principal == "Mañana")
        #expect(DatosTeatro.dia("2026-09-23", hoy: "2026-09-24").principal == "Ayer")
        let jueves = DatosTeatro.dia("2026-09-24", hoy: "2026-09-20")
        #expect(jueves.principal == "Jue" && jueves.secundario == "24 sept" && jueves.largo == "jueves, 24 de septiembre")
        #expect(DatosTeatro.pieEmision(partido(), hoy: "2026-09-24") == "Amistoso · Hoy, 21:00")
        #expect(DatosTeatro.pieEmision(partido(hora: "Por confirmar"), hoy: "2026-09-24") == "Amistoso · Hoy, hora por confirmar")
        #expect(DatosTeatro.unidadesJuntas("En 2 h 28 min") == "En 2\u{00A0}h 28\u{00A0}min")
    }
}
