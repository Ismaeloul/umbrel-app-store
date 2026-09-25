import SwiftUI

/// `.sis-context`: la zona de la pulsación larga (44 de alto, relleno 0 16, radio 14, borde discontinuo). El
/// menú contextual con vista previa sale de la única puerta de la app (`menuContextual`, Armazon/Menus.swift;
/// canario C7).
struct ZonaMenuContextual: View {
    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        Text("Clic derecho o pulsación larga aquí")
            .estilo(EstiloTexto(tamano: 13, peso: 450))
            .foregroundStyle(Palco.text2)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(Palco.bg, in: forma)
            .overlay(forma.strokeBorder(Palco.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
            .menuContextual(ZonaMenuContextual.acciones) {
                Text("Acciones de la fuente").estilo(.menu).padding(20).background(Palco.surface)
            }
    }

    /// Las opciones del menú de una fuente (a1 §10.19), sin efecto en la galería.
    private static var acciones: [AccionMenu] {
        [
            AccionMenu(OpcionMenu(id: "fav", titulo: "Guardar en favoritos")) {},
            AccionMenu(OpcionMenu(id: "copiar", titulo: "Copiar hash")) {},
            AccionMenu(OpcionMenu(id: "abrir", titulo: "Abrir en…")) {},
            AccionMenu(OpcionMenu(id: "nerd", titulo: "Datos técnicos", marcada: true)) {},
            AccionMenu(OpcionMenu(id: "reportar", titulo: "Reportar la fuente", peligro: true, separadaAntes: true)) {},
        ]
    }
}
