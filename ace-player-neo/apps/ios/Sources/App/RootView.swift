import SwiftUI

/// Decide qué se ve: emparejamiento o la app, y recibe los enlaces `aceneo://pair`.
struct RootView: View {
    @Environment(AppModel.self) private var modelo
    @State private var enlacePendiente: PairingLink?
    @State private var enlaceAConfirmar: PairingLink?

    var body: some View {
        Group {
            switch modelo.fase {
            case .emparejar:
                PairingView(entorno: modelo.entorno, enlace: $enlacePendiente)
                    .transition(.opacity)
            case .lista:
                PrincipalView()
                    .transition(.opacity)
            }
        }
        .animation(Muelle.estandar, value: modelo.fase)
        .onOpenURL { url in
            // El QR abierto con la Cámara lleva aquí. Si ya está emparejada,
            // se pregunta antes de cambiar de servidor.
            guard let enlace = PairingLink(url: url) else { return }
            if modelo.fase == .lista {
                enlaceAConfirmar = enlace
            } else {
                enlacePendiente = enlace
            }
        }
        .confirmationDialog(
            "¿Emparejar con otro servidor?",
            isPresented: Binding(
                get: { enlaceAConfirmar != nil },
                set: { if !$0 { enlaceAConfirmar = nil } }),
            titleVisibility: .visible
        ) {
            Button("Emparejar de nuevo", role: .destructive) {
                let enlace = enlaceAConfirmar
                enlaceAConfirmar = nil
                Task {
                    await modelo.desemparejar()
                    enlacePendiente = enlace
                }
            }
            Button("Cancelar", role: .cancel) { enlaceAConfirmar = nil }
        } message: {
            Text("Se olvidará el servidor actual y se usará el del código.")
        }
    }
}

/// La app emparejada: pestañas con la agenda y los ajustes.
struct PrincipalView: View {
    @Environment(AppModel.self) private var modelo

    var body: some View {
        TabView {
            AgendaView(entorno: modelo.entorno)
                .tabItem { Label("Agenda", systemImage: "calendar") }
            AjustesView()
                .tabItem { Label("Ajustes", systemImage: "gearshape") }
        }
        .task { await modelo.arrancar() }
    }
}
