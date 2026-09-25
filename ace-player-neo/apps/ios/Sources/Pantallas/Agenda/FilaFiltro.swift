import SwiftUI

/* Fila del filtro (M5; a3 §5.2): el segmentado «Qué partidos ver» (Para ti n · Todos n; «Para ti»
   deshabilitado sin gustos), el lápiz «Editar mis gustos» y, a la derecha, «● n en directo». */

struct FilaFiltro: View {
    let modo: ModoAgenda
    let hayGustos: Bool
    let paraTi: Int
    let todos: Int
    let enDirecto: Int
    let cambiarModo: (ModoAgenda) -> Void
    let editarGustos: () -> Void

    private var opciones: [OpcionPantalla<ModoAgenda>] {
        [
            OpcionPantalla(
                valor: .paraTi, titulo: "Para ti", contador: paraTi, identificador: IDUI.filtroParaTi, habilitada: hayGustos),
            OpcionPantalla(valor: .todos, titulo: "Todos", contador: todos, identificador: IDUI.filtroTodos),
        ]
    }

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 4) {
                SegmentoPantalla(opciones: opciones, seleccion: modo, bloque: false, etiqueta: "Qué partidos ver", cambiar: cambiarModo)
                    .fixedSize()
                BotonIcono(.pencil, etiqueta: "Editar mis gustos", accion: editarGustos)
                    .accessibilityIdentifier(IDUI.botonEditarGustos)
            }
            Spacer(minLength: 0)
            if enDirecto > 0 { resumenDirecto }
        }
    }

    /// `.agenda-live-sum`: punto de directo, la cifra (celdas de 0,645 em) y « en directo», 13/700 `--live-ink`.
    private var resumenDirecto: some View {
        let estilo = EstiloTexto(tamano: 13, peso: 700, altoLinea: 1.45)
        return HStack(spacing: 4) {
            PuntoDirecto()
            HStack(spacing: 0) {
                Num("\(enDirecto)", estilo: estilo, animacion: .rueda)
                Text(" en directo").estilo(estilo)
            }
        }
        .foregroundStyle(Palco.liveInk)
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(enDirecto) en directo")
    }
}
