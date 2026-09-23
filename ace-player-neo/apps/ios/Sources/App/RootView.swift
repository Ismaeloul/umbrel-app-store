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

/// Qué pestaña se ve.
enum Pestana: Hashable {
    case agenda, biblioteca, buscar, ajustes
}

/// La app emparejada: agenda, biblioteca, búsqueda y ajustes, con el
/// mini-reproductor sobre la barra de pestañas (Liquid Glass del sistema en
/// iOS 26) y el reproductor a pantalla completa por encima de todo.
struct PrincipalView: View {
    @Environment(AppModel.self) private var modelo
    @State private var pestana: Pestana = .agenda

    var body: some View {
        @Bindable var reproductor = modelo.reproductor
        TabView(selection: $pestana) {
            AgendaView(entorno: modelo.entorno)
                .tabItem { Label("Agenda", systemImage: "calendar") }
                .tag(Pestana.agenda)
            BibliotecaView()
                .tabItem { Label("Biblioteca", systemImage: "star.square.on.square") }
                .tag(Pestana.biblioteca)
            BuscarView(entorno: modelo.entorno)
                .tabItem { Label("Buscar", systemImage: "magnifyingglass") }
                .tag(Pestana.buscar)
            AjustesView()
                .tabItem { Label("Ajustes", systemImage: "gearshape") }
                .tag(Pestana.ajustes)
        }
        .avisos(modelo.avisos, margenInferior: 110)
        .fullScreenCover(isPresented: $reproductor.pantallaCompleta) {
            ReproductorCompleto()
                .environment(modelo)
        }
        .sensoryFeedback(.selection, trigger: reproductor.cambiosDeFuente)
        .sensoryFeedback(.error, trigger: reproductor.errores)
        .task { await modelo.arrancar() }
    }
}
