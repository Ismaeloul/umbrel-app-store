import Foundation

/* Línea de estado (b-arquitectura §2.1.3, contrato de M2), notices/statusLine.ts: un mensaje de 4,5 s
   encima de la «base» que fija el reproductor.
   ESQUELETO de I0 (fase 0.3b) con la firma exacta del contrato para que `Avisos` (Armazon) compile:
   M2 lo calca de statusLine.ts con sus vectores (casos de notices.test.tsx). */

enum DestinoAviso: Sendable { case linea, toast }

struct LineaEstado: Sendable {
    static let duracion = 4.5  // notices/statusLine.ts
    private(set) var mensaje: (id: Int, contenido: ContenidoLinea, repeticiones: Int, saliendo: Bool)?
    private(set) var base: ContenidoLinea?
    private var siguienteId = 1

    /// Pone el mensaje (el mismo contenido → repeticiones + 1). Devuelve su id.
    mutating func mostrar(_ contenido: ContenidoLinea) -> Int {
        if let actual = mensaje, actual.contenido == contenido, !actual.saliendo {
            mensaje = (actual.id, contenido, actual.repeticiones + 1, false)
            return actual.id
        }
        let id = siguienteId
        siguienteId += 1
        mensaje = (id, contenido, 1, false)
        return id
    }

    mutating func fijarBase(_ base: ContenidoLinea?) { self.base = base }

    mutating func empezarSalida() {
        guard let actual = mensaje else { return }
        mensaje = (actual.id, actual.contenido, actual.repeticiones, true)
    }

    mutating func vaciar() { mensaje = nil }

    /// notify(): `signal` sin acción y viendo el teatro → línea; lo demás → toast.
    static func destino(clase: ClaseAviso, conAccion: Bool, viendoTeatro: Bool) -> DestinoAviso {
        clase == .senal && !conAccion && viendoTeatro ? .linea : .toast
    }
}
