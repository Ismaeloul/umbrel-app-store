import Foundation

/* Cola de toasts (b-arquitectura §2.1.3, M2; a2 §8.1, a7 §12.1), calcada de notices/toasts.ts:
   - dura 2,8 s (o lo que se pida: el «Deshacer» de borrar dura 6 s); los relojes los lleva `Avisos` (M4);
   - NUNCA más de 2 a la vez: al poner uno nuevo, el más viejo empieza a salir;
   - un mensaje repetido (mismo tono y texto, sin estar saliendo) no se apila: «×n» y vuelve a contar,
     y si trae acción se queda con la nueva;
   - sale con un fundido de 320 ms antes de desaparecer (`empezarSalida` y, pasado ese tiempo, `quitar`). */

struct ColaToasts: Sendable {
    static let duracion = 2.8, maximo = 2, salida = 0.32  // notices/toasts.ts: TOAST_MS, TOAST_MAX, FADE_MS
    /// Duración del toast con «Deshacer» de la biblioteca y del mini (6 s: useChannelActions, MiniPlayer).
    static let duracionDeshacer = 6.0
    private(set) var toasts: [Toast] = []
    private var siguienteId = 1

    /// Pone o renueva (misma clave → repeticiones + 1). Devuelve el id y los que deben empezar a salir.
    mutating func poner(_ texto: String, tono: TonoAviso, icono: NombreIcono?, tituloAccion: String?)
        -> (id: Int, salen: [Int])
    {
        let clave = Self.clave(texto, tono: tono)
        if let indice = toasts.firstIndex(where: { $0.clave == clave && !$0.saliendo }) {
            toasts[indice].repeticiones += 1
            if let tituloAccion { toasts[indice].tituloAccion = tituloAccion }
            return (toasts[indice].id, [])
        }
        let id = siguienteId
        siguienteId += 1
        // Máximo 2: los más viejos ceden su sitio antes de entrar el nuevo.
        let visibles = toasts.filter { !$0.saliendo }
        let salen = visibles.prefix(max(0, visibles.count - (Self.maximo - 1))).map(\.id)
        for viejo in salen { empezarSalida(viejo) }
        toasts.append(
            Toast(
                id: id, clave: clave, texto: texto, tono: tono, icono: icono, tituloAccion: tituloAccion,
                repeticiones: 1, saliendo: false))
        return (id, salen)
    }

    /// `dismissToast`: empieza el fundido de salida (nada si ya salía o no existe).
    mutating func empezarSalida(_ id: Int) {
        guard let indice = toasts.firstIndex(where: { $0.id == id }), !toasts[indice].saliendo else { return }
        toasts[indice].saliendo = true
    }

    /// Lo quita del todo (al acabar el fundido).
    mutating func quitar(_ id: Int) {
        toasts.removeAll { $0.id == id }
    }

    /// Los que se pintan (los que salen también, con su fundido).
    var visibles: [Toast] { toasts.filter { !$0.saliendo } }

    /// «tono|texto»: dos avisos iguales se agrupan.
    static func clave(_ texto: String, tono: TonoAviso) -> String { "\(tono.rawValue)|\(texto)" }

    /// «×n» desde 2 (Toast.tsx); `nil` con uno.
    static func contador(_ toast: Toast) -> String? { toast.repeticiones > 1 ? "×\(toast.repeticiones)" : nil }

    /// Icono por defecto según el tono (a7 §12.1): ok ✓, info ⓘ, warn y err ⚠; el que traiga el aviso manda.
    static func icono(_ toast: Toast) -> NombreIcono {
        if let icono = toast.icono { return icono }
        switch toast.tono {
        case .ok: return .check
        case .info: return .info
        case .warn, .err: return .aviso
        }
    }
}
