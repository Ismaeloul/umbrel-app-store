import Foundation

/* El menú del cartel de una fuente (a4 §5.7, §12.6; `rowMenu` de apps/web/src/features/sources/SourcePoster.tsx):
   «Ver esta fuente» / «Ya está en pantalla» · «Copiar hash» · «Abrir en la app de AceStream» · [separador]
   «Es el canal correcto» (solo en partido, la activa y no aprendida) · «Reportar…» (peligro). Ninguna opción
   vibra (la háptica rigid es del toque sobre el cartel; «éxito» la da el reporte al enviarse). Las mismas
   opciones van a VoiceOver como acciones (sin las deshabilitadas: una acción no puede ir atenuada). */

enum OpcionFuente: String, Sendable, CaseIterable {
    case ver
    case copiarHash = "copiar-hash"
    case abrir, correcto, reportar
}

enum OpcionesFuente {
    /// `rowMenu(row, inMatch)`.
    static func menu(_ fila: FilaFuente, enPartido: Bool) -> [OpcionMenu] {
        var opciones = [
            OpcionMenu(
                id: OpcionFuente.ver.rawValue, titulo: fila.enPantalla ? "Ya está en pantalla" : "Ver esta fuente",
                icono: .play, deshabilitada: fila.enPantalla),
            OpcionMenu(id: OpcionFuente.copiarHash.rawValue, titulo: "Copiar hash", icono: .hash),
            OpcionMenu(id: OpcionFuente.abrir.rawValue, titulo: "Abrir en la app de AceStream", icono: .externo),
        ]
        let puedeAprender = enPartido && fila.activa && fila.entrada.aprendida != .correct
        if puedeAprender {
            opciones.append(
                OpcionMenu(
                    id: OpcionFuente.correcto.rawValue, titulo: "Es el canal correcto", icono: .learn,
                    separadaAntes: true))
        }
        opciones.append(
            OpcionMenu(
                id: OpcionFuente.reportar.rawValue, titulo: "Reportar…", icono: .flag, peligro: true,
                separadaAntes: !puedeAprender))
        return opciones
    }

    /// Las acciones de VoiceOver del cartel (a4 §5.7): las del menú habilitadas, en su orden.
    static func accionesAccesibles(_ fila: FilaFuente, enPartido: Bool) -> [OpcionMenu] {
        menu(fila, enPartido: enPartido).filter { !$0.deshabilitada }
    }
}
