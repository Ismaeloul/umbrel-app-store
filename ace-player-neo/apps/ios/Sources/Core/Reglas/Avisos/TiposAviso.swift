import Foundation

/* Tipos de los avisos (b-arquitectura §2.1.3, contrato I0→M2), calcados de la carpeta notices de la web
   (toasts.ts y statusLine.ts): el tono y la clase de `notify()`, un toast de la cola y el contenido de la
   línea de estado. La cola (ColaToasts) y la línea (LineaEstado) son de M2; `Avisos` (M4) los junta. */

/// `tone` de los avisos de la web (notices).
enum TonoAviso: String, Sendable { case ok, info, warn, err }

/// `kind: 'action' | 'signal'` de notify(): lo de la señal, viendo el teatro y sin acción, va a la línea.
enum ClaseAviso: Sendable { case accion, senal }

/// Un toast de la cola (notices/toasts.ts).
struct Toast: Identifiable, Hashable, Sendable {
    var id: Int
    var clave: String  // "\(tono)|\(texto)": dos iguales se agrupan (×n)
    var texto: String
    var tono: TonoAviso
    var icono: NombreIcono?
    var tituloAccion: String?  // la acción (closure) la guarda Avisos por id
    var repeticiones: Int
    var saliendo: Bool
}

/// `StatusContent` de notices/statusLine.ts.
struct ContenidoLinea: Hashable, Sendable {
    var texto: String
    var tono: TonoAviso = .info
    var senal: EstadoSenal?
    var icono: NombreIcono?
    var dato: String?  // `meta`: el dato a la derecha
}
