import Foundation

/* Menú de una tarjeta de partido (M5; a3 §6.5, §6.5.1): `menuFor` de agenda/index.tsx, puro. Las mismas
   opciones alimentan el menú contextual nativo y las acciones de VoiceOver (`AccionMenu`). */

/// Qué hace cada opción (la vista la convierte en una acción).
enum AccionPartido: Hashable, Sendable {
    case abrir
    case verMarcador
    case taparMarcador
    case seguirEquipo(String)
    case seguirLiga(String)
}

struct OpcionPartido: Hashable, Sendable {
    var opcion: OpcionMenu
    var accion: AccionPartido
}

enum OpcionesPartido {
    /// `menuFor(match, available, score)` con el orden, los textos y los iconos de la web.
    static func menu(
        _ partido: FootballMatch, disponible: Bool, marcador: EstadoMarcador?, gustos: Preferences?
    ) -> [OpcionPartido] {
        var opciones: [OpcionPartido] = []
        if !partido.channels.isEmpty {
            let opcion = OpcionMenu(
                id: "abrir", titulo: disponible ? "Ver canal" : "Buscar canal", icono: disponible ? .play : .buscar)
            opciones.append(OpcionPartido(opcion: opcion, accion: .abrir))
        }
        switch marcador {
        case .tapado:
            let opcion = OpcionMenu(id: "marcador", titulo: "Ver marcador", icono: .eye, haptica: .ligera)
            opciones.append(OpcionPartido(opcion: opcion, accion: .verMarcador))
        case .destapado:
            let opcion = OpcionMenu(id: "marcador", titulo: "Tapar el marcador", icono: .eyeOff, haptica: .ligera)
            opciones.append(OpcionPartido(opcion: opcion, accion: .taparMarcador))
        case nil:
            break
        }
        for equipo in [partido.home, partido.away] where !equipo.isEmpty {
            let siguiendo = ModeloGustos.equipoSeguido(gustos, equipo) != nil
            let opcion = OpcionMenu(
                id: "equipo-\(equipo)", titulo: siguiendo ? "Dejar de seguir a \(equipo)" : "Seguir a \(equipo)",
                icono: siguiendo ? .starF : .star, separadaAntes: !opciones.isEmpty && equipo == partido.home)
            opciones.append(OpcionPartido(opcion: opcion, accion: .seguirEquipo(equipo)))
        }
        if !partido.competition.isEmpty && partido.competition != "Fútbol" {
            let siguiendo = ModeloGustos.ligaSeguida(gustos, partido.competition) != nil
            let opcion = OpcionMenu(
                id: "liga",
                titulo: siguiendo ? "Dejar de seguir \(partido.competition)" : "Seguir \(partido.competition)",
                icono: siguiendo ? .starF : .star)
            opciones.append(OpcionPartido(opcion: opcion, accion: .seguirLiga(partido.competition)))
        }
        return opciones
    }

    /// Nombre del botón grande de la tarjeta (§6.4, nunca con el resultado).
    static func etiquetaTarjeta(_ partido: FootballMatch, canales: [InfoCanal]) -> String {
        if canales.isEmpty { return "\(ReglasAgenda.titulo(partido)): canal por confirmar" }
        let accion = canales.contains(where: \.enBiblioteca) ? "Ver canal" : "Buscar canal"
        return "\(accion) para \(partido.title)"
    }
}
