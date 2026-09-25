import SwiftUI

// Canario C7 (b-arquitectura §5.3): `.contextMenu(menuItems:preview:)` con vista previa propia,
// `Menu` con `.menuOrder(.fixed)`, secciones, peligro, Toggle y las mismas acciones en
// `accessibilityActions`, tal como los usará Armazon/Menus.swift (§2.4.3).
// Plan B: .contextMenu(_:) sin vista previa. Se borra al cerrar la fase 0.

struct SondaOpcionMenu: Identifiable, Hashable, Sendable {
    var id: String
    var titulo: String
    var peligro = false
    var marcada = false
    var separadaAntes = false
}

struct SondaAccionMenu: Identifiable {
    let opcion: SondaOpcionMenu
    let ejecutar: () -> Void
    var id: String { opcion.id }
}

struct SondaContenidoMenu: View {
    let acciones: [SondaAccionMenu]

    var body: some View {
        ForEach(acciones) { accion in
            fila(accion)
        }
    }

    @ViewBuilder private func fila(_ accion: SondaAccionMenu) -> some View {
        if accion.opcion.marcada {
            Toggle(isOn: .constant(true)) { Text(accion.opcion.titulo) }
        } else if accion.opcion.peligro {
            Button(role: .destructive, action: accion.ejecutar) { Text(accion.opcion.titulo) }
        } else {
            Button(action: accion.ejecutar) { Text(accion.opcion.titulo) }
        }
    }
}

extension View {
    func sondaMenuContextual<Previa: View>(
        _ acciones: [SondaAccionMenu], @ViewBuilder vistaPrevia: @escaping () -> Previa
    ) -> some View {
        contextMenu {
            SondaContenidoMenu(acciones: acciones)
        } preview: {
            vistaPrevia()
        }
        .accessibilityActions {
            ForEach(acciones) { accion in
                Button(accion.opcion.titulo, action: accion.ejecutar)
            }
        }
    }
}

struct SondaC7Menus: View {
    private var acciones: [SondaAccionMenu] {
        [
            SondaAccionMenu(opcion: SondaOpcionMenu(id: "fav", titulo: "Guardar en favoritos"), ejecutar: {}),
            SondaAccionMenu(opcion: SondaOpcionMenu(id: "borrar", titulo: "Quitar", peligro: true), ejecutar: {}),
        ]
    }

    var body: some View {
        VStack {
            Text("Cartel").sondaMenuContextual(acciones) { Color.black.frame(width: 320, height: 180) }
            Menu {
                Section { SondaContenidoMenu(acciones: acciones) }
            } label: {
                Text("Más opciones")
            }
            .menuOrder(.fixed)
        }
    }
}
