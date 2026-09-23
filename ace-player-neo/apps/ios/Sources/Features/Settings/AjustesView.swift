import SwiftUI

/// Ajustes mínimos: servidor, motor, «Acerca de» y olvidar el servidor.
struct AjustesView: View {
    @Environment(AppModel.self) private var modelo
    @State private var config = ServerConfig()
    @State private var confirmarOlvidar = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Servidor") {
                    LabeledContent("Tailscale", value: config.tailscale?.absoluteString ?? "Sin configurar")
                    LabeledContent("Red local", value: config.lan?.absoluteString ?? "Sin configurar")
                    LabeledContent("Conexión", value: textoConexion)
                    if let version = modelo.versionServidor {
                        LabeledContent("Versión del servidor", value: version)
                    }
                }
                Section("Motor AceStream") {
                    LabeledContent("Estado", value: textoMotor)
                }
                Section("Acerca de") {
                    LabeledContent("Versión", value: Self.version)
                    LabeledContent("Compilación", value: Self.compilacion)
                }
                Section {
                    Button("Olvidar este servidor", role: .destructive) { confirmarOlvidar = true }
                        .accessibilityIdentifier("boton-olvidar")
                } footer: {
                    Text("Borra el token del Llavero y las direcciones. Para volver a usar la app habrá que emparejarla otra vez.")
                }
            }
            .navigationTitle("Ajustes")
            .task { config = await modelo.entorno.servidores.configuracion() }
            .confirmationDialog(
                "¿Olvidar este servidor?", isPresented: $confirmarOlvidar, titleVisibility: .visible
            ) {
                Button("Olvidar", role: .destructive) {
                    Task { await modelo.desemparejar() }
                }
                Button("Cancelar", role: .cancel) {}
            }
        }
    }

    private var textoConexion: String {
        switch modelo.conexion {
        case .conectando: "Conectando…"
        case .conectado(let servidor): "Por \(servidor.via.etiqueta)"
        case .sinConexion: "Sin conexión"
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

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    }

    static var compilacion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
    }
}
