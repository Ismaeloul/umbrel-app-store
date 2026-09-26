import Foundation

/* Lo que necesita una tarjeta versus de la agenda (M5; a3 §7): port de agenda/cards.ts (`versusWhen`,
   `signalWord`, `signalTone`, los lados con su paleta). Los colores de club, las siglas y los escudos son el
   port de lib/teams.ts y lib/color.ts de M2 (`Equipos`, `ColorOKLab`, probados con sus vectores). */

/// El chip de cuándo (`VersusWhen`).
struct CuandoVersus: Equatable, Sendable {
    enum Tipo: Equatable, Sendable { case directo, terminado, porConfirmar, hora }
    var tipo: Tipo
    var texto: String
    /// En directo con minuto: «54», «45+2».
    var minuto: String?

    /// Lo que se lee en la cápsula (antes de pasarlo a mayúsculas): «En directo · 54'».
    var rotulo: String {
        if let minuto { return "\(texto) · \(minuto)'" }
        return texto
    }
}

/// Tono de la cápsula de señal (`signalTone`): el semáforo para lo sabido, neutro mientras se mira.
enum TonoSenal: Equatable, Sendable { case ok, weak, fail, neutral }

/// Un lado de la tarjeta ya resuelto (`versusSide`): nombre, siglas, colores y escudo.
struct LadoVersus: Equatable, Sendable {
    var nombre: String
    var siglas: String
    var primario: RGB
    var secundario: RGB?
    /// Ruta relativa del escudo (mismo origen) o nil.
    var escudo: String?
    /// La luz del club en oscuro (`teamLight(…, 'dark')`): halo de los escudos encendidos.
    var luz: RGB
}

enum TarjetasAgenda {
    /// `versusWhen`.
    static func cuando(_ partido: FootballMatch, reloj: RelojMadrid, marcador: LiveScore?) -> CuandoVersus {
        let estado = ReglasAgenda.estado(partido, reloj: reloj, marcador: marcador)
        if estado?.fase == .directo {
            let minuto = Marcadores.minuto(marcador)
            if minuto?.descanso == true { return CuandoVersus(tipo: .directo, texto: "Descanso") }
            return CuandoVersus(tipo: .directo, texto: "En directo", minuto: minuto?.minuto)
        }
        if estado?.fase == .terminado { return CuandoVersus(tipo: .terminado, texto: "Final") }
        guard ReglasAgenda.minutosDeHora(partido.time) != nil else {
            return CuandoVersus(tipo: .porConfirmar, texto: "Por confirmar")
        }
        let dia = ReglasAgenda.etiquetaDia(partido.date, hoy: reloj.fecha)
        return CuandoVersus(tipo: .hora, texto: "\(dia.principal) \(partido.time)")
    }

    /// `signalTone`.
    static func tono(_ estado: EstadoSenal) -> TonoSenal {
        switch estado {
        case .ok: .ok
        case .weak: .weak
        case .fail: .fail
        case .checking, .pending: .neutral
        }
    }

    /// `versusSide`: el nombre completo (o «…»), las siglas, la paleta y el escudo.
    /// Los colores, las siglas y el escudo salen de `Equipos` y `ColorOKLab` (M2, lib/teams.ts y lib/color.ts).
    static func lado(_ partido: FootballMatch, local: Bool) -> LadoVersus {
        let ladoPartido: LadoPartido = local ? .local : .visitante
        let nombreCompleto = Equipos.nombre(partido, ladoPartido)
        let nombre = nombreCompleto.isEmpty ? (local ? partido.title : "") : nombreCompleto
        let paleta = Equipos.paleta(partido, ladoPartido)
        let luz = ColorOKLab.luzEquipo(primario: paleta.primario, secundario: paleta.secundario, oscuro: true)
            ?? Oklch(l: 0.66, c: 0.13, h: ColorOKLab.tonoDeNombre(nombreCompleto.isEmpty ? "?" : nombreCompleto))
        return LadoVersus(
            nombre: nombre.isEmpty ? "…" : nombre,
            siglas: Equipos.siglas(partido, ladoPartido),
            primario: rgb(paleta.primario), secundario: paleta.secundario.map(rgb),
            escudo: Equipos.escudo(partido, ladoPartido), luz: ColorOKLab.rgb(luz))
    }

    /// Las dos mitades de la tarjeta (`matchVersusPair`).
    static func mitades(_ partido: FootballMatch) -> (local: RGB, visitante: RGB) {
        let par = Equipos.versus(partido)
        return (rgb(par.local), rgb(par.visitante))
    }

    /// `competitionLogo`: ruta relativa del logo o nil.
    static func logoCompeticion(_ partido: FootballMatch) -> String? {
        Equipos.logoCompeticion(partido)
    }

    /// Un `#rrggbb` de `Equipos` en RGB (gris medio si no lo es, como `lab()` de teams.ts).
    static func rgb(_ hex: String) -> RGB {
        ColorOKLab.desdeHex(hex) ?? RGB(r: 0.5, g: 0.5, b: 0.5)
    }

    /// El nombre de la competición que se pinta («Fútbol» si viene vacía).
    static func competicion(_ partido: FootballMatch) -> String {
        let limpia = partido.competition.trimmingCharacters(in: .whitespacesAndNewlines)
        return limpia.isEmpty ? "Fútbol" : limpia
    }
}
