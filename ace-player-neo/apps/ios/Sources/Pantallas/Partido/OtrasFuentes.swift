import Foundation

/* «Otras fuentes» del canal suelto, calcado de la web (b-arquitectura §0.0 punto 1; ChannelCenter.tsx y
   `librarySiblings` de features/sources/model.ts): las hermanas del canal en la biblioteca (directorio +
   favoritos + recientes, sin repetir) con `channelMatchScore` ≥ 92 contra su nombre. SIN footballResolve y
   sin textos nuevos: la pestaña se titula «Fuentes n», el panel «Otras fuentes n» y la cabecera
   «… · n fuentes del mismo canal». Puro. */

enum OtrasFuentes {
    /// Todo lo de la biblioteca, sin repetir id, en el orden de la web (directorio, favoritos, recientes).
    static func todo(_ biblioteca: LibraryView?) -> [Item] {
        guard let biblioteca else { return [] }
        var vistos = Set<String>()
        return (biblioteca.web + biblioteca.favorites + biblioteca.history).filter { item in
            !item.id.isEmpty && vistos.insert(item.id).inserted
        }
    }

    /// El canal en la biblioteca (`findKnownItem`): favoritos, recientes o el directorio.
    static func item(_ biblioteca: LibraryView?, hash: String) -> Item? {
        todo(biblioteca).first { $0.id == hash }
    }

    /// `librarySiblings`: el propio canal y los de nombre ≥ 92; [] si no está en la biblioteca.
    static func hermanas(_ biblioteca: LibraryView?, hash: String) -> [Item] {
        let lista = todo(biblioteca)
        guard let actual = lista.first(where: { $0.id == hash }) else { return [] }
        let nombre = nombreDe(actual)
        guard !Canales.clave(nombre).isEmpty else { return [actual] }
        return lista.filter { item in
            item.id == hash || Canales.puntuacion(nombre, nombreDe(item)) >= Canales.puntuacionExacta
        }
    }

    /// Cuántas fuentes del mismo canal hay (0 si solo está él).
    static func cuenta(_ hermanas: [Item]) -> Int { hermanas.count > 1 ? hermanas.count : 0 }

    private static func nombreDe(_ item: Item) -> String {
        if let alias = item.alias, !alias.isEmpty { return alias }
        return item.title
    }

    /// `entryFromItem`: la hermana como entrada de la sesión (directorio → M3U de la lista activa).
    static func entrada(_ item: Item, listaActiva: String?) -> EntradaFuente {
        let origen: String =
            switch item.type {
            case .fav: "favorites"
            case .recent: "history"
            default: "m3u"
            }
        return EntradaFuente(
            id: item.id, titulo: item.title.isEmpty ? "Canal \(item.id.prefix(8))" : item.title, alias: item.alias,
            ih: item.ih, origen: origen, listaId: item.type == .web ? listaActiva : nil,
            canal: nombreDe(item))
    }

    /// «Fuera de tu biblioteca» · «En tus favoritos» · «De tu lista {nombre}» / «De tu lista» · «En tus recientes».
    static func origen(_ item: Item?, biblioteca: LibraryView?) -> String {
        guard let item else { return "Fuera de tu biblioteca" }
        if biblioteca?.favorites.contains(where: { $0.id == item.id }) == true { return "En tus favoritos" }
        if item.type == .web {
            let lista = biblioteca?.webSources.first { $0.id == biblioteca?.activeWebSourceId }?.name
            return lista.map { "De tu lista \($0)" } ?? "De tu lista"
        }
        return "En tus recientes"
    }

    /// El título del canal: el de la biblioteca, si no el del reproductor, si no «Canal {8 primeros}».
    static func titulo(_ item: Item?, reproductor: String?, hash: String) -> String {
        if let titulo = item?.title, !titulo.isEmpty { return titulo }
        if let reproductor, !reproductor.isEmpty { return reproductor }
        return "Canal \(hash.prefix(8))"
    }
}
