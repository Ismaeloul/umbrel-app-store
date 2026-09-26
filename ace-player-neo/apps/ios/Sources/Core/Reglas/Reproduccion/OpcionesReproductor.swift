import Foundation

/* Las opciones del reproductor: el menú «Más opciones» y la pulsación larga sobre el vídeo (a4 §5.6-§5.7;
   `allMenuItems` de apps/web/src/player/index.tsx), en táctil sin las teclas. Mismos rótulos, iconos, orden,
   peligro, ✓ y separadores que la web, con la háptica de cada acción (a4 §5.7). Los enlaces «Abrir en…»
   (D7) de player/clipboard.ts. Puro [L]: quien pinta pone la acción (AccionMenu). */

/// Ids estables de las opciones (los de la web).
enum OpcionReproductor: String, Sendable, CaseIterable {
    case pausa, atras, directo, detener, anterior, siguiente, nerd, donde, completa, pip, abrir, url, enlace, hash
}

/// Lo que decide qué opciones salen y cómo.
struct ContextoOpcionesReproductor: Sendable, Hashable {
    var hayCanal: Bool
    /// `desiredPlaying || phase === 'buffer'`: el rótulo dice «Pausar».
    var quiereReproducir: Bool
    /// `conn === 'activa' && started && !demo`.
    var puedeRetroceder: Bool
    /// Hay lista de zapping con otro canal.
    var puedeZapear: Bool
    var datosTecnicosAbiertos: Bool
    var puedePantallaCompleta: Bool
    var puedePiP: Bool
    /// El hash de lo que suena (identificador opaco: «Copiar hash» solo con 40 hex, como la web).
    var hash: String
}

enum OpcionesReproductor {
    /// Las opciones en su orden (vacío sin canal: la web no abre el menú).
    static func menu(_ c: ContextoOpcionesReproductor) -> [OpcionMenu] {
        guard c.hayCanal else { return [] }
        var opciones: [OpcionMenu] = [
            opcion(.pausa, c.quiereReproducir ? "Pausar" : "Reproducir", c.quiereReproducir ? .pause : .play,
                   haptica: .ligera),
            opcion(.atras, "Retroceder 30 s", .back, deshabilitada: !c.puedeRetroceder),
            opcion(.directo, "Ir al directo", .directo),
            opcion(.detener, "Detener", .stop, peligro: true, haptica: .rigida),
        ]
        if c.puedeZapear {
            opciones.append(opcion(.anterior, "Canal anterior", .chevL, separada: true, haptica: .rigida))
            opciones.append(opcion(.siguiente, "Canal siguiente", .chevR, haptica: .rigida))
        }
        opciones.append(
            opcion(.nerd, "Datos técnicos", .nerd, marcada: c.datosTecnicosAbiertos, separada: !c.puedeZapear))
        opciones.append(opcion(.donde, "Dónde se está reproduciendo", .tv))
        if c.puedePantallaCompleta { opciones.append(opcion(.completa, "Pantalla completa", .full, haptica: .media)) }
        if c.puedePiP { opciones.append(opcion(.pip, "Imagen dentro de imagen", .pip)) }
        opciones.append(opcion(.abrir, "Abrir en la app de AceStream", .externo, separada: true))
        opciones.append(opcion(.url, "Copiar URL del stream (VLC)", .link))
        opciones.append(opcion(.enlace, "Copiar enlace acestream://", .copy))
        opciones.append(opcion(.hash, "Copiar hash", .hash, deshabilitada: !esHashMinusculas(c.hash)))
        return opciones
    }

    private static func opcion(
        _ id: OpcionReproductor, _ titulo: String, _ icono: NombreIcono, peligro: Bool = false, marcada: Bool = false,
        deshabilitada: Bool = false, separada: Bool = false, haptica: TipoHaptico? = nil
    ) -> OpcionMenu {
        OpcionMenu(
            id: id.rawValue, titulo: titulo, icono: icono, peligro: peligro, marcada: marcada,
            deshabilitada: deshabilitada, separadaAntes: separada, haptica: haptica)
    }

    /// `/^[a-f0-9]{40}$/` (la web solo deja copiar un hash de verdad).
    static func esHashMinusculas(_ texto: String) -> Bool {
        // Solo ASCII: `isHexDigit` también acepta los dígitos de ancho completo («０»).
        let escalares: String.UnicodeScalarView = texto.unicodeScalars
        return escalares.count == 40 && escalares.allSatisfy { ReglasFuentes.esHexASCII($0, mayusculas: false) }
    }

    // MARK: «Abrir en…» (D7, player/clipboard.ts)

    /// `acestreamLink`.
    static func enlaceAceStream(_ hash: String) -> String { "acestream://\(hash)" }

    /// `externalStreamUrl`: la del motor por el proxy de la app, con `id` o `infohash` según el canal.
    static func urlExterna(_ hash: String, tipo: StreamKind, origen: String) -> String {
        let parametro = tipo == .infohash ? "infohash" : "id"
        return "\(origen)/ace/getstream?\(parametro)=\(hash)"
    }

    // MARK: Avisos de las opciones (a7 §12.3, toasts)

    static let urlCopiada = "URL del stream copiada: pégala en VLC"
    static let enlaceCopiado = "Enlace acestream:// copiado"
    static let noSePudoCopiar = "No se pudo copiar"
    static let hashCopiado = "Hash copiado"
    static let hashNoCopiado = "No se pudo copiar el hash"
    static let pipEnDemo = "PiP necesita un vídeo real (en demo no hay señal)"
    static let pipNoDisponible = "PiP no disponible"
}
