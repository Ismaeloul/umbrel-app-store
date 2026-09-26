import Foundation

/* Reglas puras de la pantalla de emparejar este iPhone (a2 §22, §23.3): estados de la cámara con su
   cápsula, errores del canje con su texto y su efecto, el código de seis cifras y el host del QR. La
   pantalla (Pantallas/Emparejar) y su modelo (Core/Emparejar/ModeloEmparejar) solo pintan y llaman. */

/// Estado del cartel de la cámara (a2 §22.3.1).
enum EstadoCamara: Hashable, Sendable {
    case preparando
    case escaneando
    case qrAjeno
    case emparejando(host: String)
    case emparejado(host: String)
    case errorEmparejar
    case pausa
    case ocupada
    case sinPermiso
    case restringida
    case sinCamara

    /// Sin cámara que enseñar: el cartel pinta el bloque «sin cámara» y no hay marco ni cápsula.
    var bloqueado: Bool {
        switch self {
        case .sinPermiso, .restringida, .sinCamara: true
        default: false
        }
    }
}

/// Qué pinta la cápsula de indicación (icono, texto y color del icono).
struct CapsulaCamara: Hashable, Sendable {
    enum Tinta: Sendable { case blanco, ambar, rojo, verde }
    var icono: NombreIcono?
    var texto: String
    var tinta: Tinta
    /// La ruedita (el ⟳ que gira cada 900 ms) en lugar del icono.
    var ruedita = false
}

/// Color del marco (a2 §22.3.1).
enum MarcoCamara: Hashable, Sendable {
    case oro, oroApagado, rojo, verde, oculto
}

/// Lo que provoca un fallo del canje (a2 §22.5).
struct FalloCanje: Hashable, Sendable {
    var texto: String
    /// `pairing_invalid`: borde de error en el código.
    var bordeCodigo = false
    /// `pairing_expired`: se vacía el código.
    var vaciarCodigo = false
    /// `pairing_rate_limited`: botón y cámara en pausa 60 s.
    var pausa = false
}

/// Campo de dirección mal escrito (el error va en su campo, no en la fila).
enum HuecoDireccion: String, Sendable { case casa, tailscale }

enum ReglasEmparejar {
    /// La pausa de «Demasiados intentos» (a2 §22.5).
    static let pausa: Duration = .seconds(60)
    /// La cápsula de un QR ajeno o de un error vuelve a la de escanear a los 4,5 s (a2 §22.3.1).
    static let vueltaCapsula: Duration = .milliseconds(4500)
    /// Tras un QR ajeno se ignoran lecturas 2 s.
    static let ignorarTrasAjeno: Duration = .seconds(2)
    /// El marco rojo del QR ajeno dura 600 ms.
    static let marcoRojo: Duration = .milliseconds(600)
    /// «Emparejado» a la vista antes de pasar a la agenda (a2 §22.6).
    static let pausaExito: Duration = .milliseconds(600)
    /// Fallos seguidos del canje que ponen la pausa aunque el servidor aún no la haya pedido (5 intentos
    /// por código en el servidor; b-arquitectura §3.8, `ModeloEmparejarTests`).
    static let fallosAntesDePausa = 5

    /// Texto de entrada (a2 §22.4).
    static let entrada =
        "En la web de Ace Player Neo, abre Ajustes › Dispositivos y toca «Emparejar un dispositivo». Escanea el QR que aparece o escribe el código aquí debajo."
    /// Lo que lee VoiceOver con un QR ajeno (a2 §22.5).
    static let qrAjenoLargo =
        "Ese código QR no es de Ace Player Neo. Sácalo en la web: Ajustes → Dispositivos → Emparejar un dispositivo."

    /// Solo cifras ASCII y como mucho 6.
    static func filtrarCodigo(_ texto: String) -> String {
        String(texto.filter { $0.isASCII && $0.isNumber }.prefix(6))
    }

    /// ¿Lo pegado en el campo del código es un enlace `aceneo://pair…`? (se aplica entero y se empareja solo).
    static func esEnlace(_ texto: String) -> Bool {
        texto.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().hasPrefix("aceneo://")
    }

    /// El nombre de la dirección sin esquema ni puerto («umbrel.local», «192.168.1.188»).
    static func host(_ url: URL) -> String {
        let host = url.host() ?? url.absoluteString
        return host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
    }

    /// La cápsula de cada estado; `nil` en los estados sin cámara (a2 §22.3.1).
    static func capsula(_ estado: EstadoCamara) -> CapsulaCamara? {
        switch estado {
        case .preparando: CapsulaCamara(icono: .qr, texto: "Preparando la cámara…", tinta: .blanco)
        case .escaneando: CapsulaCamara(icono: .qr, texto: "Apunta al QR de la web: Ajustes › Dispositivos", tinta: .blanco)
        case .qrAjeno: CapsulaCamara(icono: .aviso, texto: "Ese QR no es de Ace Player Neo", tinta: .ambar)
        case .emparejando(let host): CapsulaCamara(icono: .refresh, texto: "Emparejando con \(host)…", tinta: .blanco, ruedita: true)
        case .emparejado(let host): CapsulaCamara(icono: .check, texto: "Emparejado con \(host)", tinta: .verde)
        case .errorEmparejar: CapsulaCamara(icono: .aviso, texto: "No se pudo emparejar", tinta: .rojo)
        case .pausa: CapsulaCamara(icono: .clock, texto: "Espera un minuto y vuelve a probar", tinta: .blanco)
        case .ocupada: CapsulaCamara(icono: .aviso, texto: "La cámara la está usando otra app", tinta: .ambar)
        case .sinPermiso, .restringida, .sinCamara: nil
        }
    }

    static func marco(_ estado: EstadoCamara) -> MarcoCamara {
        switch estado {
        case .escaneando, .emparejando, .errorEmparejar: .oro
        case .preparando, .pausa, .ocupada: .oroApagado
        case .qrAjeno: .rojo
        case .emparejado: .verde
        case .sinPermiso, .restringida, .sinCamara: .oculto
        }
    }

    /// Título, texto y si hay «Abrir Ajustes» del bloque sin cámara (a2 §22.3.2).
    static func sinCamara(_ estado: EstadoCamara) -> (titulo: String, texto: String, abrirAjustes: Bool)? {
        switch estado {
        case .sinPermiso:
            ("Sin permiso para la cámara", "Actívalo en Ajustes › Ace Neo › Cámara, o escribe el código aquí debajo.", true)
        case .restringida:
            ("La cámara está bloqueada",
             "Las restricciones de este iPhone no dejan usar la cámara. Escribe el código aquí debajo.", false)
        case .sinCamara:
            ("No hay cámara disponible", "Escribe el código y la dirección aquí debajo.", false)
        default: nil
        }
    }

    /// El error del canje con su texto y su efecto (a2 §22.5). Todo error suena con `error`.
    static func fallo(_ error: APIError) -> FalloCanje {
        let texto = error.mensaje
        switch error.codigo {
        case "pairing_invalid": return FalloCanje(texto: texto, bordeCodigo: true)
        case "pairing_expired": return FalloCanje(texto: texto, vaciarCodigo: true)
        case "pairing_rate_limited": return FalloCanje(texto: texto, pausa: true)
        default: return FalloCanje(texto: texto)
        }
    }

    /// ¿Se puede volver a leer el mismo QR tras este fallo? Sí si no es del código (red, ATS, no es un Ace Player
    /// Neo…): el reintento puede salir bien. Con un código incorrecto, caducado o en pausa, no (a2 §22.5).
    static func releerTrasFallo(_ fallo: FalloCanje) -> Bool {
        !fallo.bordeCodigo && !fallo.vaciarCodigo && !fallo.pausa
    }

    /// El error de una dirección mal escrita, en su campo (a2 §22.4).
    static func errorDireccion(_ hueco: HuecoDireccion) -> String {
        switch hueco {
        case .casa: "La dirección no es válida. Ejemplo: http://umbrel.local:7792"
        case .tailscale: "La dirección no es válida. Ejemplo: http://umbrel.tu-red.ts.net:7792"
        }
    }

    /// Las direcciones de los dos campos; un campo con texto que no es una dirección da su error.
    static func direcciones(casa: String, tailscale: String)
        -> (config: ServerConfig, errores: [HuecoDireccion: String])
    {
        var config = ServerConfig()
        var errores: [HuecoDireccion: String] = [:]
        if !casa.trimmingCharacters(in: .whitespaces).isEmpty {
            if let url = ServerConfig.normalizar(casa) { config.lan = url } else { errores[.casa] = errorDireccion(.casa) }
        }
        if !tailscale.trimmingCharacters(in: .whitespaces).isEmpty {
            if let url = ServerConfig.normalizar(tailscale) { config.tailscale = url } else {
                errores[.tailscale] = errorDireccion(.tailscale)
            }
        }
        return (config, errores)
    }

    /// Las direcciones de un enlace en su hueco por `ServerVia.clasificar`: la primera de cada tipo (a9 §3.4).
    static func huecos(_ servidores: [URL]) -> (casa: URL?, tailscale: URL?) {
        var casa: URL?
        var tailscale: URL?
        for url in servidores {
            switch ServerVia.clasificar(url) {
            case .lan where casa == nil: casa = url
            case .tailscale where tailscale == nil: tailscale = url
            default: break
            }
        }
        return (casa, tailscale)
    }

    /// Todas las `u=` de un enlace `aceneo://pair?u=…&u=…&c=…`, normalizadas y en su orden (a9 §3.4).
    static func servidores(de url: URL) -> [URL] {
        guard let partes = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return [] }
        return (partes.queryItems ?? []).filter { $0.name == "u" }.compactMap { $0.value.flatMap(ServerConfig.normalizar) }
    }

    /// Texto del aviso de acceso perdido (a2 §23.3). «Olvidar este iPhone»: sin aviso.
    static func avisoAcceso(_ motivo: MotivoEmparejarPuro) -> String? {
        switch motivo {
        case .dispositivoRetirado: ErrorCatalog.mensaje(para: "device_revoked")
        case .noAutorizado: ErrorCatalog.mensaje(para: "unauthorized")
        case .revocadoDesdeOtro:
            "Este iPhone se ha revocado desde otro dispositivo. Para volver, emparéjalo otra vez desde la web."
        case .llaveroIlegible: "El token guardado en el Llavero no se puede leer. Vuelve a emparejar la app."
        case .olvidadoAqui: nil
        }
    }
}

/// El motivo de volver a emparejar en puro (el de `SesionApp`, `MotivoEmparejar`, vive con la sesión).
enum MotivoEmparejarPuro: Sendable { case olvidadoAqui, revocadoDesdeOtro, noAutorizado, dispositivoRetirado, llaveroIlegible }
