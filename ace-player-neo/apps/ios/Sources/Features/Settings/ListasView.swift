import SwiftUI

/// Ajustes → Listas (como en la web): las listas guardadas con la activa
/// marcada (tocar una la activa), actualizar y borrar deslizando, y guardar
/// una lista remota M3U o HTML nueva.
struct ListasView: View {
    @Environment(AppModel.self) private var app
    @State private var nombre = ""
    @State private var direccion = ""
    @State private var tipo: WebSourceType = .m3u
    @State private var guardando = false
    @State private var actualizando: String?
    /// Lista con el borrado armado (segundo toque).
    @State private var borrando: String?
    @FocusState private var enfocado: Bool

    /// Tope de listas del servidor.
    static let maximo = 8

    var body: some View {
        let biblioteca = app.biblioteca
        let listas = biblioteca?.webSources ?? []
        Form {
            Group {
                Section {
                    if listas.isEmpty {
                        Text("Todavía no hay listas. Guarda una abajo.")
                            .foregroundStyle(Tinta.texto2)
                    }
                    ForEach(listas) { lista in
                        fila(lista, activa: lista.id == biblioteca?.activeWebSourceId)
                    }
                } header: {
                    Text("Listas guardadas · \(listas.count) de \(Self.maximo)")
                } footer: {
                    Text("Los canales de la lista en uso salen en Canales, en «Listas». Toca una para usarla; desliza para actualizarla o borrarla (borrar pide un segundo toque).")
                }

                Section {
                    TextField("Nombre, por ejemplo: Principal", text: $nombre)
                        .textInputAutocapitalization(.sentences)
                    TextField("https://…/lista.m3u", text: $direccion)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($enfocado)
                        .accessibilityIdentifier("campo-lista")
                    Picker("Tipo", selection: $tipo) {
                        Text("M3U").tag(WebSourceType.m3u)
                        Text("Página HTML").tag(WebSourceType.html)
                    }
                    .pickerStyle(.segmented)
                    Button {
                        Task { await guardar() }
                    } label: {
                        HStack {
                            if guardando { ProgressView() } else { Image(systemName: "plus") }
                            Text(guardando ? "Descargando la lista…" : "Guardar la lista")
                        }
                    }
                    .disabled(!valida || guardando || listas.count >= Self.maximo)
                    .accessibilityIdentifier("boton-guardar-lista")
                } header: {
                    Text("Guardar una lista remota")
                } footer: {
                    Text("Hasta \(Self.maximo) listas públicas; cada una conserva sus canales y se actualiza sola cada 3 h. Las direcciones de tu red local están bloqueadas por seguridad.")
                }
            }
        }
        .navigationTitle("Listas")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("pantalla-listas")
    }

    private var valida: Bool {
        let texto = direccion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: texto), let esquema = url.scheme?.lowercased() else { return false }
        return (esquema == "http" || esquema == "https") && url.host() != nil
    }

    private func fila(_ lista: WebSourceSummary, activa: Bool) -> some View {
        Button {
            guard !activa else { return }
            Task { await app.activarLista(lista.id) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: activa ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(activa ? Tinta.oro : Tinta.texto3)
                    .contentTransition(.symbolEffect(.replace))
                VStack(alignment: .leading, spacing: 2) {
                    Text(lista.name)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Tinta.texto)
                    Text(lista.url)
                        .font(.caption.monospaced())
                        .foregroundStyle(Tinta.texto3)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(detalle(lista))
                        .font(.caption)
                        .foregroundStyle(lista.lastError == nil ? Tinta.texto2 : Tinta.falloTinta)
                }
                Spacer(minLength: 4)
                if actualizando == lista.id { ProgressView() }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                borrar(lista)
            } label: {
                Label(borrando == lista.id ? "¿Borrar?" : "Borrar", systemImage: "trash")
            }
            Button {
                Task {
                    actualizando = lista.id
                    await app.sincronizarLista(url: lista.url, tipo: lista.type == .html ? .html : .m3u, id: lista.id)
                    actualizando = nil
                }
            } label: {
                Label("Actualizar", systemImage: "arrow.clockwise")
            }
            .tint(Tinta.oro)
        }
        .accessibilityLabel("\(lista.name), \(activa ? "en uso" : "guardada"), \(detalle(lista))")
        .accessibilityAddTraits(activa ? [.isSelected, .isButton] : [.isButton])
    }

    /// Borrar pide un segundo toque en 5 s (inventario §5).
    private func borrar(_ lista: WebSourceSummary) {
        if borrando == lista.id {
            borrando = nil
            Task { await app.borrarLista(lista.id) }
            return
        }
        borrando = lista.id
        app.avisos.mostrar("Desliza y toca «¿Borrar?» otra vez para borrar «\(lista.name)»")
        Task {
            try? await Task.sleep(for: .seconds(5))
            if borrando == lista.id { borrando = nil }
        }
    }

    private func detalle(_ lista: WebSourceSummary) -> String {
        var partes = [lista.count == 1 ? "1 canal" : "\(lista.count) canales", lista.type == .html ? "HTML" : "M3U"]
        if let fecha = lista.syncedAt.flatMap(FechaISO.parse) {
            partes.append("sincronizada \(ReglasBiblioteca.fechaCorta(fecha))")
        }
        if let error = lista.lastError, !error.isEmpty {
            partes.append("último intento: \(ErrorCatalog.mensaje(para: error))")
        }
        return partes.joined(separator: " · ")
    }

    private func guardar() async {
        let url = direccion.trimmingCharacters(in: .whitespacesAndNewlines)
        let limpio = nombre.trimmingCharacters(in: .whitespacesAndNewlines)
        guardando = true
        enfocado = false
        defer { guardando = false }
        if await app.sincronizarLista(url: url, nombre: limpio.isEmpty ? nil : limpio, tipo: tipo) {
            nombre = ""
            direccion = ""
        }
    }
}
