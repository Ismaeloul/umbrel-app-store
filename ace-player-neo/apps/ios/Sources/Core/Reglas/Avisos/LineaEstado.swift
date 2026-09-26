import Foundation

/* Línea de estado bajo el vídeo (b-arquitectura §2.1.3, M2; a2 §8.4, a7 §12.1), calcada de
   notices/statusLine.ts:
   - UNA cosa a la vez: un aviso nuevo sustituye al anterior (no hay cola);
   - dura 4,5 s y se desvanece en 320 ms (los relojes los lleva `Avisos`, M4: `empezarSalida` y `quitar`);
   - repetido (mismo texto y tono, sin estar saliendo): «×n» y vuelve a contar;
   - debajo hay un ESTADO BASE que pone el reproductor; cuando el aviso se va, vuelve a verse;
   - se vacía entera (aviso y base) al salir del partido (`clearStatus`). */

enum DestinoAviso: Sendable { case linea, toast }

struct LineaEstado: Sendable {
    static let duracion = 4.5  // notices/statusLine.ts: STATUS_MS
    private(set) var mensaje: (id: Int, contenido: ContenidoLinea, repeticiones: Int, saliendo: Bool)?
    private(set) var base: ContenidoLinea?
    private var siguienteId = 1

    /// `showStatus`: pone el aviso (el mismo texto y tono → repeticiones + 1). Devuelve su id.
    mutating func mostrar(_ contenido: ContenidoLinea) -> Int {
        if let actual = mensaje, !actual.saliendo, actual.contenido.texto == contenido.texto,
            actual.contenido.tono == contenido.tono
        {
            mensaje = (actual.id, actual.contenido, actual.repeticiones + 1, false)
            return actual.id
        }
        let id = siguienteId
        siguienteId += 1
        mensaje = (id, contenido, 1, false)
        return id
    }

    /// `setStatusBase`: lo que se ve cuando no hay aviso (o nada).
    mutating func fijarBase(_ base: ContenidoLinea?) { self.base = base }

    /// Pasados 4,5 s: empieza el fundido del aviso.
    mutating func empezarSalida() {
        guard let actual = mensaje else { return }
        mensaje = (actual.id, actual.contenido, actual.repeticiones, true)
    }

    /// Acabado el fundido: quita el aviso si sigue siendo ese (uno nuevo no se borra).
    mutating func quitar(_ id: Int) {
        if mensaje?.id == id { mensaje = nil }
    }

    /// `clearStatus`: sin aviso y sin estado base (al salir del partido).
    mutating func vaciar() {
        mensaje = nil
        base = nil
    }

    /// Lo que se pinta: el aviso si lo hay; si no, el estado base.
    var visible: ContenidoLinea? { mensaje?.contenido ?? base }

    /// «×n» desde 2; `nil` con uno o sin aviso.
    var contador: String? {
        guard let mensaje, mensaje.repeticiones > 1 else { return nil }
        return "×\(mensaje.repeticiones)"
    }

    /// notify(): `signal` sin acción y viendo el teatro → línea; lo demás → toast.
    static func destino(clase: ClaseAviso, conAccion: Bool, viendoTeatro: Bool) -> DestinoAviso {
        clase == .senal && !conAccion && viendoTeatro ? .linea : .toast
    }
}
