import Foundation

// Rescatado en la poda (fase 0.2, b-arquitectura §1.11) de Features/Library/ReglasBiblioteca.swift, sin
// cambiar el comportamiento. M5 lo convierte en el port de library/on-air.ts.

/// Un partido que da un canal: en juego o el siguiente de hoy (`OnAirMatch`).
struct EnAntena: Hashable {
    var partido: FootballMatch
    var enDirecto: Bool
    var marcador: LiveScore?
}

/// Los partidos de hoy con las claves de sus canales ya calculadas: cruzar
/// cada canal de la biblioteca con la agenda sale barato (`on-air.ts`).
struct IndiceAntena {
    struct Entrada {
        let partido: FootballMatch
        let claves: [String]
        let faltan: Int?
    }

    static let vacio = IndiceAntena(entradas: [])

    let entradas: [Entrada]

    /// Duración que se da a un partido sin marcador (2 h, como la web).
    static let ventanaPartido = 120

    /// `todaysMatches`: los del día de Madrid y los de ayer que sigan en juego.
    init(agenda: FootballSchedule?, reloj: RelojMadrid) {
        var entradas: [Entrada] = []
        for dia in agenda?.days ?? [] {
            for partido in dia.matches {
                let faltan = ReglasAgenda.minutosParaPartido(partido, reloj: reloj)
                let enJuego = faltan.map { $0 <= 0 && $0 > -Self.ventanaPartido } ?? false
                guard dia.date == reloj.fecha || enJuego else { continue }
                entradas.append(Entrada(partido: partido, claves: partido.channels.map { Canales.clave($0.name) }, faltan: faltan))
            }
        }
        self.entradas = entradas
    }

    private init(entradas: [Entrada]) {
        self.entradas = entradas
    }

    /// `onAirFor`: el que está en juego o, si no, el siguiente de hoy.
    func para(titulo: String, alias: String?, marcadores: [String: LiveScore]) -> EnAntena? {
        guard !entradas.isEmpty else { return nil }
        let claveTitulo = Canales.clave(titulo)
        let claveAlias = alias.map { Canales.clave($0) }
        var siguiente: (entrada: Entrada, faltan: Int)?
        for entrada in entradas
        where Canales.emite(claveTitulo: claveTitulo, claveAlias: claveAlias, clavesPartido: entrada.claves) {
            let marcador = marcadores[entrada.partido.id]
            if marcador?.state == "post" { continue }
            let enJuego =
                marcador?.state == "in"
                || (entrada.faltan.map { $0 <= 0 && $0 > -Self.ventanaPartido } ?? false)
            if enJuego { return EnAntena(partido: entrada.partido, enDirecto: true, marcador: marcador) }
            let faltan = entrada.faltan ?? 1_000_000_000
            if faltan > 0, siguiente == nil || faltan < siguiente?.faltan ?? .max {
                siguiente = (entrada, faltan)
            }
        }
        return siguiente.map { EnAntena(partido: $0.entrada.partido, enDirecto: false, marcador: nil) }
    }
}
