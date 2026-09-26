import SwiftUI

/* Menús de la app (b-arquitectura §2.4.3, I0→M4): la ÚNICA puerta a `.contextMenu(` (regla R5). Menús nativos
   (decisión 5) con el contenido, el orden, el peligro y la ✓ de la web (ui/Menu.tsx; a2 §10): un modelo único
   (`AccionMenu`) alimenta a la vez `Menu` (el botón ⋯), `.contextMenu` (pulsación larga, con vista previa) y
   `accessibilityActions` (VoiceOver: el menú de un cartel tiene camino accesible, a4 §5.7).

   - Secciones por `separadaAntes`; `Button(role: .destructive)` si `peligro`; `Toggle` si `marcada` (la ✓);
     deshabilitada con el aspecto del sistema; icono de la web como imagen plantilla (`IconoImagen`).
   - Háptica: la de la ACCIÓN al elegirla (`opcion.haptica`, a4 §5.7); abrir el menú no suena propio: el
     `.contextMenu` del sistema ya vibra (b-arquitectura §0.3).
   - El menú del sistema respeta las zonas seguras y se desplaza (corrige a2 §20.3 y a4 §5.7).
   La háptica se lee en la vista que lleva el menú (no dentro del menú, que el sistema pinta aparte) y se pasa. */

struct AccionMenu: Identifiable {
    let opcion: OpcionMenu
    let ejecutar: () -> Void
    var id: String { opcion.id }
    init(_ opcion: OpcionMenu, ejecutar: @escaping () -> Void) {
        self.opcion = opcion
        self.ejecutar = ejecutar
    }

    /// Ejecuta la acción con su háptica (la de la web al elegirla).
    @MainActor func elegir(_ haptica: Haptica?) {
        if let tipo = opcion.haptica { haptica?.disparar(tipo) }
        ejecutar()
    }
}

/// Sections por `separadaAntes`; `Button(role: .destructive)` si `peligro`; `Toggle` si `marcada`;
/// `Label { Text } icon: { Image(uiImage: IconoImagen.imagen(…)) }`; dispara `opcion.haptica` al ejecutar.
struct ContenidoMenu: View {
    let acciones: [AccionMenu]
    /// La háptica central (la pasan `menuContextual` y `BotonMas`); sin ella no vibra.
    var haptica: Haptica?

    var body: some View {
        ForEach(ContenidoMenu.secciones(acciones)) { seccion in
            Section { ForEach(seccion.acciones) { fila($0) } }
        }
    }

    struct SeccionMenu: Identifiable {
        var acciones: [AccionMenu]
        var id: String { acciones.first?.id ?? "" }
    }

    /// Las acciones partidas en secciones: cada `separadaAntes` abre una nueva (el filete de `.menu__row`).
    static func secciones(_ acciones: [AccionMenu]) -> [SeccionMenu] {
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
        let haptica = self.haptica
        if opcion.marcada {
            Toggle(isOn: Binding(get: { true }, set: { _ in accion.elegir(haptica) })) { etiqueta(opcion) }
                .disabled(opcion.deshabilitada)
        } else {
            Button(role: opcion.peligro ? .destructive : nil) { accion.elegir(haptica) } label: { etiqueta(opcion) }
                .disabled(opcion.deshabilitada)
        }
    }

    private func etiqueta(_ opcion: OpcionMenu) -> some View {
        Label {
            Text(opcion.titulo)
        } icon: {
            if let icono = opcion.icono { Image(uiImage: IconoImagen.imagen(icono, tamano: 20)) }
        }
    }
}

extension View {
    /// El ÚNICO `.contextMenu(` de la app. Las mismas acciones van a `accessibilityActions` (VoiceOver).
    func menuContextual(_ acciones: [AccionMenu]) -> some View {
        modifier(MenuContextual(acciones: acciones))
    }

    func menuContextual<Previa: View>(_ acciones: [AccionMenu], @ViewBuilder vistaPrevia: @escaping () -> Previa)
        -> some View
    {
        modifier(MenuContextualConPrevia(acciones: acciones, vistaPrevia: vistaPrevia))
    }
}

private struct MenuContextual: ViewModifier {
    let acciones: [AccionMenu]
    @Environment(Haptica.self) private var haptica

    func body(content: Content) -> some View {
        let haptica = self.haptica
        content
            .contextMenu { ContenidoMenu(acciones: acciones, haptica: haptica) }
            .modifier(AccionesAccesibles(acciones: acciones, haptica: haptica))
    }
}

private struct MenuContextualConPrevia<Previa: View>: ViewModifier {
    let acciones: [AccionMenu]
    let vistaPrevia: () -> Previa
    @Environment(Haptica.self) private var haptica

    func body(content: Content) -> some View {
        let haptica = self.haptica
        content
            .contextMenu {
                ContenidoMenu(acciones: acciones, haptica: haptica)
            } preview: {
                vistaPrevia()
            }
            .modifier(AccionesAccesibles(acciones: acciones, haptica: haptica))
    }
}

/// Las opciones del menú como acciones de VoiceOver (a4 §5.7: el menú de un cartel tiene camino accesible), con
/// la misma háptica y sin las deshabilitadas.
private struct AccionesAccesibles: ViewModifier {
    let acciones: [AccionMenu]
    let haptica: Haptica

    func body(content: Content) -> some View {
        let haptica = self.haptica
        content.accessibilityActions {
            ForEach(acciones.filter { !$0.opcion.deshabilitada }) { accion in
                Button(accion.opcion.titulo) { accion.elegir(haptica) }
            }
        }
    }
}

/// El botón ⋯ de la web (`MenuButton`: IconButton `more` «Más opciones»): `Menu { ContenidoMenu }` con
/// `.menuOrder(.fixed)` (el orden de la web, de arriba abajo). Aspecto de `BotonIcono`: círculo de 44 con el icono
/// de 24 en `--text-2` (fantasma) o `--on-video` (sobre el vídeo). Abrirlo no vibra (a1 §8.1).
struct BotonMas: View {
    enum Estilo: Sendable { case fantasma, video }
    let etiqueta: String
    let estilo: Estilo
    let acciones: () -> [AccionMenu]
    @Environment(Haptica.self) private var haptica

    init(etiqueta: String = "Más opciones", estilo: Estilo = .fantasma, acciones: @escaping () -> [AccionMenu]) {
        self.etiqueta = etiqueta
        self.estilo = estilo
        self.acciones = acciones
    }

    var body: some View {
        let haptica = self.haptica
        Menu {
            ContenidoMenu(acciones: acciones(), haptica: haptica)
        } label: {
            IconoPalco(.more, tamano: 24)
                .frame(width: S.tap, height: S.tap)
                .contentShape(Circle())
                .foregroundStyle(estilo == .video ? Palco.onVideo : Palco.text2)
        }
        .menuOrder(.fixed)
        .accessibilityLabel(etiqueta)
        .accessibilityShowsLargeContentViewer()
    }
}
