import Foundation

/* Biblioteca, directorios y preferencias (api/v1/library.ts, state/v1.ts y
   api/common.ts). */

/// `ItemTypeSchema`: de qué colección viene un elemento.
public enum ItemType: String, EnumTolerante {
    case fav, recent, web
    case desconocido
}

/// `ItemSchema`: favorito, reciente o canal de un directorio.
public struct Item: Codable, Sendable, Hashable, Identifiable {
    /// Hash AceStream de 40 hex (o infohash si `ih`).
    public var id: String
    public var title: String
    /// `tvg-id` del M3U; solo si existe y es distinto de `title`.
    public var alias: String?
    public var type: ItemType
    public var category: String
    public var date: String
    public var fromWebSync: Bool
    /// true si el id es un infohash (se reproduce con `kind=infohash`).
    public var ih: Bool
}

/// `WebSourceTypeSchema`.
public enum WebSourceType: String, EnumTolerante {
    case m3u, html
    case desconocido
}

/// `WebSourceSummarySchema`: resumen público de un directorio.
public struct WebSourceSummary: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var url: String
    public var type: WebSourceType
    /// Canales visibles (tras ocultos).
    public var count: Int
    public var syncedAt: String?
    public var lastErrorAt: String?
    public var lastError: String?
}

/// `DirectoryViewSchema`: los canales del directorio activo y el resumen de todos.
public struct DirectoryView: Codable, Sendable, Hashable {
    public var web: [Item]
    public var webSyncedAt: String?
    public var webSources: [WebSourceSummary]
    public var activeWebSourceId: String
}

/// `LibraryViewSchema`: favoritos, recientes y directorios.
public struct LibraryView: Codable, Sendable, Hashable {
    public var web: [Item]
    public var webSyncedAt: String?
    public var webSources: [WebSourceSummary]
    public var activeWebSourceId: String
    public var favorites: [Item]
    public var history: [Item]
}

/// `PreferencesSchema`: gustos de fútbol.
public struct Preferences: Codable, Sendable, Hashable {
    public var onboardingComplete: Bool
    public var country: String
    public var leagues: [String]
    public var teams: [String]
    public var nationalities: [String]
}

/// `PreferencesResponseSchema`.
public struct PreferencesResponse: Codable, Sendable, Hashable {
    public var preferences: Preferences
}

/// `PreferencesInputSchema`: PUT sustituye lo que se manda.
public struct PreferencesInput: Codable, Sendable, Hashable {
    public var onboardingComplete: Bool?
    public var country: String?
    public var leagues: [String]?
    public var teams: [String]?
    public var nationalities: [String]?

    public init(
        onboardingComplete: Bool? = nil, country: String? = nil, leagues: [String]? = nil,
        teams: [String]? = nil, nationalities: [String]? = nil
    ) {
        self.onboardingComplete = onboardingComplete
        self.country = country
        self.leagues = leagues
        self.teams = teams
        self.nationalities = nationalities
    }
}

/// `ItemInputSchema`: elemento que manda el cliente.
public struct ItemInput: Codable, Sendable, Hashable {
    public var id: String
    public var title: String?
    public var category: String?
    public var alias: String?
    public var date: String?
    public var fromWebSync: Bool?
    public var ih: Bool?

    public init(
        id: String, title: String? = nil, category: String? = nil, alias: String? = nil,
        date: String? = nil, fromWebSync: Bool? = nil, ih: Bool? = nil
    ) {
        self.id = id
        self.title = title
        self.category = category
        self.alias = alias
        self.date = date
        self.fromWebSync = fromWebSync
        self.ih = ih
    }
}

/// `LibraryCollectionSchema`.
public enum LibraryCollection: String, Codable, Sendable, Hashable {
    case favorites, history, web
}

/// `LibraryMutationBodySchema`: mutaciones por acción (no pisan otros dispositivos).
public enum LibraryMutation: Encodable, Sendable, Hashable {
    case favoriteUpsert(ItemInput)
    case historyUpsert(ItemInput)
    case rename(collection: LibraryCollection, id: String, title: String, sourceId: String? = nil)
    case delete(collection: LibraryCollection, id: String, sourceId: String? = nil)

    private enum Claves: String, CodingKey {
        case action, item, collection, id, title, sourceId
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: Claves.self)
        switch self {
        case .favoriteUpsert(let item):
            try c.encode("favorite-upsert", forKey: .action)
            try c.encode(item, forKey: .item)
        case .historyUpsert(let item):
            try c.encode("history-upsert", forKey: .action)
            try c.encode(item, forKey: .item)
        case .rename(let collection, let id, let title, let sourceId):
            try c.encode("rename", forKey: .action)
            try c.encode(collection, forKey: .collection)
            try c.encode(id, forKey: .id)
            try c.encode(title, forKey: .title)
            try c.encodeIfPresent(sourceId, forKey: .sourceId)
        case .delete(let collection, let id, let sourceId):
            try c.encode("delete", forKey: .action)
            try c.encode(collection, forKey: .collection)
            try c.encode(id, forKey: .id)
            try c.encodeIfPresent(sourceId, forKey: .sourceId)
        }
    }
}

/// `DirectorySyncBodySchema`.
public struct DirectorySyncBody: Codable, Sendable, Hashable {
    public var url: String
    public var type: WebSourceType?
    public var sourceId: String?
    public var name: String?

    public init(url: String, type: WebSourceType? = nil, sourceId: String? = nil, name: String? = nil) {
        self.url = url
        self.type = type
        self.sourceId = sourceId
        self.name = name
    }
}

/// `SearchResultSchema`: resultado del buscador del motor (siempre infohash).
public struct SearchResult: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var title: String
    public var category: String
    public var availability: Double?
    public var bitrate: Double?
    public var ih: Bool
}

/// `SearchResponseSchema`.
public struct SearchResponse: Codable, Sendable, Hashable {
    public var query: String
    public var results: [SearchResult]
}
