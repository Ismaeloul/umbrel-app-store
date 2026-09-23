import SwiftUI

/// Ajustes: dónde se está reproduciendo (en tiempo real), tu fútbol, modo
/// de reproducción, servidor (Tailscale y red local, con cambio
/// automático), emparejamiento (código o QR), estado y reinicio del motor y
/// «Acerca de».
struct AjustesView: View {
    @Environment(AppModel.self) private var modelo
    @State private var config = ServerConfig()
    @State private var textoTailscale = ""
    @State private var textoLan = ""
    @State private var confirmarOlvidar = false
    @State private var confirmarReinicio = false
    @State private var confirmarEmparejar = false
    @State private var reiniciando = false

    var body: some View {
        NavigationStack {
            Form {
                // Los colores de «Luz de focos» (fondo y tarjetas), como el resto de pestañas.
                Group {
                    SeccionDondeSuena()
                    seccionFutbol
                    seccionListas
                    seccionReproduccion
                    seccionServidor
                    seccionMotor
                    seccionAcercaDe
                    Section {
                        Button("Olvidar este servidor", role: .destructive) { confirmarOlvidar = true }
                            .accessibilityIdentifier("boton-olvidar")
                    } footer: {
                        Text("Borra el token del Llavero y las direcciones. Para volver a usar la app habrá que emparejarla otra vez.")
                    }
                }
                .listRowBackground(Tinta.superficie)
            }
            .scrollContentBackground(.hidden)
            .background(Tinta.fondo.ignoresSafeArea())
            .navigationTitle("Ajustes")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { IndicadorMotor() }
            }
            .refreshable {
                await modelo.refrescarArranque()
                await modelo.refrescarSesiones()
            }
            .task { await cargarConfig() }
            // «Dónde se está reproduciendo» al día mientras se ven los ajustes.
            .task { await modelo.vigilarSesiones() }
            .confirmationDialog(
                "¿Olvidar este servidor?", isPresented: $confirmarOlvidar, titleVisibility: .visible
            ) {
                Button("Olvidar", role: .destructive) {
                    Task { await modelo.desemparejar() }
                }
                Button("Cancelar", role: .cancel) {}
            }
            .confirmationDialog(
                "¿Reiniciar el motor AceStream?", isPresented: $confirmarReinicio, titleVisibility: .visible
            ) {
                Button("Reiniciar", role: .destructive) {
                    Task {
                        reiniciando = true
                        await modelo.reiniciarMotor()
                        reiniciando = false
                    }
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Se cortará lo que esté sonando en todos los dispositivos durante unos segundos y se recuperará solo.")
            }
            .confirmationDialog(
                "¿Emparejar de nuevo?", isPresented: $confirmarEmparejar, titleVisibility: .visible
            ) {
                Button("Emparejar de nuevo", role: .destructive) {
                    Task { await modelo.desemparejar() }
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Se olvidará este servidor y podrás emparejar con un código o escaneando el QR de la web.")
            }
        }
        .reservaMini()
    }

    // MARK: Tu fútbol

    private var seccionFutbol: some View {
        let gustos = modelo.gustos
        return Section {
            NavigationLink {
                GustosView()
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Ligas, equipos y nacionalidades", systemImage: "star")
                        .foregroundStyle(Tinta.texto)
                    Text(resumen(gustos))
                        .font(.footnote)
                        .foregroundStyle(Tinta.texto2)
                        .lineLimit(2)
                }
                .padding(.vertical, 2)
            }
            .accessibilityIdentifier("enlace-preferencias")
        } header: {
            Text("Tu fútbol")
        } footer: {
            Text("La agenda «Para ti» enseña los partidos de tus ligas, equipos y selecciones, con las mismas reglas que la web.")
        }
    }

    // MARK: Listas

    private var seccionListas: some View {
        let biblioteca = modelo.biblioteca
        let activa = biblioteca?.webSources.first { $0.id == biblioteca?.activeWebSourceId }
        return Section {
            NavigationLink {
                ListasView()
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Listas de canales", systemImage: "list.bullet.rectangle")
                        .foregroundStyle(Tinta.texto)
                    Text(
                        activa.map { "Activa: \($0.name) · \($0.count) canales · \(biblioteca?.webSources.count ?? 0) guardadas" }
                            ?? "Sin listas: guarda una M3U o HTML."
                    )
                    .font(.footnote)
                    .foregroundStyle(Tinta.texto2)
                    .lineLimit(2)
                }
                .padding(.vertical, 2)
            }
            .accessibilityIdentifier("enlace-listas")
        } header: {
            Text("Listas")
        }
    }

    private func resumen(_ gustos: GustosFutbol) -> String {
        guard ParaTi.tieneGustos(gustos) else { return "Sin elegir: la agenda enseña todos los partidos." }
        let todos = gustos.leagues + gustos.teams + gustos.nationalities
        let primeros = todos.prefix(4).joined(separator: ", ")
        return todos.count > 4 ? "\(primeros) y \(todos.count - 4) más" : primeros
    }

    // MARK: Servidor

    private var seccionServidor: some View {
        Section {
            TextField("Tailscale (umbrel.tail1234.ts.net:7792)", text: $textoTailscale)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Dirección de Tailscale")
                .accessibilityIdentifier("ajustes-tailscale")
            TextField("Red local (umbrel.local:7792)", text: $textoLan)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Dirección de la red local")
                .accessibilityIdentifier("ajustes-lan")
            if hayCambios {
                Button("Guardar direcciones") { Task { await guardarDirecciones() } }
                    .disabled(!direccionesValidas)
            }
            LabeledContent("Conexión") {
                Text(textoConexion)
                    .foregroundStyle(colorConexion)
            }
            Button("Comprobar ahora") {
                Task {
                    await modelo.entorno.servidores.invalidar()
                    await modelo.refrescarArranque()
                }
            }
            Button("Emparejar con otro servidor (código o QR)") { confirmarEmparejar = true }
        } header: {
            Text("Servidor")
        } footer: {
            Text("La app usa la dirección que responda: la de casa si estás en tu red y la de Tailscale fuera.")
        }
    }

    private var hayCambios: Bool {
        textoTailscale != (config.tailscale.map(Self.texto) ?? "") || textoLan != (config.lan.map(Self.texto) ?? "")
    }

    private var direccionesValidas: Bool {
        let tailscale = textoTailscale.trimmingCharacters(in: .whitespaces)
        let lan = textoLan.trimmingCharacters(in: .whitespaces)
        guard !(tailscale.isEmpty && lan.isEmpty) else { return false }
        return (tailscale.isEmpty || ServerConfig.normalizar(tailscale) != nil)
            && (lan.isEmpty || ServerConfig.normalizar(lan) != nil)
    }

    private static func texto(_ url: URL) -> String {
        var texto = url.absoluteString
        if texto.hasPrefix("http://") { texto.removeFirst("http://".count) }
        while texto.hasSuffix("/") { texto.removeLast() }
        return texto
    }

    private func cargarConfig() async {
        config = await modelo.entorno.servidores.configuracion()
        textoTailscale = config.tailscale.map(Self.texto) ?? ""
        textoLan = config.lan.map(Self.texto) ?? ""
    }

    private func guardarDirecciones() async {
        let tailscale = textoTailscale.trimmingCharacters(in: .whitespaces)
        let lan = textoLan.trimmingCharacters(in: .whitespaces)
        let nueva = ServerConfig(
            tailscale: tailscale.isEmpty ? nil : ServerConfig.normalizar(tailscale),
            lan: lan.isEmpty ? nil : ServerConfig.normalizar(lan))
        guard !nueva.vacia else { return }
        modelo.entorno.configuracion.guardar(nueva)
        await modelo.entorno.servidores.actualizar(nueva)
        await cargarConfig()
        modelo.avisos.mostrar("Direcciones guardadas", tono: .ok)
        await modelo.refrescarArranque()
    }

    private var textoConexion: String {
        switch modelo.conexion {
        case .conectando: "Conectando…"
        case .conectado(let servidor): "Por \(servidor.via.etiqueta)"
        case .sinConexion: "Sin conexión"
        }
    }

    private var colorConexion: Color {
        switch modelo.conexion {
        case .conectando: Tinta.texto2
        case .conectado: Tinta.okTinta
        case .sinConexion: Tinta.falloTinta
        }
    }

    // MARK: Motor

    private var seccionMotor: some View {
        Section {
            LabeledContent("Estado") {
                HStack(spacing: 6) {
                    Image(systemName: iconoMotor)
                        .symbolEffect(.pulse, isActive: modelo.motor?.status == .restarting || reiniciando)
                    Text(textoMotor)
                }
                .foregroundStyle(colorMotor)
            }
            .accessibilityElement(children: .combine)
            if let reinicios = modelo.motor?.autoRestarts, reinicios.lastHour > 0 {
                LabeledContent("Reinicios automáticos (última hora)", value: "\(reinicios.lastHour) de \(reinicios.max)")
            }
            Button("Reiniciar el motor", role: .destructive) { confirmarReinicio = true }
                .disabled(reiniciando || modelo.motor?.status == .restarting)
                .accessibilityIdentifier("boton-reiniciar-motor")
        } header: {
            Text("Motor AceStream")
        }
    }

    private var textoMotor: String {
        guard let motor = modelo.motor else { return "Comprobando…" }
        switch motor.status {
        case .online: return motor.engineVersion.map { "En marcha (\($0))" } ?? "En marcha"
        case .offline: return "No responde"
        case .restarting: return "Reiniciando"
        case .unknown, .desconocido: return "Comprobando…"
        }
    }

    private var iconoMotor: String {
        switch modelo.motor?.status {
        case .online: "checkmark.circle.fill"
        case .offline: "xmark.octagon.fill"
        case .restarting: "arrow.triangle.2.circlepath"
        default: "circle.dotted"
        }
    }

    private var colorMotor: Color {
        switch modelo.motor?.status {
        case .online: Tinta.okTinta
        case .offline: Tinta.falloTinta
        case .restarting: Tinta.flojaTinta
        default: Tinta.texto2
        }
    }

    // MARK: Reproducción

    private var seccionReproduccion: some View {
        Section {
            Picker(
                "Modo",
                selection: Binding(
                    get: { modelo.reproductor.modo },
                    set: { modelo.reproductor.cambiarModo($0) })
            ) {
                ForEach(PlaybackMode.allCases, id: \.self) { modo in
                    Text(modo.etiqueta).tag(modo)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("selector-modo")
        } header: {
            Text("Reproducción")
        } footer: {
            Text(explicacionModo)
        }
    }

    private var explicacionModo: String {
        let perfil = modelo.reproductor.modo.perfilIOS
        let segundos = Int(perfil.liveEdgeOffsetS)
        switch modelo.reproductor.modo {
        case .low: return "Baja latencia: \(segundos) s por detrás del directo. Más cerca del directo, pero se corta antes si la señal flojea."
        case .balanced: return "Equilibrado: \(segundos) s por detrás del directo. Lo recomendado."
        case .stable: return "Estable: \(segundos) s por detrás del directo. Aguanta mejor las señales irregulares."
        }
    }

    // MARK: Acerca de

    private var seccionAcercaDe: some View {
        Section("Acerca de") {
            LabeledContent("Versión", value: Self.version)
            LabeledContent("Compilación", value: Self.compilacion)
            if let version = modelo.versionServidor {
                LabeledContent("Servidor", value: version)
            }
            LabeledContent("Identificador", value: Bundle.main.bundleIdentifier ?? "—")
        }
    }

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    }

    static var compilacion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
    }
}
