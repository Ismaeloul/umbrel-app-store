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
            case .lista:
                PrincipalView()
            }
        }
        // Sin animar el cambio entre emparejar y la app: con el fundido, la
        // tira de días de la agenda (un ScrollView que llega cuando la agenda
        // ya ha cargado, en mitad del fundido) se quedaba sin pintar, aunque
        // sus días estaban y se podían tocar (E2E de la CI y EmparejamientoUITests).
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

/// La app emparejada: agenda, biblioteca, búsqueda y ajustes y, por encima,
/// la capa del reproductor: el mini-reproductor justo sobre la barra de
/// pestañas y el reproductor grande a toda pantalla (se abren y cierran con
/// gestos, `CapaReproductor`).
struct PrincipalView: View {
    @Environment(AppModel.self) private var modelo
    @State private var pestana: Pestana = .agenda
    @State private var maqueta = Maqueta()

    var body: some View {
        let reproductor = modelo.reproductor
        ZStack {
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
            // Con el reproductor grande abierto, lo de debajo no se lee con VoiceOver.
            .accessibilityHidden(reproductor.vista == .grande)

            CapaReproductor()
        }
        .background {
            GeometryReader { geo in
                Color.clear
                    .onAppear { maqueta.medirSistema(geo.safeAreaInsets.bottom) }
                    .onChange(of: geo.safeAreaInsets.bottom) { _, nuevo in maqueta.medirSistema(nuevo) }
            }
            .ignoresSafeArea(.keyboard)
        }
        .environment(maqueta)
        .avisos(modelo.avisos, margenInferior: margenAvisos)
        .sensoryFeedback(.selection, trigger: reproductor.cambiosDeFuente)
        .sensoryFeedback(.error, trigger: reproductor.errores)
        .sensoryFeedback(.selection, trigger: pestana)
        .task { await modelo.arrancar() }
    }

    /// Los avisos van por encima de la barra de pestañas y del mini.
    private var margenAvisos: CGFloat {
        switch modelo.reproductor.vista {
        case .grande: return 24
        case .mini: return max(0, maqueta.baseMini - maqueta.margenSistema) + Maqueta.altoMini + 10
        case .ninguna: return max(0, maqueta.baseMini - maqueta.margenSistema) + 4
        }
    }
}
