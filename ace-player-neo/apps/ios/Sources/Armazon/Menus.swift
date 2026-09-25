import SwiftUI

/* Menús de la app (b-arquitectura §2.4.3, I0→M4): la ÚNICA puerta a `.contextMenu(` (regla R5). Menús
   nativos (decisión 5) con el contenido, el orden, el peligro y la ✓ de la web; un modelo único
   (`AccionMenu`) que alimenta a la vez `Menu`, `.contextMenu` y `accessibilityActions` (VoiceOver).
   ESQUELETO de I0 (fase 0.3b): secciones por `separadaAntes`, peligro y ✓ ya van; M4 añade el icono
   (`IconoImagen`, de Palco), la háptica de la acción y el aspecto del botón ⋯ (`BotonIcono`). */

struct AccionMenu: Identifiable {
    let opcion: OpcionMenu
    let ejecutar: () -> Void
    var id: String { opcion.id }
    init(_ opcion: OpcionMenu, ejecutar: @escaping () -> Void) {
        self.opcion = opcion
        self.ejecutar = ejecutar
    }
}

/// Sections por `separadaAntes`; `Button(role: .destructive)` si `peligro`; `Toggle` si `marcada`;
/// `Label { Text } icon: { Image(uiImage: IconoImagen.imagen(…)) }`; dispara `opcion.haptica` al ejecutar.
struct ContenidoMenu: View {
    let acciones: [AccionMenu]

    var body: some View {
        ForEach(secciones) { seccion in
            Section { ForEach(seccion.acciones) { fila($0) } }
        }
    }

    private struct SeccionMenu: Identifiable {
        var acciones: [AccionMenu]
        var id: String { acciones.first?.id ?? "" }
    }

    /// Las acciones partidas en secciones: cada `separadaAntes` abre una nueva.
    private var secciones: [SeccionMenu] {
        var salida: [SeccionMenu] = []
        for accion in acciones {
            if accion.opcion.separadaAntes || salida.isEmpty {
                salida.append(SeccionMenu(acciones: [accion]))
            } else {
                salida[salida.count - 1].acciones.append(accion)
            }
        }
        return salida
    }

    @ViewBuilder private func fila(_ accion: AccionMenu) -> some View {
        let opcion = accion.opcion
        if opcion.marcada {
            Toggle(isOn: .constant(true)) { Text(opcion.titulo) }
                .disabled(opcion.deshabilitada)
        } else if opcion.peligro {
            Button(role: .destructive, action: accion.ejecutar) { Text(opcion.titulo) }
                .disabled(opcion.deshabilitada)
        } else {
            Button(action: accion.ejecutar) { Text(opcion.titulo) }
                .disabled(opcion.deshabilitada)
        }
    }
}

extension View {
    /// El ÚNICO `.contextMenu(` de la app. Las mismas acciones van a `accessibilityActions` (VoiceOver).
    func menuContextual(_ acciones: [AccionMenu]) -> some View {
        contextMenu { ContenidoMenu(acciones: acciones) }
            .modifier(AccionesAccesibles(acciones: acciones))
    }

    func menuContextual<Previa: View>(_ acciones: [AccionMenu], @ViewBuilder vistaPrevia: @escaping () -> Previa)
        -> some View
    {
        contextMenu {
            ContenidoMenu(acciones: acciones)
        } preview: {
            vistaPrevia()
        }
        .modifier(AccionesAccesibles(acciones: acciones))
    }
}

/// Las opciones del menú como acciones de VoiceOver (a4 §5.7: el menú de un cartel tiene camino accesible).
private struct AccionesAccesibles: ViewModifier {
    let acciones: [AccionMenu]
    func body(content: Content) -> some View {
        content.accessibilityActions {
            ForEach(acciones) { accion in
                Button(accion.opcion.titulo, action: accion.ejecutar)
            }
        }
    }
}

/// El botón ⋯ de la web: `Menu { ContenidoMenu } label: { BotonIcono(.more) }` con `.menuOrder(.fixed)`.
struct BotonMas: View {
    enum Estilo: Sendable { case fantasma, video }
    let etiqueta: String
    let estilo: Estilo
    let acciones: () -> [AccionMenu]

    init(etiqueta: String = "Más opciones", estilo: Estilo = .fantasma, acciones: @escaping () -> [AccionMenu]) {
        self.etiqueta = etiqueta
        self.estilo = estilo
        self.acciones = acciones
    }

    var body: some View {
        Menu {
            ContenidoMenu(acciones: acciones())
        } label: {
            Text(etiqueta)
        }
        .menuOrder(.fixed)
    }
}
