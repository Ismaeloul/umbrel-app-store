import SwiftUI
import UIKit

/// Biblioteca, como la de la web: el título grande arriba, el buscador y,
/// dentro de la lista, el selector Favoritos / Recientes / Listas con sus
/// recuentos. Favoritos con lo que emite cada canal hoy; Recientes por
/// tramos (hoy, ayer…); Listas AGRUPADAS por categoría en secciones
/// plegables con su recuento y el selector de la lista activa. Deslizar para
/// borrar con «Deshacer», marcar favorito y editar el título.
///
/// Sin `safeAreaInset` arriba: en el iPhone de verdad el selector metido ahí
/// dejaba una banda vacía enorme encima y el título debajo.
struct BibliotecaView: View {
    @Environment(AppModel.self) private var app
    @State private var seccionElegida: SeccionBiblioteca?
    @State private var texto = ""
    @State private var desplegadas: Set<String> = []
    @State private var renombrando: Item?
    @State private var nuevoTitulo = ""
    @State private var antena = IndiceAntena.vacio

    private var seccion: SeccionBiblioteca {
        if let seccionElegida { return seccionElegida }
        return app.biblioteca.map(ReglasBiblioteca.seccionInicial) ?? .favoritos
    }

    var body: some View {
        NavigationStack {
            contenido
                .navigationTitle("Biblioteca")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { IndicadorMotor() }
                }
                .background(Tinta.fondo.ignoresSafeArea())
                .scrollContentBackground(.hidden)
                .searchable(
                    text: $texto, placement: .navigationBarDrawer(displayMode: .always),
                    prompt: "Buscar en \(seccion.titulo.lowercased())")
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
                    Text("Solo cambia cómo se ve en tu biblioteca.")
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
                selector(nil)
                ForEach(0..<5, id: \.self) { _ in
                    FilaCanal(item: Item.muestra, favorito: false, antena: nil, subtitulo: "Deportes", caido: false)
                        .listRowBackground(Tinta.superficie)
                        .redacted(reason: .placeholder)
                }
            }
            .listStyle(.insetGrouped)
            .disabled(true)
        }
    }

    private func lista(_ biblioteca: LibraryView) -> some View {
        let todos = ReglasBiblioteca.items(biblioteca, seccion)
        let visibles = ReglasBiblioteca.filtrar(todos, texto: texto)
        return List {
            selector(biblioteca)

            if seccion == .listas {
                cabeceraListas(biblioteca)
            }

            if visibles.isEmpty {
                Section {
                    vacio
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            } else {
                switch seccion {
                case .favoritos:
                    Section {
                        ForEach(visibles) { item in fila(item, en: visibles, biblioteca: biblioteca) }
                    }
                case .recientes:
                    ForEach(ReglasBiblioteca.porTramos(visibles)) { grupo in
                        Section {
                            ForEach(grupo.items) { item in fila(item, en: visibles, biblioteca: biblioteca) }
                        } header: {
                            Text(grupo.tramo)
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(Tinta.texto2)
                                .textCase(nil)
                        }
                    }
                case .listas:
                    ForEach(ReglasBiblioteca.porCategoria(visibles)) { grupo in
                        seccionCategoria(grupo, biblioteca: biblioteca, todos: visibles)
                    }
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
        .animation(Muelle.estandar, value: visibles.map(\.id))
        .animation(Muelle.estandar, value: desplegadas)
        .accessibilityIdentifier("lista-biblioteca")
    }

    /// Favoritos · Recientes · Listas con sus recuentos (primera fila de la lista).
    private func selector(_ biblioteca: LibraryView?) -> some View {
        Picker(
            "Sección",
            selection: Binding(
                get: { seccion },
                set: { nueva in
                    withAnimation(Muelle.estandar) { seccionElegida = nueva }
                })
        ) {
            ForEach(SeccionBiblioteca.allCases) { opcion in
                let cuenta = biblioteca.map { ReglasBiblioteca.items($0, opcion).count }
                Text(cuenta.map { "\(opcion.titulo) \($0)" } ?? opcion.titulo).tag(opcion)
            }
        }
        .pickerStyle(.segmented)
        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0))
        .listRowBackground(Color.clear)
        .sensoryFeedback(.selection, trigger: seccion)
        .accessibilityIdentifier("selector-biblioteca")
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
                    .accessibilityLabel("Elegir la lista activa")
                    .accessibilityIdentifier("selector-lista")
                }
            }
            .listRowBackground(Tinta.superficie)
        }
    }

    private func detalleLista(_ activa: WebSourceSummary?, biblioteca: LibraryView) -> String {
        var partes = [biblioteca.web.count == 1 ? "1 canal" : "\(biblioteca.web.count) canales"]
        if let fecha = (activa?.syncedAt ?? biblioteca.webSyncedAt).flatMap(FechaISO.parse) {
            partes.append("sincronizada \(ReglasBiblioteca.fechaCorta(fecha))")
        }
        if activa?.lastError != nil { partes.append("último intento con error") }
        return partes.joined(separator: " · ")
    }

    /// Una categoría plegable: la cabecera con su recuento y, desplegada, sus canales.
    @ViewBuilder
    private func seccionCategoria(_ grupo: GrupoCategoria, biblioteca: LibraryView, todos: [Item]) -> some View {
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
                    Text(grupo.categoria.uppercased())
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
            .listRowBackground(Tinta.superficie2)
            .accessibilityLabel("\(grupo.categoria), \(grupo.items.count) canales")
            .accessibilityValue(abierta ? "desplegada" : "plegada")
            .accessibilityHint(abierta ? "Toca para plegar" : "Toca para ver sus canales")
            .accessibilityIdentifier("categoria-\(grupo.categoria)")

            if abierta {
                ForEach(grupo.items) { item in fila(item, en: todos, biblioteca: biblioteca) }
            }
        }
    }

    private func fila(_ item: Item, en lista: [Item], biblioteca: LibraryView) -> some View {
        // «Canal caído» solo en favoritos (los que vinieron de la lista y ya no están).
        let caido =
            seccion == .favoritos && item.fromWebSync
            && ReglasBiblioteca.caido(item, idsLista: Set(biblioteca.web.map { $0.id.lowercased() }))
        return Button {
            abrir(item, en: lista)
        } label: {
            FilaCanal(
                item: item,
                favorito: seccion != .favoritos && app.esFavorito(item.id),
                antena: antena.para(titulo: item.title, alias: item.alias, marcadores: app.marcadores),
                subtitulo: ReglasBiblioteca.subtitulo(item, seccion: seccion),
                caido: caido
            )
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

    @ViewBuilder private var vacio: some View {
        if !texto.isEmpty {
            EstadoVacio(icono: "magnifyingglass", titulo: "Sin resultados", texto: "Nada en \(seccion.titulo.lowercased()) con «\(texto)».") {
                EmptyView()
            }
        } else {
            switch seccion {
            case .favoritos:
                EstadoVacio(
                    icono: "star", titulo: "Sin favoritos",
                    texto: "Marca un canal con la estrella (desliza a la derecha en Recientes o Listas) y aparecerá aquí."
                ) {
                    Button("Ver las listas") { withAnimation(Muelle.estandar) { seccionElegida = .listas } }
                        .buttonStyle(.bordered)
                }
            case .recientes:
                EstadoVacio(icono: "clock", titulo: "Nada reciente", texto: "Los canales que veas se guardan aquí.") {
                    EmptyView()
                }
            case .listas:
                EstadoVacio(
                    icono: "list.bullet.rectangle", titulo: "Sin listas",
                    texto: "Añade una lista M3U desde la web de Ace Player Neo (Ajustes → Listas)."
                ) {
                    EmptyView()
                }
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

    /// Reproduce y abre el reproductor grande (deslizando hacia abajo se queda en el mini).
    private func abrir(_ item: Item, en lista: [Item]) {
        let elegido = canal(item)
        app.reproducirCanal(elegido, lista: lista.map(canal))
        withAnimation(Muelle.heroe) { app.reproductor.expandir() }
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

    /// Qué emite cada canal: se recalcula con la agenda y cada minuto.
    private func vigilarAntena() async {
        await app.cargarAgendaGuardada()
        while !Task.isCancelled {
            antena = IndiceAntena(agenda: app.agenda, reloj: RelojMadrid(.now))
            try? await Task.sleep(for: .seconds(60))
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
                    .foregroundStyle(Tinta.acentoTinta)
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
        return partes.joined(separator: ", ")
    }
}

/// «● Real Madrid 1–0 Getafe» si está en juego; «A las 21:00, España – Marruecos» si es el siguiente.
struct LineaAntena: View {
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
                Circle().fill(Color.red).frame(width: 6, height: 6)
                Text(textoDirecto(partido))
                    .foregroundStyle(Tinta.acentoTinta)
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
