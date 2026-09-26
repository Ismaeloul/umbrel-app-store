import Foundation

// Port de apps/web/src/player/zapping.ts (M5 para M3; b-arquitectura §3.4): la lista de zapping son los
// favoritos y después el directorio activo agrupado por categorías en el orden en que llegan, sin repetidos y
// sin los recientes. Si el canal actual no está en la lista, el siguiente es el primero.

/// Un canal de la lista de zapping (`ZapItem`).
struct CanalZapping: Hashable, Sendable, Identifiable {
    var id: String
    var titulo: String
    var ih: Bool?
    var categoria: String?
}

enum Zapping {
    /// `zappingList`.
    static func lista(favoritos: [Item], web: [Item]) -> [CanalZapping] {
        var orden: [String] = []
        var agrupados: [String: [Item]] = [:]
        for item in web {
            let categoria = item.category.isEmpty ? "General" : item.category
            if agrupados[categoria] == nil { orden.append(categoria) }
            agrupados[categoria, default: []].append(item)
        }
        let plano = favoritos + orden.flatMap { agrupados[$0] ?? [] }
        var vistos = Set<String>()
        return plano.filter { vistos.insert($0.id).inserted }.map {
            CanalZapping(id: $0.id, titulo: $0.title, ih: $0.ih, categoria: $0.category)
        }
    }

    static func lista(_ biblioteca: LibraryView?) -> [CanalZapping] {
        guard let biblioteca else { return [] }
        return lista(favoritos: biblioteca.favorites, web: biblioteca.web)
    }

    /// `zapTarget`: el canal al que se llega con −1 o +1 (nil si no hay otro).
    static func destino(_ lista: [CanalZapping], actual: String?, paso: Int) -> CanalZapping? {
        guard !lista.isEmpty else { return nil }
        let indice = actual.flatMap { id in lista.firstIndex { $0.id == id } } ?? -1
        let siguiente = indice == -1 ? 0 : ((indice + paso) % lista.count + lista.count) % lista.count
        let destino = lista[siguiente]
        return destino.id == actual ? nil : destino
    }
}
