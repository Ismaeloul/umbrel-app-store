import Foundation

/* Lo que la cabecera y la ficha del canal suelto dicen de él (ChannelCenter.tsx; b-arquitectura §0.0 punto 1):
   de dónde viene, su título y cuántas fuentes del mismo canal hay. Las hermanas son las de la sesión de fuentes
   (`ReglasFuentes.hermanas`, `librarySiblings` de model.ts: M3), SIN footballResolve y sin textos nuevos: la
   pestaña se titula «Fuentes n», el panel «Otras fuentes n» y la cabecera «… · n fuentes del mismo canal». */

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

    /// Las hermanas del canal (`librarySiblings`, M3): el propio canal y los de nombre ≥ 92.
    static func hermanas(_ biblioteca: LibraryView?, hash: String) -> [Item] {
        ReglasFuentes.hermanas(biblioteca, id: hash)
    }

    /// Cuántas fuentes del mismo canal hay (0 si solo está él).
    static func cuenta(_ hermanas: [Item]) -> Int { hermanas.count > 1 ? hermanas.count : 0 }

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
