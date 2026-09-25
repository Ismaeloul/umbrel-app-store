import SwiftUI
import UIKit

/// Canales (la biblioteca de Palco), todo en una lista nativa: «Emitiendo
/// ahora» (carteles con el dorsal grande y lo que emiten), Favoritos (filas
/// con deslizar para borrar y Deshacer), Recientes por tramos y Listas con
/// el selector de la lista activa y las categorías plegadas. En iOS 17 lleva
/// el buscador aquí; desde iOS 18 la búsqueda vive en la pestaña Buscar.
///
/// Sin `safeAreaInset` arriba ni fondos propios: los del sistema.
struct CanalesView: View {
    @Environment(AppModel.self) private var app
    @State private var texto = ""
    @State private var desplegadas: Set<String> = []
    @State private var renombrando: Item?
    @State private var nuevoTitulo = ""
    @State private var antena = IndiceAntena.vacio
    @State private var pegando = false

    var body: some View {
        NavigationStack {
            contenido
                .navigationTitle("Canales")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            pegando = true
                        } label: {
                            Label("Pegar Content ID", systemImage: "doc.on.clipboard")
                        }
                        .accessibilityIdentifier("boton-pegar-canales")
                    }
                }
                .modifier(BuscableSoloEnIOS17(texto: $texto))
                .refreshable { await app.refrescarArranque() }
                .task(id: app.agenda?.generatedAt) { await vigilarAntena() }
                .alert(
                    "Editar título",
                    isPresented: Binding(get: { renombrando != nil }, set: { if !$0 { renombrando = nil } })
                ) {
                    TextField("Título", text: $nuevoTitulo)
                    Button("Cancelar", role: .cancel) { renombrando = nil }
                    Button("Guardar") { guardarTitulo() }
                } message: {
                    Text("Solo cambia cómo se ve en tus canales.")
                }
                .sheet(isPresented: $pegando) {
                    HojaPegar(canal: nil) { texto, _ in
                        guard let hash = ReglasFuentes.hashValido(texto) else {
                            app.avisos.mostrar(ReglasFuentes.textoHashNoValido, tono: .error)
                            return false
                        }
                        app.reproducirEnlace(hash)
                        return true
                    }
                    .presentationDetents([.medium])
                    .presentationCornerRadius(Medida.radioHoja)
                }
        }
        .reservaMini()
    }

    // MARK: Contenido

    @ViewBuilder private var contenido: some View {
        if let biblioteca = app.biblioteca {
            lista(biblioteca)
        } else {
            List {
                ForEach(0..<5, id: \.self) { _ in
                    FilaCanal(item: Item.muestra, favorito: false, antena: nil, subtitulo: "Deportes", caido: false)
                        .redacted(reason: .placeholder)
                }
            }
            .listStyle(.insetGrouped)
            .disabled(true)
        }
    }

    private func lista(_ biblioteca: LibraryView) -> some View {
        let buscando = !texto.trimmingCharacters(in: .whitespaces).isEmpty
        let favoritos = ReglasBiblioteca.filtrar(biblioteca.favorites, texto: texto)
        let recientes = ReglasBiblioteca.filtrar(biblioteca.history, texto: texto)
        let canalesLista = ReglasBiblioteca.filtrar(biblioteca.web, texto: texto)
        let emitiendo = buscando ? [] : emitiendoAhora(biblioteca)
        let idsLista = Set(biblioteca.web.map { $0.id.lowercased() })
        let enPantalla = app.reproductor.canal?.id.lowercased()
        return List {
            if !emitiendo.isEmpty {
                Section {
                    ScrollView(.horizontal) {
                        LazyHStack(alignment: .top, spacing: 12) {
                            ForEach(emitiendo, id: \.item.id) { entrada in
                                Button {
                                    abrir(entrada.item, en: emitiendo.map(\.item))
                                } label: {
                                    CartelCanal(
                                        item: entrada.item, antena: entrada.antena, favorito: app.esFavorito(entrada.item.id),
                                        enPantalla: enPantalla == entrada.item.id.lowercased())
                                }
                                .buttonStyle(.plain)
                                .contextMenu { menu(entrada.item, seccion: entrada.item.type == .web ? .listas : .favoritos) }
                            }
                        }
                        .scrollTargetLayout()
                        .padding(.vertical, 4)
                    }
                    .scrollTargetBehavior(.viewAligned)
                    .scrollIndicators(.hidden)
                    .contentMargins(.horizontal, Medida.margen, for: .scrollContent)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                } header: {
                    CabeceraFila(titulo: "Emitiendo ahora", cuenta: emitiendo.count, directo: true)
                        .textCase(nil)
                        .padding(.horizontal, 4)
                }
            }

            Section {
                if favoritos.isEmpty {
                    if buscando {
                        Text("Nada en favoritos con «\(texto)».")
                            .font(.subheadline)
                            .foregroundStyle(Tinta.texto2)
                    } else {
                        EstadoVacio(
                            icono: "star", titulo: "Aún no tienes favoritos",
                            texto: "Marca un canal con la estrella (mantén pulsado o desliza a la derecha en Recientes o Listas)."
                        ) {
                            EmptyView()
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                } else {
                    ForEach(favoritos) { item in
                        fila(item, en: favoritos, seccion: .favoritos, idsLista: idsLista, enPantalla: enPantalla)
                    }
                }
            } header: {
                CabeceraFila(titulo: "Favoritos", cuenta: biblioteca.favorites.isEmpty ? nil : favoritos.count)
                    .textCase(nil)
                    .padding(.horizontal, 4)
            }

            if recientes.isEmpty {
                if !buscando {
                    Section {
                        EstadoVacio(icono: "clock", titulo: "Aún no has visto nada", texto: "Lo que veas irá quedando aquí.") {
                            EmptyView()
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    } header: {
                        CabeceraFila(titulo: "Recientes").textCase(nil).padding(.horizontal, 4)
                    }
                }
            } else {
                ForEach(Array(ReglasBiblioteca.porTramos(recientes).enumerated()), id: \.element.id) { indice, grupo in
                    Section {
                        ForEach(grupo.items) { item in
                            fila(item, en: recientes, seccion: .recientes, idsLista: idsLista, enPantalla: enPantalla)
                        }
                    } header: {
                        if indice == 0 {
                            CabeceraFila(titulo: "Recientes", cuenta: recientes.count, subtitulo: grupo.tramo)
                                .textCase(nil)
                                .padding(.horizontal, 4)
                        } else {
                            Text(grupo.tramo)
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(Tinta.texto2)
                                .textCase(nil)
                        }
                    }
                }
            }

            cabeceraListas(biblioteca)
            if canalesLista.isEmpty {
                Section {
                    if buscando {
                        Text("Nada en la lista con «\(texto)».")
                            .font(.subheadline)
                            .foregroundStyle(Tinta.texto2)
                    } else {
                        EstadoVacio(
                            icono: "list.bullet.rectangle", titulo: "Sin lista",
                            texto: "Guarda una lista M3U o HTML en Ajustes › Listas y sus canales saldrán aquí."
                        ) {
                            NavigationLink("Ir a Listas") { ListasView() }
                                .buttonStyle(.bordered)
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
            } else {
                ForEach(ReglasBiblioteca.porCategoria(canalesLista)) { grupo in
                    seccionCategoria(grupo, todos: canalesLista, idsLista: idsLista, enPantalla: enPantalla)
                }
            }

            Section {
                Label(ReglasBiblioteca.pie(biblioteca), systemImage: "list.bullet")
                    .font(.caption)
                    .foregroundStyle(Tinta.texto3)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .animation(Muelle.estandar, value: desplegadas)
        .accessibilityIdentifier("lista-biblioteca")
    }

    /// Canales de la biblioteca que dan un partido en juego ahora mismo.
    private func emitiendoAhora(_ biblioteca: LibraryView) -> [(item: Item, antena: EnAntena)] {
        var vistos = Set<String>()
        var resultado: [(item: Item, antena: EnAntena)] = []
        for item in biblioteca.favorites + biblioteca.web + biblioteca.history {
            guard vistos.insert(item.id.lowercased()).inserted else { continue }
            guard let antena = antena.para(titulo: item.title, alias: item.alias, marcadores: app.marcadores), antena.enDirecto
            else { continue }
            resultado.append((item, antena))
        }
        return resultado
    }

    /// La lista activa, cuándo se sincronizó y el menú para cambiarla.
    private func cabeceraListas(_ biblioteca: LibraryView) -> some View {
        let activa = biblioteca.webSources.first { $0.id == biblioteca.activeWebSourceId }
        return Section {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(activa?.name ?? "Tu lista")
                        .font(.headline)
                        .foregroundStyle(Tinta.texto)
                    Text(detalleLista(activa, biblioteca: biblioteca))
                        .font(.caption)
                        .foregroundStyle(Tinta.texto2)
                }
                Spacer(minLength: 8)
                if biblioteca.webSources.count > 1 {
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
                        Label("Cambiar", systemImage: "list.bullet")
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .accessibilityLabel("Elegir la lista activa")
                    .accessibilityIdentifier("selector-lista")
                } else {
                    NavigationLink {
                        ListasView()
                    } label: {
                        Text("Gestionar")
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                }
            }
        } header: {
            CabeceraFila(titulo: "Listas", cuenta: biblioteca.webSources.isEmpty ? nil : biblioteca.webSources.count)
                .textCase(nil)
                .padding(.horizontal, 4)
        }
    }

    private func detalleLista(_ activa: WebSourceSummary?, biblioteca: LibraryView) -> String {
        var partes = [biblioteca.web.count == 1 ? "1 canal" : "\(biblioteca.web.count) canales"]
        if let fecha = (activa?.syncedAt ?? biblioteca.webSyncedAt).flatMap(FechaISO.parse) {
            partes.append("actualizada \(ReglasBiblioteca.fechaCorta(fecha))")
        }
        if activa?.lastError != nil { partes.append("último intento con error") }
        return partes.joined(separator: " · ")
    }

    /// Una categoría plegable: la cabecera con su recuento y, desplegada, sus canales.
    @ViewBuilder
    private func seccionCategoria(_ grupo: GrupoCategoria, todos: [Item], idsLista: Set<String>, enPantalla: String?) -> some View {
        // Buscando, se despliegan solas las que tienen resultados.
        let abierta = !texto.isEmpty || desplegadas.contains(grupo.categoria)
        Section {
            Button {
                withAnimation(Muelle.estandar) {
                    if desplegadas.contains(grupo.categoria) {
                        desplegadas.remove(grupo.categoria)
                    } else {
                        desplegadas.insert(grupo.categoria)
                    }
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(Tinta.texto2)
                        .rotationEffect(.degrees(abierta ? 90 : 0))
                    Text(grupo.categoria)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Tinta.texto)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text("\(grupo.items.count)")
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Tinta.texto3)
                }
                .frame(minHeight: Medida.toque)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hapticoSeleccion(trigger: abierta)
            .accessibilityLabel("\(grupo.categoria), \(grupo.items.count) canales")
            .accessibilityValue(abierta ? "desplegada" : "plegada")
            .accessibilityHint(abierta ? "Toca para plegar" : "Toca para ver sus canales")
            .accessibilityIdentifier("categoria-\(grupo.categoria)")

            if abierta {
                ForEach(grupo.items) { item in
                    fila(item, en: todos, seccion: .listas, idsLista: idsLista, enPantalla: enPantalla)
                }
            }
        }
    }

    private func fila(_ item: Item, en lista: [Item], seccion: SeccionBiblioteca, idsLista: Set<String>, enPantalla: String?)
        -> some View
    {
        // «Canal caído» solo en favoritos (los que vinieron de la lista y ya no están).
        let caido = seccion == .favoritos && item.fromWebSync && ReglasBiblioteca.caido(item, idsLista: idsLista)
        return Button {
            abrir(item, en: lista)
        } label: {
            FilaCanal(
                item: item,
                favorito: seccion != .favoritos && app.esFavorito(item.id),
                antena: antena.para(titulo: item.title, alias: item.alias, marcadores: app.marcadores),
                subtitulo: ReglasBiblioteca.subtitulo(item, seccion: seccion),
                caido: caido,
                enPantalla: enPantalla == item.id.lowercased()
            )
        }
        .foregroundStyle(Tinta.texto)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if seccion != .listas {
                Button(role: .destructive) {
                    borrar(item, seccion: seccion)
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
                .tint(Tinta.oro)
            }
        }
        .contextMenu { menu(item, seccion: seccion) }
    }

    @ViewBuilder
    private func menu(_ item: Item, seccion: SeccionBiblioteca) -> some View {
        Button {
            abrir(item, en: [item])
        } label: {
            Label("Ver canal", systemImage: "play.fill")
        }
        Button {
            Task { await app.alternarFavorito(id: item.id, titulo: item.title, ih: item.ih) }
        } label: {
            Label(app.esFavorito(item.id) ? "Quitar de favoritos" : "Guardar en favoritos", systemImage: "star")
        }
        if seccion != .listas {
            Button {
                nuevoTitulo = item.title
                renombrando = item
            } label: {
                Label("Renombrar", systemImage: "pencil")
            }
        }
        Menu {
            Button {
                if let url = URL(string: "acestream://\(item.id)") { UIApplication.shared.open(url) }
            } label: {
                Label("Abrir en la app de AceStream", systemImage: "arrow.up.forward.app")
            }
            Button {
                UIPasteboard.general.string = "acestream://\(item.id)"
                app.avisos.mostrar("Enlace copiado", tono: .ok)
            } label: {
                Label("Copiar enlace", systemImage: "link")
            }
        } label: {
            Label("Abrir en…", systemImage: "square.and.arrow.up")
        }
        if seccion != .listas {
            Button(role: .destructive) {
                borrar(item, seccion: seccion)
            } label: {
                Label(seccion == .recientes ? "Quitar de recientes" : "Borrar", systemImage: "trash")
            }
        }
    }

    // MARK: Acciones

    /// Reproduce y abre el escenario del canal.
    private func abrir(_ item: Item, en lista: [Item]) {
        app.abrirCanal(app.canalReproducible(item), lista: lista.map { app.canalReproducible($0) })
    }

    /// Borra ya (se ve al instante) y ofrece deshacer durante 5 s.
    private func borrar(_ item: Item, seccion: SeccionBiblioteca) {
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
        let coleccion: LibraryCollection = item.type == .recent ? .history : .favorites
        Task { await app.mutar(.rename(collection: coleccion, id: item.id, title: titulo), aviso: "Título cambiado") }
    }

    /// Qué emite cada canal: se recalcula con la agenda y cada minuto.
    private func vigilarAntena() async {
        await app.cargarAgendaGuardada()
        while !Task.isCancelled {
            antena = IndiceAntena(agenda: app.agenda, reloj: RelojMadrid(.now))
            try? await Task.sleep(for: .seconds(60))
        }
    }
}

/// En iOS 17 la búsqueda va aquí (no hay pestaña Buscar con `Tab(role: .search)`).
private struct BuscableSoloEnIOS17: ViewModifier {
    @Binding var texto: String

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content
        } else {
            content.searchable(
                text: $texto, placement: .navigationBarDrawer(displayMode: .always), prompt: "Buscar en tus canales")
        }
    }
}

/// Filtro de la búsqueda local (se mantiene por compatibilidad con los tests).
enum FiltroBiblioteca {
    static func filtrar(_ items: [Item], texto: String) -> [Item] {
        ReglasBiblioteca.filtrar(items, texto: texto)
    }

    static func normalizar(_ texto: String) -> String {
        ReglasBiblioteca.plegar(texto)
    }
}

/// Un canal de la biblioteca: su dorsal, el título, lo que emite hoy y la categoría.
struct FilaCanal: View {
    let item: Item
    let favorito: Bool
    let antena: EnAntena?
    let subtitulo: String?
    let caido: Bool
    var enPantalla = false

    var body: some View {
        HStack(spacing: 12) {
            LogoCanal(titulo: item.title, tamano: 46)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Tinta.texto)
                    .lineLimit(2)
                if let antena {
                    LineaAntena(antena: antena)
                }
                if caido {
                    Label("Ya no está en tu lista", systemImage: "exclamationmark.triangle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Tinta.flojaTinta)
                } else if enPantalla {
                    Label("En pantalla", systemImage: "waveform")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Tinta.acentoTinta)
                } else if let subtitulo {
                    Text(subtitulo.uppercased())
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Tinta.texto3)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if favorito {
                Image(systemName: "star.fill")
                    .font(.footnote)
                    .foregroundStyle(Tinta.oro)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 2)
        .frame(minHeight: Medida.toque)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(etiqueta)
        .accessibilityAddTraits(.isButton)
    }

    private var etiqueta: String {
        var partes = [item.title]
        if let antena {
            partes.append(
                antena.enDirecto
                    ? "emitiendo \(FormatoAgenda.equipos(antena.partido))"
                    : "a las \(antena.partido.time), \(FormatoAgenda.equipos(antena.partido))")
        }
        if caido { partes.append("ya no está en tu lista") } else if let subtitulo { partes.append(subtitulo) }
        if favorito { partes.append("favorito") }
        if enPantalla { partes.append("en pantalla") }
        return partes.joined(separator: ", ")
    }
}

/// «● Real Madrid 1–0 Getafe» si está en juego; «A las 21:00, España – Marruecos» si es el siguiente.
/// El marcador del partido que suena en este iPhone va tapado (anti-spoiler), como en la web.
struct LineaAntena: View {
    @Environment(AppModel.self) private var app
    let antena: EnAntena

    var body: some View {
        let partido = antena.partido
        HStack(spacing: 6) {
            HStack(spacing: -5) {
                MarcaEquipo(partido.home, tamano: 16)
                if !partido.away.isEmpty { MarcaEquipo(partido.away, tamano: 16) }
            }
            .accessibilityHidden(true)
            if antena.enDirecto {
                Circle().fill(Tinta.directo).frame(width: 6, height: 6)
                Text(textoDirecto(partido))
                    .foregroundStyle(Tinta.directo)
            } else if ReglasAgenda.minutosDeHora(partido.time) != nil {
                Text("A las \(partido.time), \(FormatoAgenda.equipos(partido))")
                    .foregroundStyle(Tinta.texto2)
            } else {
                Text("Hoy, hora por confirmar: \(FormatoAgenda.equipos(partido))")
                    .foregroundStyle(Tinta.texto2)
            }
        }
        .font(.caption.weight(.medium))
        .lineLimit(1)
    }

    private func textoDirecto(_ partido: FootballMatch) -> String {
        guard !partido.away.isEmpty else { return partido.title }
        if app.marcadorTapado(partido) {
            return "\(partido.home) – \(partido.away) · marcador oculto"
        }
        if let marcador = antena.marcador, marcador.state == "in" || marcador.state == "post" {
            return "\(partido.home) \(marcador.home)–\(marcador.away) \(partido.away)"
        }
        return "\(partido.home) – \(partido.away)"
    }
}

extension Item {
    /// Canal de relleno para el esqueleto de carga.
    static let muestra = Item(
        id: "0000000000000000000000000000000000000000", title: "Canal de ejemplo", alias: nil, type: .fav,
        category: "Deportes", date: "2026-01-01T00:00:00.000Z", fromWebSync: false, ih: false)
}
