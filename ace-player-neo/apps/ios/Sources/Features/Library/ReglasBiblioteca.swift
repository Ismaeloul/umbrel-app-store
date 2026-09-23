import Foundation

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

/// Canales de una categoría de la lista.
struct GrupoCategoria: Identifiable, Hashable {
    var categoria: String
    var items: [Item]
    var id: String { categoria }
}

/// Recientes de un mismo tramo («Hoy», «Ayer», «Esta semana», «Antes»).
struct GrupoRecientes: Identifiable, Hashable {
    var tramo: String
    var items: [Item]
    var id: String { tramo }
}

/// Las reglas de la biblioteca de la web (apps/web/src/features/library/model.ts).
enum ReglasBiblioteca {
    /// Categoría para los canales sin ella.
    static let categoriaPorDefecto = "General"

    /// `initialTab`: Favoritos si hay; si no, Recientes; si no, Listas.
    static func seccionInicial(_ biblioteca: LibraryView) -> SeccionBiblioteca {
        if !biblioteca.favorites.isEmpty { return .favoritos }
        if !biblioteca.history.isEmpty { return .recientes }
        return .listas
    }

    static func items(_ biblioteca: LibraryView, _ seccion: SeccionBiblioteca) -> [Item] {
        switch seccion {
        case .favoritos: biblioteca.favorites
        case .recientes: biblioteca.history
        case .listas: biblioteca.web
        }
    }

    /// Minúsculas y sin tildes: «Fútbol» encuentra «futbol» y al revés.
    static func plegar(_ texto: String) -> String {
        ParaTi.sinMarcas(texto).lowercased().trimmingCharacters(in: .whitespaces)
    }

    /// `filterItems`: por título, alias o categoría, sin tildes ni mayúsculas.
    static func filtrar(_ items: [Item], texto: String) -> [Item] {
        let buscado = plegar(texto)
        guard !buscado.isEmpty else { return items }
        return items.filter { item in
            [item.title, item.alias ?? "", item.category].contains { plegar($0).contains(buscado) }
        }
    }

    /// `groupByCategory`: por categoría, ordenadas alfabéticamente (sin
    /// distinguir mayúsculas ni tildes); la vacía va a «General».
    static func porCategoria(_ items: [Item]) -> [GrupoCategoria] {
        var orden: [String] = []
        var grupos: [String: [Item]] = [:]
        for item in items {
            let limpia = item.category.trimmingCharacters(in: .whitespacesAndNewlines)
            let categoria = limpia.isEmpty ? categoriaPorDefecto : limpia
            if grupos[categoria] == nil { orden.append(categoria) }
            grupos[categoria, default: []].append(item)
        }
        let espanol = Locale(identifier: "es_ES")
        return orden.sorted { a, b in
            a.compare(b, options: [.caseInsensitive, .diacriticInsensitive], range: nil, locale: espanol)
                == .orderedAscending
        }
        .map { GrupoCategoria(categoria: $0, items: grupos[$0] ?? []) }
    }

    /// `recentGroups`: sin cambiar el orden del servidor (el más reciente primero), solo con cabeceras.
    static func porTramos(_ items: [Item], ahora: Date = .now, calendario: Calendar = .current) -> [GrupoRecientes] {
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

    /// Categorías que no dicen nada (las pone la app al guardar o el buscador).
    static let categoriasVacias: Set<String> = ["guardado", "busqueda", "búsqueda", "sin categoría", "sin categoria"]

    /// `subtitleFor`: la categoría si dice algo (en las listas, siempre).
    static func subtitulo(_ item: Item, seccion: SeccionBiblioteca) -> String? {
        let categoria = item.category.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !categoria.isEmpty else { return nil }
        if seccion != .listas && categoriasVacias.contains(categoria.lowercased()) { return nil }
        return categoria
    }

    /// `isFallenFavorite`: vino de la lista y ya no está en la activa.
    static func caido(_ item: Item, idsLista: Set<String>) -> Bool {
        item.fromWebSync && !idsLista.isEmpty && !idsLista.contains(item.id.lowercased())
    }

    /// `libraryFooter`: «12 canales en biblioteca · lista sincronizada 23 sept».
    static func pie(_ biblioteca: LibraryView) -> String {
        let total = biblioteca.favorites.count + biblioteca.history.count + biblioteca.web.count
        var partes = [total == 1 ? "1 canal en biblioteca" : "\(total) canales en biblioteca"]
        if let fecha = biblioteca.webSyncedAt.flatMap(FechaISO.parse) {
            partes.append("lista sincronizada \(fechaCorta(fecha))")
        }
        return partes.joined(separator: " · ")
    }

    /// «23 sept».
    static func fechaCorta(_ fecha: Date) -> String {
        let estilo = Date.FormatStyle(locale: Locale(identifier: "es_ES")).day().month(.abbreviated)
        return fecha.formatted(estilo).replacingOccurrences(of: ".", with: "")
    }
}

// MARK: - Qué da cada canal hoy

/// Un partido que da un canal: en juego o el siguiente de hoy (`OnAirMatch`).
struct EnAntena: Hashable {
    var partido: FootballMatch
    var enDirecto: Bool
    var marcador: LiveScore?
}

/// Los partidos de hoy con las claves de sus canales ya calculadas: cruzar
/// cada canal de la biblioteca con la agenda sale barato (`on-air.ts`).
struct IndiceAntena {
    struct Entrada {
        let partido: FootballMatch
        let claves: [String]
        let faltan: Int?
    }

    static let vacio = IndiceAntena(entradas: [])

    let entradas: [Entrada]

    /// Duración que se da a un partido sin marcador (2 h, como la web).
    static let ventanaPartido = 120

    /// `todaysMatches`: los del día de Madrid y los de ayer que sigan en juego.
    init(agenda: FootballSchedule?, reloj: RelojMadrid) {
        var entradas: [Entrada] = []
        for dia in agenda?.days ?? [] {
            for partido in dia.matches {
                let faltan = ReglasAgenda.minutosParaPartido(partido, reloj: reloj)
                let enJuego = faltan.map { $0 <= 0 && $0 > -Self.ventanaPartido } ?? false
                guard dia.date == reloj.fecha || enJuego else { continue }
                entradas.append(Entrada(partido: partido, claves: partido.channels.map { Canales.clave($0.name) }, faltan: faltan))
            }
        }
        self.entradas = entradas
    }

    private init(entradas: [Entrada]) {
        self.entradas = entradas
    }

    /// `onAirFor`: el que está en juego o, si no, el siguiente de hoy.
    func para(titulo: String, alias: String?, marcadores: [String: LiveScore]) -> EnAntena? {
        guard !entradas.isEmpty else { return nil }
        let claveTitulo = Canales.clave(titulo)
        let claveAlias = alias.map { Canales.clave($0) }
        var siguiente: (entrada: Entrada, faltan: Int)?
        for entrada in entradas
        where Canales.emite(claveTitulo: claveTitulo, claveAlias: claveAlias, clavesPartido: entrada.claves) {
            let marcador = marcadores[entrada.partido.id]
            if marcador?.state == "post" { continue }
            let enJuego =
                marcador?.state == "in"
                || (entrada.faltan.map { $0 <= 0 && $0 > -Self.ventanaPartido } ?? false)
            if enJuego { return EnAntena(partido: entrada.partido, enDirecto: true, marcador: marcador) }
            let faltan = entrada.faltan ?? 1_000_000_000
            if faltan > 0, siguiente == nil || faltan < siguiente?.faltan ?? .max {
                siguiente = (entrada, faltan)
            }
        }
        return siguiente.map { EnAntena(partido: $0.entrada.partido, enDirecto: false, marcador: nil) }
    }
}
