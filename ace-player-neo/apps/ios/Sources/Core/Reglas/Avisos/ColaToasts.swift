import Foundation

/* Cola de toasts (b-arquitectura §2.1.3, contrato de M2), notices/toasts.ts: 2,8 s, máximo 2, salida
   de 320 ms; dos iguales (misma clave «tono|texto») se agrupan (×n).
   ESQUELETO de I0 (fase 0.3b) con la firma exacta del contrato para que `Avisos` (Armazon) compile:
   M2 lo calca de toasts.ts con sus vectores (casos de notices.test.tsx). */

struct ColaToasts: Sendable {
    static let duracion = 2.8, maximo = 2, salida = 0.32  // notices/toasts.ts
    private(set) var toasts: [Toast] = []
    private var siguienteId = 1

    /// Pone o renueva (misma clave → repeticiones + 1). Devuelve el id y los que deben empezar a salir.
    mutating func poner(_ texto: String, tono: TonoAviso, icono: NombreIcono?, tituloAccion: String?)
        -> (id: Int, salen: [Int])
    {
        let clave = "\(tono.rawValue)|\(texto)"
        if let indice = toasts.firstIndex(where: { $0.clave == clave && !$0.saliendo }) {
            toasts[indice].repeticiones += 1
            return (toasts[indice].id, [])
        }
        let id = siguienteId
        siguienteId += 1
        let nuevo = Toast(
            id: id, clave: clave, texto: texto, tono: tono, icono: icono, tituloAccion: tituloAccion,
            repeticiones: 1, saliendo: false)
        toasts.append(nuevo)
        let vivos = toasts.filter { !$0.saliendo }
        let sobran = max(0, vivos.count - Self.maximo)
        return (id, vivos.prefix(sobran).map(\.id))
    }

    mutating func empezarSalida(_ id: Int) {
        guard let indice = toasts.firstIndex(where: { $0.id == id }) else { return }
        toasts[indice].saliendo = true
    }

    mutating func quitar(_ id: Int) {
        toasts.removeAll { $0.id == id }
    }
}
