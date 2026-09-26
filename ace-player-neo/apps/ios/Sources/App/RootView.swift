import SwiftUI

/// Decide qué se ve: emparejamiento o la app, y recibe los enlaces `aceneo://pair`.
struct RootView: View {
    @Environment(AppModel.self) private var modelo
    @State private var enlacePendiente: PairingLink?
    @State private var enlaceAConfirmar: PairingLink?

    /// Emparejamiento o la app (aparte del `body` para aligerar al type-checker).
    @ViewBuilder private var contenido: some View {
        switch modelo.fase {
        case .emparejar:
            PairingView(entorno: modelo.entorno, enlace: $enlacePendiente)
        case .lista:
            PrincipalView()
        }
    }

    var body: some View {
        contenido
        // Sin animar el cambio entre emparejar y la app: con el fundido, la
        // tira de días de la agenda (un ScrollView que llega cuando la agenda
        // ya ha cargado, en mitad del fundido) se quedaba sin pintar.
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
        // Emparejada: éxito. Tipos escritos a mano: con `.emparejar`/`.lista`
        // implícitos el type-checker no terminaba a tiempo (CI de la 0.8.0).
        .sensoryFeedback(.success, trigger: modelo.fase) { (anterior: AppModel.Fase, nueva: AppModel.Fase) -> Bool in
            anterior == AppModel.Fase.emparejar && nueva == AppModel.Fase.lista
        }
    }
}

/// La app emparejada: las pestañas nativas (Agenda · Canales · Buscar ·
/// Ajustes) y, por encima, el escenario a pantalla completa (`CapaEscenario`).
/// El mini va como accesorio de la barra de pestañas en iOS 26 y, en 17-25,
/// sobre la barra como inset de cada pestaña.
struct PrincipalView: View {
    @Environment(AppModel.self) private var modelo
    @Environment(\.verticalSizeClass) private var claseVertical
    @State private var pestana: Pestana = .agenda

    var body: some View {
        let reproductor = modelo.reproductor
        let escenarioAbierto = modelo.escenarioVisible != nil
        ZStack {
            pestanas
                // Con el escenario abierto, lo de debajo no se lee con VoiceOver.
                .accessibilityHidden(escenarioAbierto)
            CapaEscenario()
        }
        .avisos(modelo.avisos)
        .hapticoSeleccion(trigger: pestana)
        .sensoryFeedback(.error, trigger: reproductor.errores)
        .onChange(of: modelo.pestanaSolicitada) { _, nueva in
            guard let nueva else { return }
            pestana = nueva
            modelo.pestanaSolicitada = nil
        }
        .onChange(of: claseVertical) { _, clase in
            // Girar a horizontal con algo sonando: el escenario a pantalla completa.
            if clase == .compact, reproductor.canal != nil, reproductor.conexion.enMarcha, !escenarioAbierto {
                modelo.abrirLoQueSuena()
            }
        }
        .task { await modelo.arrancar() }
    }

    @ViewBuilder private var pestanas: some View {
        if #available(iOS 18.0, *) {
            conAccesorio(
                TabView(selection: $pestana) {
                    Tab("Agenda", systemImage: "calendar", value: Pestana.agenda) {
                        AgendaView(entorno: modelo.entorno)
                    }
                    Tab("Canales", systemImage: "tv", value: Pestana.canales) {
                        CanalesView()
                    }
                    Tab("Ajustes", systemImage: "gearshape", value: Pestana.ajustes) {
                        AjustesView()
                    }
                    Tab("Buscar", systemImage: "magnifyingglass", value: Pestana.buscar, role: .search) {
                        BuscarView(entorno: modelo.entorno)
                    }
                }
            )
        } else {
            TabView(selection: $pestana) {
                AgendaView(entorno: modelo.entorno)
                    .tabItem { Label("Agenda", systemImage: "calendar") }
                    .tag(Pestana.agenda)
                CanalesView()
                    .tabItem { Label("Canales", systemImage: "tv") }
                    .tag(Pestana.canales)
                BuscarView(entorno: modelo.entorno)
                    .tabItem { Label("Buscar", systemImage: "magnifyingglass") }
                    .tag(Pestana.buscar)
                AjustesView()
                    .tabItem { Label("Ajustes", systemImage: "gearshape") }
                    .tag(Pestana.ajustes)
            }
        }
    }

    /// iOS 26: la barra se pliega al bajar por una lista y el mini es su accesorio.
    /// Desde iOS 26.1 el accesorio solo existe mientras hay mini: con contenido
    /// vacío, el sistema dejaba una cápsula de cristal vacía encima de la barra
    /// (capturas de la CI) y el mini no llegaba a aparecer en ella.
    @ViewBuilder private func conAccesorio<V: View>(_ vista: V) -> some View {
        #if compiler(>=6.2.1)
            if #available(iOS 26.1, *) {
                vista
                    .tabBarMinimizeBehavior(.onScrollDown)
                    .tabViewBottomAccessory(isEnabled: modelo.reproductor.visibleEnMini) {
                        MiniAccesorio()
                    }
            } else if #available(iOS 26.0, *) {
                vista
                    .tabBarMinimizeBehavior(.onScrollDown)
                    .tabViewBottomAccessory {
                        MiniAccesorio()
                    }
            } else {
                vista
            }
        #elseif compiler(>=6.2)
            if #available(iOS 26.0, *) {
                vista
                    .tabBarMinimizeBehavior(.onScrollDown)
                    .tabViewBottomAccessory {
                        MiniAccesorio()
                    }
            } else {
                vista
            }
        #else
            vista
        #endif
    }
}
