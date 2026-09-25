import Foundation

// Port de apps/web/src/features/library/model.ts (M5; a5 §3): pestañas, filtro, agrupados, subtítulos y el
// pie. Rescatado en la poda (fase 0.2) de Features/Library/ReglasBiblioteca.swift y revalidado contra
// model.ts y model.test.ts. Sin `Date.now` por defecto (R14): quien llama pasa la hora.

/// Qué parte de la biblioteca se ve (`LibraryTab`).
enum SeccionBiblioteca: String, CaseIterable, Identifiable, Sendable {
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

    /// El icono de la pestaña (solo desde 768: `TAB_ICON`).
    var icono: NombreIcono {
        switch self {
        case .favoritos: .star
        case .recientes: .clock
        case .listas: .list
        }
    }

    /// La del armazón (`PestanaCanales`, en la ruta).
    init(_ pestana: PestanaCanales) {
        switch pestana {
        case .favoritos: self = .favoritos
        case .recientes: self = .recientes
        case .listas: self = .listas
        }
    }

    var pestana: PestanaCanales {
        switch self {
        case .favoritos: .favoritos
        case .recientes: .recientes
        case .listas: .listas
        }
    }
}

/// Canales de una categoría de la lista (`CategoryGroup`).
struct GrupoCategoria: Identifiable, Hashable, Sendable {
    var categoria: String
    var items: [Item]
    var id: String { categoria }
}

/// Recientes de un mismo tramo («Hoy», «Ayer», «Esta semana», «Antes») (`RecentGroup`).
struct GrupoRecientes: Identifiable, Hashable, Sendable {
    var tramo: String
    var items: [Item]
    var id: String { tramo }
}

/// Las reglas de la biblioteca de la web (apps/web/src/features/library/model.ts).
enum ReglasBiblioteca {
    /// Espera del filtro local tras cada tecla (`LOCAL_FILTER_DELAY_MS`).
    static let esperaFiltro: Double = 0.14
    /// Letras para ofrecer «Buscar en el motor» (`ENGINE_SEARCH_MIN`).
    static let minimoMotor = 2
    /// «Deshacer» al borrar o al quitar un favorito (`UNDO_MS`).
    static let deshacer: Double = 6
    /// Aparición escalonada tras abrir una pestaña (`ENTER_MS`) y tope del índice.
    static let ventanaEntrada: Double = 0.9
    static let topeEscalonado = 12
    /// Categoría para los canales sin ella (`DEFAULT_CATEGORY`).
    static let categoriaPorDefecto = "General"

    /// `initialTab`: Favoritos si hay; si no, Recientes; si no, Listas.
    static func seccionInicial(favoritos: Int, recientes: Int) -> SeccionBiblioteca {
        if favoritos > 0 { return .favoritos }
        if recientes > 0 { return .recientes }
        return .listas
    }

    static func seccionInicial(_ biblioteca: LibraryView) -> SeccionBiblioteca {
        seccionInicial(favoritos: biblioteca.favorites.count, recientes: biblioteca.history.count)
    }

    static func items(_ biblioteca: LibraryView, _ seccion: SeccionBiblioteca) -> [Item] {
        switch seccion {
        case .favoritos: biblioteca.favorites
        case .recientes: biblioteca.history
        case .listas: biblioteca.web
        }
    }

    /// `foldText`: minúsculas y sin tildes («Fútbol» encuentra «futbol» y al revés).
    static func plegar(_ texto: String) -> String {
        ParaTi.sinMarcas(texto).lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `filterItems`: por título o categoría, sin tildes ni mayúsculas, «contiene».
    static func filtrar(_ items: [Item], texto: String) -> [Item] {
        let buscado = plegar(texto)
        guard !buscado.isEmpty else { return items }
        return items.filter { plegar($0.title).contains(buscado) || plegar($0.category).contains(buscado) }
    }

    /// `rowKey`: el mismo hash puede estar en dos colecciones.
    static func claveFila(_ coleccion: LibraryCollection, _ id: String) -> String { "\(coleccion.rawValue):\(id)" }

    /// `groupByCategory`: por categoría, ordenadas alfabéticamente en español (sin mayúsculas ni tildes);
    /// la vacía va a «General».
    static func porCategoria(_ items: [Item]) -> [GrupoCategoria] {
        var orden: [String] = []
        var grupos: [String: [Item]] = [:]
        for item in items {
            let limpia = item.category.trimmingCharacters(in: .whitespacesAndNewlines)
            let categoria = limpia.isEmpty ? categoriaPorDefecto : limpia
            if grupos[categoria] == nil { orden.append(categoria) }
            grupos[categoria, default: []].append(item)
        }
        let ordenadas = orden.enumerated().sorted { a, b in
            let pa = plegar(a.element)
            let pb = plegar(b.element)
            return pa != pb ? pa < pb : a.offset < b.offset
        }
        return ordenadas.map { GrupoCategoria(categoria: $0.element, items: grupos[$0.element] ?? []) }
    }

    /// `recentGroups`: sin cambiar el orden del servidor (el más reciente primero), solo con cabeceras.
    /// Con la hora LOCAL del dispositivo (como la web).
    static func porTramos(_ items: [Item], ahora: Date, calendario: Calendar = .current) -> [GrupoRecientes] {
        let hoy = calendario.startOfDay(for: ahora)
        let dia: TimeInterval = 86_400
        func tramo(_ item: Item) -> String {
            guard let fecha = FechaISO.parse(item.date), fecha < hoy else { return "Hoy" }
            if fecha >= hoy.addingTimeInterval(-dia) { return "Ayer" }
            if fecha >= hoy.addingTimeInterval(-6 * dia) { return "Esta semana" }
            return "Antes"
        }
        var grupos: [GrupoRecientes] = []
        for item in items {
            let nombre = tramo(item)
            if let ultimo = grupos.indices.last, grupos[ultimo].tramo == nombre {
                grupos[ultimo].items.append(item)
            } else {
                grupos.append(GrupoRecientes(tramo: nombre, items: [item]))
            }
        }
        return grupos
    }

    /// Categorías que no dicen nada (`PLACEHOLDER_CATEGORIES`).
    static let categoriasVacias: Set<String> = ["guardado", "busqueda", "búsqueda", "sin categoría"]

    /// `subtitleFor`: la categoría si dice algo (en las listas, siempre); si no, los 14 primeros del hash.
    static func subtitulo(_ item: Item, coleccion: LibraryCollection) -> String {
        let categoria = item.category.trimmingCharacters(in: .whitespacesAndNewlines)
        if !categoria.isEmpty && (coleccion == .web || !categoriasVacias.contains(categoria.lowercased())) {
            return categoria
        }
        return "\(item.id.prefix(14))…"
    }

    /// `subtitleFor(…, 'search')`: «Deportes · disp. 90%» o la categoría (o «Búsqueda»).
    static func subtituloBusqueda(categoria: String, disponibilidad: Double?) -> String {
        let nombre = categoria.isEmpty ? "Búsqueda" : categoria
        guard let porcentaje = porcentajeDisponible(disponibilidad) else { return nombre }
        return "\(nombre) · disp. \(porcentaje)%"
    }

    /// `availabilityPercent`: 0…1 a porcentaje entero.
    static func porcentajeDisponible(_ valor: Double?) -> Int? {
        guard let valor, valor.isFinite else { return nil }
        return max(0, min(100, Int((valor * 100).rounded(.toNearestOrAwayFromZero))))
    }

    /// `isFallenFavorite`: vino de la lista y ya no está en la activa (sin lista no se marca nada).
    static func caido(_ item: Item, idsLista: Set<String>) -> Bool {
        item.fromWebSync && !idsLista.isEmpty && !idsLista.contains(item.id)
    }

    /// `libraryFooter`: «12 canales en biblioteca · lista sincronizada 23 sept · demo».
    static func pie(_ biblioteca: LibraryView, demo: Bool) -> String {
        let total = biblioteca.favorites.count + biblioteca.history.count + biblioteca.web.count
        var partes = [total == 1 ? "1 canal en biblioteca" : "\(total) canales en biblioteca"]
        if let fecha = fechaCorta(biblioteca.webSyncedAt) { partes.append("lista sincronizada \(fecha)") }
        if demo { partes.append("demo") }
        return partes.joined(separator: " · ")
    }

    /// `shortDate`: «23 sept» (día y mes corto de es-ES, con la hora local).
    static func fechaCorta(_ iso: String?, calendario: Calendar = .current) -> String? {
        guard let iso, let fecha = FechaISO.parse(iso) else { return nil }
        let partes = calendario.dateComponents([.day, .month], from: fecha)
        guard let dia = partes.day, let mes = partes.month, (1...12).contains(mes) else { return nil }
        return "\(dia) \(mesesCortos[mes - 1])"
    }

    /// Meses cortos de `toLocaleDateString('es-ES', {month: 'short'})`.
    static let mesesCortos = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"]

    /// `findKnownItem`: el canal que ya tienes con ese hash (favoritos, recientes, lista).
    static func conocido(_ biblioteca: LibraryView?, hash: String) -> Item? {
        guard let biblioteca else { return nil }
        return biblioteca.favorites.first { $0.id == hash } ?? biblioteca.history.first { $0.id == hash }
            ?? biblioteca.web.first { $0.id == hash }
    }

    /// «En tu biblioteca» de Buscar: hasta 5 de Favoritos, Recientes y Listas, sin repetir hash.
    static func enTuBiblioteca(_ biblioteca: LibraryView?, texto: String, limite: Int = 5) -> [Item] {
        guard let biblioteca else { return [] }
        var vistos = Set<String>()
        let todos = biblioteca.favorites + biblioteca.history + biblioteca.web
        return Array(filtrar(todos, texto: texto).filter { vistos.insert($0.id).inserted }.prefix(limite))
    }

    /// La colección de un elemento por su tipo (`item.type`).
    static func coleccion(de item: Item) -> LibraryCollection {
        switch item.type {
        case .fav: .favorites
        case .web: .web
        case .recent, .desconocido: .history
        }
    }

    /// `defaultFavoriteTitle`: «Canal {6 del hash}».
    static func tituloFavoritoPorDefecto(_ hash: String) -> String { "Canal \(hash.prefix(6))" }

    /// Contador accesible de una categoría o de «Emitiendo ahora»: «1 canal» / «2 canales».
    static func canales(_ n: Int) -> String { n == 1 ? "1 canal" : "\(n) canales" }
}
