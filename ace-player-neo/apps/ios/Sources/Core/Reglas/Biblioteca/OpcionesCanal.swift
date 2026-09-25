import Foundation

/* Menú de acciones de un canal (M5; a5 §3.9): `channelMenuItems` de library/actions.ts y las decisiones de
   `useChannelActions.menuFor`, puras. En el móvil NO lleva «Ver canal» (eso solo con la ficha de escritorio).
   Los avisos de cada acción (library/clipboard.ts y data.ts) van en `TextosCanal`. */

/// Qué hace cada opción (la vista la convierte en una acción).
enum AccionCanal: String, Hashable, Sendable {
    case favorito, abrirAceStream, copiarStream, copiarEnlace, copiarHash, copiarNombre, renombrar, eliminar
}

struct OpcionCanal: Hashable, Sendable {
    var opcion: OpcionMenu
    var accion: AccionCanal
}

/// De dónde es la fila: una colección de la biblioteca o un resultado del motor (`LibraryCollection | 'search'`).
enum OrigenFila: Hashable, Sendable {
    case coleccion(LibraryCollection)
    case busqueda
}

enum OpcionesCanal {
    /// `menuFor` + `channelMenuItems`. `enBiblioteca`: el canal está en esa colección (se puede renombrar).
    static func menu(origen: OrigenFila, esFavorito: Bool, enBiblioteca: Bool) -> [OpcionCanal] {
        var opciones: [OpcionCanal] = [
            OpcionCanal(
                opcion: OpcionMenu(
                    id: "favorito", titulo: esFavorito ? "Quitar de favoritos" : "Añadir a favoritos",
                    icono: esFavorito ? .starF : .star),
                accion: .favorito),
            OpcionCanal(
                opcion: OpcionMenu(
                    id: "abrir-acestream", titulo: "Abrir en la app de AceStream", icono: .externo, separadaAntes: true),
                accion: .abrirAceStream),
            OpcionCanal(
                opcion: OpcionMenu(id: "copiar-stream", titulo: "Copiar URL del stream (VLC)", icono: .externo),
                accion: .copiarStream),
            OpcionCanal(
                opcion: OpcionMenu(id: "copiar-enlace", titulo: "Copiar enlace acestream://", icono: .link),
                accion: .copiarEnlace),
            OpcionCanal(opcion: OpcionMenu(id: "copiar-hash", titulo: "Copiar hash", icono: .hash), accion: .copiarHash),
            OpcionCanal(
                opcion: OpcionMenu(id: "copiar-nombre", titulo: "Copiar nombre", icono: .copy), accion: .copiarNombre),
        ]
        guard case .coleccion(let coleccion) = origen, enBiblioteca else { return opciones }
        opciones.append(
            OpcionCanal(
                opcion: OpcionMenu(id: "renombrar", titulo: "Renombrar", icono: .pencil, separadaAntes: true),
                accion: .renombrar))
        // En Favoritos, borrar ES quitar el favorito (ya está arriba, con «Deshacer»).
        if coleccion == .history || coleccion == .web {
            let titulo = coleccion == .history ? "Quitar de recientes" : "Eliminar de la lista"
            opciones.append(
                OpcionCanal(opcion: OpcionMenu(id: "eliminar", titulo: titulo, icono: .trash, peligro: true), accion: .eliminar))
        }
        return opciones
    }

    /// `acestreamLink`.
    static func enlace(_ hash: String) -> String { "acestream://\(hash)" }

    /// `externalStreamUrl`: `{origen}/ace/getstream?id=` (o `infohash=` si viene del motor).
    static func urlStream(origen: String, hash: String, ih: Bool) -> String {
        "\(origen)/ace/getstream?\(ih ? "infohash" : "id")=\(hash)"
    }
}

/// Textos de los avisos de las acciones de canal (library/clipboard.ts, data.ts y actions.ts), literales.
enum TextosCanal {
    static let hashCopiado = "Hash copiado"
    static let hashNoCopiado = "No se pudo copiar el hash"
    static let hashInvalido = "No hay un hash válido para copiar"
    static let enlaceCopiado = "Enlace acestream:// copiado"
    static let nombreCopiado = "Nombre del canal copiado"
    static let streamCopiado = "URL del stream copiada: pégala en VLC"
    static let noCopiado = "No se pudo copiar"
    static let abriendo = "Abriendo en AceStream… Si no se abre, instala la app de AceStream."
    static let renombrado = "Canal renombrado"
    static let noRenombrado = "No se pudo renombrar el canal"

    static func guardado(_ titulo: String) -> String { "«\(titulo)» guardado en favoritos" }
    static func noGuardado(_ motivo: String) -> String { "No se pudo guardar el favorito. \(motivo)" }
    static func listaActiva(_ nombre: String) -> String { "Lista activa: \(nombre)" }
    static let listaNoCambiada = "No se pudo cambiar de lista"
}
