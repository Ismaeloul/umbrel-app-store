import SwiftUI
import UIKit

/// Qué parte de la biblioteca se ve.
enum SeccionBiblioteca: String, CaseIterable, Identifiable {
    case favoritos, recientes, listas
    var id: String { rawValue }

    var titulo: String {
        switch self {
        case .favoritos: "Favoritos"
        case .recientes: "Recientes"
        case .listas: "Listas"
        }
    }

    var coleccion: LibraryCollection {
        switch self {
        case .favoritos: .favorites
        case .recientes: .history
        case .listas: .web
        }
    }
}

/// Filtro de la búsqueda local (título, alias y categoría, sin acentos).
enum FiltroBiblioteca {
    static func filtrar(_ items: [Item], texto: String) -> [Item] {
        let buscado = normalizar(texto)
        guard !buscado.isEmpty else { return items }
        return items.filter { item in
            [item.title, item.alias ?? "", item.category].contains { normalizar($0).contains(buscado) }
        }
    }

    static func normalizar(_ texto: String) -> String {
        texto.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es_ES"))
            .trimmingCharacters(in: .whitespaces)
    }
}

/// Biblioteca: favoritos, recientes y listas, con búsqueda, deslizar para
/// borrar con «Deshacer» y editar el título.
struct BibliotecaView: View {
    @Environment(AppModel.self) private var app
    @State private var seccion: SeccionBiblioteca = .favoritos
    @State private var texto = ""
    @State private var ruta: [CanalReproducible] = []
    @State private var renombrando: Item?
    @State private var nuevoTitulo = ""
    @Namespace private var mini

    var body: some View {
        NavigationStack(path: $ruta) {
            contenido
                .navigationTitle("Biblioteca")
                .background(Tinta.fondo.ignoresSafeArea())
                .scrollContentBackground(.hidden)
                .searchable(text: $texto, prompt: "Buscar en \(seccion.titulo.lowercased())")
                .safeAreaInset(edge: .top, spacing: 0) { selector }
                .refreshable { await app.refrescarArranque() }
                .toolbar { menuListas }
                .navigationDestination(for: CanalReproducible.self) { canal in
                    CanalView(canal: canal)
                }
                .alert("Editar título", isPresented: Binding(get: { renombrando != nil }, set: { if !$0 { renombrando = nil } })) {
                    TextField("Título", text: $nuevoTitulo)
                    Button("Cancelar", role: .cancel) { renombrando = nil }
                    Button("Guardar") { guardarTitulo() }
                } message: {
                    Text("Solo cambia cómo se ve en tu biblioteca.")
                }
        }
        .conMiniReproductor(app, espacio: mini)
    }

    private var selector: some View {
        Picker("Sección", selection: $seccion) {
            ForEach(SeccionBiblioteca.allCases) { seccion in
                Text(seccion.titulo).tag(seccion)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, Medida.margen)
        .padding(.vertical, 8)
        .background(.bar)
        .accessibilityIdentifier("selector-biblioteca")
    }

    private var items: [Item] {
        guard let biblioteca = app.biblioteca else { return [] }
        switch seccion {
        case .favoritos: return biblioteca.favorites
        case .recientes: return biblioteca.history
        case .listas: return biblioteca.web
        }
    }

    @ViewBuilder private var contenido: some View {
        let visibles = FiltroBiblioteca.filtrar(items, texto: texto)
        if app.biblioteca == nil {
            List {
                ForEach(0..<5, id: \.self) { _ in
                    FilaCanal(item: Item.muestra, favorito: false)
                        .listRowBackground(Tinta.superficie)
                }
            }
            .redacted(reason: .placeholder)
            .disabled(true)
        } else if visibles.isEmpty {
            vacio
        } else {
            List {
                ForEach(visibles) { item in
                    Button {
                        abrir(item, en: visibles)
                    } label: {
                        FilaCanal(item: item, favorito: app.esFavorito(item.id))
                    }
                    .foregroundStyle(Tinta.texto)
                    .listRowBackground(Tinta.superficie)
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        if seccion != .listas {
                            Button(role: .destructive) {
                                borrar(item)
                            } label: {
                                Label("Borrar", systemImage: "trash")
                            }
                            .accessibilityIdentifier("boton-borrar")
                        }
                    }
                    .swipeActions(edge: .leading) {
                        if seccion != .favoritos {
                            Button {
                                Task { await app.alternarFavorito(id: item.id, titulo: item.title, ih: item.ih) }
                            } label: {
                                Label(app.esFavorito(item.id) ? "Quitar" : "Favorito", systemImage: "star")
                            }
                            .tint(Tinta.acento)
                        }
                    }
                    .contextMenu { menu(item) }
                }
            }
            .listStyle(.insetGrouped)
            .animation(Muelle.estandar, value: visibles.map(\.id))
            .accessibilityIdentifier("lista-biblioteca")
        }
    }

    @ViewBuilder private var vacio: some View {
        if !texto.isEmpty {
            ContentUnavailableView.search(text: texto)
        } else {
            switch seccion {
            case .favoritos:
                ContentUnavailableView(
                    "Sin favoritos", systemImage: "star",
                    description: Text("Marca un canal con la estrella y aparecerá aquí."))
            case .recientes:
                ContentUnavailableView(
                    "Nada reciente", systemImage: "clock",
                    description: Text("Los canales que veas se guardan aquí."))
            case .listas:
                ContentUnavailableView(
                    "Sin listas", systemImage: "list.bullet.rectangle",
                    description: Text("Añade una lista M3U desde la web de Ace Player Neo."))
            }
        }
    }

    @ToolbarContentBuilder private var menuListas: some ToolbarContent {
        if seccion == .listas, let biblioteca = app.biblioteca, biblioteca.webSources.count > 1 {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(
                        "Lista activa",
                        selection: Binding(
                            get: { biblioteca.activeWebSourceId },
                            set: { id in Task { await app.activarLista(id) } })
                    ) {
                        ForEach(biblioteca.webSources) { lista in
                            Text("\(lista.name) (\(lista.count))").tag(lista.id)
                        }
                    }
                } label: {
                    Label("Lista", systemImage: "list.bullet")
                }
                .accessibilityLabel("Elegir lista")
            }
        }
    }

    @ViewBuilder
    private func menu(_ item: Item) -> some View {
        Button {
            Task { await app.alternarFavorito(id: item.id, titulo: item.title, ih: item.ih) }
        } label: {
            Label(app.esFavorito(item.id) ? "Quitar de favoritos" : "Añadir a favoritos", systemImage: "star")
        }
        if seccion != .listas {
            Button {
                nuevoTitulo = item.title
                renombrando = item
            } label: {
                Label("Editar título", systemImage: "pencil")
            }
        }
        Button {
            UIPasteboard.general.string = item.id
            app.avisos.mostrar("Content ID copiado", tono: .ok)
        } label: {
            Label("Copiar Content ID", systemImage: "doc.on.doc")
        }
        if seccion != .listas {
            Button(role: .destructive) {
                borrar(item)
            } label: {
                Label("Borrar", systemImage: "trash")
            }
        }
    }

    // MARK: Acciones

    private func canal(_ item: Item) -> CanalReproducible {
        CanalReproducible(
            id: item.id, titulo: item.title, ih: item.ih,
            listaId: item.type == .web ? app.biblioteca?.activeWebSourceId : nil,
            origen: item.type == .web ? "m3u" : (item.type == .fav ? "favorites" : "history"))
    }

    private func abrir(_ item: Item, en lista: [Item]) {
        let elegido = canal(item)
        app.reproducirCanal(elegido, lista: lista.map(canal))
        ruta.append(elegido)
    }

    /// Borra ya (se ve al instante) y ofrece deshacer durante 5 s.
    private func borrar(_ item: Item) {
        guard var biblioteca = app.biblioteca else { return }
        let coleccion = seccion.coleccion
        switch coleccion {
        case .favorites: biblioteca.favorites.removeAll { $0.id == item.id }
        case .history: biblioteca.history.removeAll { $0.id == item.id }
        case .web: return
        }
        app.aplicarBiblioteca(biblioteca)
        Task { await app.mutar(.delete(collection: coleccion, id: item.id)) }
        app.avisos.mostrar(Aviso("«\(item.title)» borrado", accion: "Deshacer", duracion: 5)) {
            let entrada = ItemInput(
                id: item.id, title: item.title, category: item.category, alias: item.alias, date: item.date,
                fromWebSync: item.fromWebSync, ih: item.ih)
            Task {
                await app.mutar(coleccion == .favorites ? .favoriteUpsert(entrada) : .historyUpsert(entrada))
            }
        }
    }

    private func guardarTitulo() {
        guard let item = renombrando else { return }
        let titulo = nuevoTitulo.trimmingCharacters(in: .whitespacesAndNewlines)
        renombrando = nil
        guard !titulo.isEmpty, titulo != item.title else { return }
        let coleccion = seccion.coleccion
        Task { await app.mutar(.rename(collection: coleccion, id: item.id, title: titulo), aviso: "Título cambiado") }
    }
}

/// Un canal de la biblioteca.
struct FilaCanal: View {
    let item: Item
    let favorito: Bool

    var body: some View {
        HStack(spacing: 12) {
            MarcaEquipo(item.title, tamano: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Tinta.texto)
                    .lineLimit(2)
                if let subtitulo {
                    Text(subtitulo)
                        .font(.caption)
                        .foregroundStyle(Tinta.texto2)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if favorito {
                Image(systemName: "star.fill")
                    .foregroundStyle(Tinta.acentoTinta)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: Medida.toque)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([item.title, subtitulo, favorito ? "favorito" : nil].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(.isButton)
    }

    private var subtitulo: String? {
        let partes = [item.alias, item.category.isEmpty ? nil : item.category, item.ih ? "infohash" : nil]
            .compactMap { $0 }
        return partes.isEmpty ? nil : partes.joined(separator: " · ")
    }
}

extension Item {
    /// Canal de relleno para el esqueleto de carga.
    static let muestra = Item(
        id: "0000000000000000000000000000000000000000", title: "Canal de ejemplo", alias: nil, type: .fav,
        category: "Deportes", date: "2026-01-01T00:00:00.000Z", fromWebSync: false, ih: false)
}

// MARK: - Centro de canal

/// Un canal suelto (biblioteca o búsqueda): el reproductor y sus acciones.
struct CanalView: View {
    @Environment(AppModel.self) private var app
    let canal: CanalReproducible

    private var suenaAqui: Bool { app.reproductor.canal?.id == canal.id }

    var body: some View {
        let favorito = app.esFavorito(canal.id)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if suenaAqui {
                    ReproductorIntegrado()
                } else {
                    Button {
                        app.reproducirCanal(canal)
                    } label: {
                        ZStack {
                            RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous)
                                .fill(Tinta.fondoHundido)
                            Label("Ver", systemImage: "play.fill")
                                .font(.headline)
                        }
                        .aspectRatio(16 / 9, contentMode: .fit)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Ver \(canal.titulo)")
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(canal.titulo)
                        .font(.titular(.title2))
                        .foregroundStyle(Tinta.texto)
                    Text(canal.id)
                        .font(.caption.monospaced())
                        .foregroundStyle(Tinta.texto3)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                HStack(spacing: 10) {
                    Button {
                        Task { await app.alternarFavorito(id: canal.id, titulo: canal.titulo, ih: canal.ih) }
                    } label: {
                        Label(favorito ? "En favoritos" : "Favorito", systemImage: favorito ? "star.fill" : "star")
                            .symbolEffect(.bounce, value: favorito)
                    }
                    .sensoryFeedback(.success, trigger: favorito)
                    .accessibilityIdentifier("boton-favorito-canal")
                    Menu {
                        ForEach(ReglasFuentes.motivosReporte) { opcion in
                            Button(opcion.texto) { Task { await reportar(opcion.motivo) } }
                        }
                    } label: {
                        Label("Reportar", systemImage: "flag")
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
            .padding(.horizontal, Medida.margen)
        }
        .background(Tinta.fondo.ignoresSafeArea())
        .navigationTitle("Canal")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("centro-canal")
    }

    private func reportar(_ motivo: SourceReportReason) async {
        let cuerpo = ReportBody(id: canal.id, reason: motivo, title: canal.titulo, source: canal.origen, ih: canal.ih)
        do {
            _ = try await app.entorno.api.enviar(API.reportarFuente(cuerpo))
            app.avisos.mostrar("Canal reportado: se vuelve a comprobar", tono: .ok)
        } catch {
            app.avisos.mostrar(APIError.desde(error).mensaje, tono: .error)
        }
    }
}
