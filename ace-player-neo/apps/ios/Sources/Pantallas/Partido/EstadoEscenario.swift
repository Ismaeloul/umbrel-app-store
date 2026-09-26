import Foundation

/* Textos del escenario (player/status.ts y MiniPlayer.tsx de la web): el estado base de la cápsula de
   estado (statusFor), el botón Directo (liveButton), el panel del vídeo (stageMessage) y el rótulo del
   mini (miniKicker). Puro sobre una foto del reproductor. Cuando M3 publique `EstadoVisible`
   (Core/Reglas/Reproduccion) con estas mismas reglas, esto se sustituye por él sin tocar las vistas. */

/// Lo que el escenario necesita saber del reproductor y de la sesión de fuentes (sin objetos: se prueba solo).
struct FotoReproductor: Hashable, Sendable {
    var titulo: String?
    var hash: String?
    var fase: FaseReproductor = .idle
    var conexion: FaseConexion = .idle
    var mensaje: String?
    var intento: IntentoReconexion?
    var directo: InfoDirecto = .nada
    /// Ya hubo imagen con esta fuente (`started`).
    var arranco = false
    var motivoParada: MotivoParada?
    var quiereReproducir = false
    var demo = false
    /// Texto de espera de la sesión de fuentes (`waiting`).
    var espera: String?
    /// «Fuente 1 verificada.» (solo en partidos).
    var lead: String?

    var hayCanal: Bool { titulo != nil }
    /// `desiredPlaying || phase === 'buffer'`.
    var quiereSonar: Bool { quiereReproducir || fase == .buffer }
    /// Conectando no hay nada que pausar (PlayerSurface.tsx: `connecting`).
    var conectando: Bool {
        switch conexion {
        case .pidiendo, .conectando, .precarga, .reconectando, .arrancando: true
        default: false
        }
    }
    /// −30 s: conexión activa, ya hubo imagen y no es la demo.
    var puedeRetroceder: Bool { conexion == .activa && arranco && !demo }
    var segundosDetras: Int { Int(directo.recuperable.rounded()) }
    var retrasoSegundos: Int { Int(directo.retraso.rounded()) }
}

enum ModoDirecto: String, Sendable { case off, live, behind, resume }

struct BotonDirecto: Hashable, Sendable {
    var modo: ModoDirecto
    /// Lo que se puede esconder si no cabe («Ir al directo · »).
    var prefijo: String
    var texto: String
    var etiqueta: String
}

enum TonoMensaje: Sendable { case reposo, ocupado, error }

struct MensajeEscenario: Hashable, Sendable {
    var titulo: String
    var texto: String
    var tono: TonoMensaje
}

enum EstadoEscenario {
    /// Textos de reposo del reproductor (a4 §21, «Reposo»).
    static let reposoInicio = "Elige un partido en la agenda o un canal de la biblioteca."
    static let reposoDetenido = "Reproducción detenida. Elige otro partido o canal."
    static let reposoTraspasado = "La reproducción ha pasado a otro dispositivo."
    static let reposoFallo = "Este canal no tiene pares ahora mismo. Puede que no esté emitiendo todavía."

    private static func conLead(_ lead: String?, _ texto: String) -> String {
        guard let limpio = lead?.trimmingCharacters(in: .whitespaces), !limpio.isEmpty else { return texto }
        return "\(limpio) \(texto)"
    }

    /// El mensaje de reposo según por qué no suena nada (`idleReason`).
    static func textoReposo(_ foto: FotoReproductor) -> String {
        if let mensaje = foto.mensaje { return mensaje }
        switch foto.motivoParada {
        case .usuario: return reposoDetenido
        case .traspaso: return reposoTraspasado
        case .fallo: return reposoFallo
        case .sinAcceso, .none: return reposoInicio
        }
    }

    /// Estado base de la línea de estado (`statusFor`, status.ts). nil: no hay nada que decir.
    static func base(_ foto: FotoReproductor) -> ContenidoLinea? {
        switch foto.fase {
        case .idle:
            if let espera = foto.espera { return ContenidoLinea(texto: espera, senal: .checking) }
            if foto.motivoParada == .traspaso { return ContenidoLinea(texto: textoReposo(foto), icono: .movil) }
            if foto.motivoParada == .usuario { return ContenidoLinea(texto: textoReposo(foto), icono: .stop) }
            return nil
        case .cargando:
            let dato = foto.intento.map { "intento \($0.n) de \($0.max)" }
            return ContenidoLinea(texto: foto.mensaje ?? "Conectando con AceStream…", senal: .checking, dato: dato)
        case .reconectando:
            return ContenidoLinea(texto: foto.mensaje ?? "Reconectando…", tono: .warn, senal: .checking)
        case .error:
            return ContenidoLinea(texto: foto.mensaje ?? "No se pudo abrir el canal.", tono: .err, senal: .fail)
        case .buffer:
            return ContenidoLinea(texto: conLead(foto.lead, "La señal va justa: rellenando el colchón."), senal: .weak)
        case .buscando:
            return ContenidoLinea(texto: "Saltando…", icono: .refresh)
        case .pausado:
            let dato = foto.directo.disponible && foto.segundosDetras > 0 ? "−\(foto.segundosDetras) s" : nil
            return ContenidoLinea(texto: "En pausa. Pulsa Directo para volver al directo.", icono: .pause, dato: dato)
        case .reproduciendo:
            return baseReproduciendo(foto)
        }
    }

    private static func baseReproduciendo(_ foto: FotoReproductor) -> ContenidoLinea {
        if foto.demo { return ContenidoLinea(texto: conLead(foto.lead, "Vas en directo."), senal: .ok, dato: "demo") }
        if foto.directo.disponible && !foto.directo.enDirecto {
            return ContenidoLinea(texto: "Vas por detrás del directo.", senal: .ok, dato: "−\(foto.segundosDetras) s")
        }
        let dato = foto.directo.disponible ? "\(foto.retrasoSegundos) s de retraso" : nil
        return ContenidoLinea(texto: conLead(foto.lead, "Vas en directo."), senal: .ok, dato: dato)
    }

    /// El botón Directo (`liveButton`, status.ts; a4 §5.4).
    static func directo(_ foto: FotoReproductor) -> BotonDirecto {
        let sinImagen = foto.conexion != .activa
        if !foto.hayCanal || foto.fase == .idle || foto.fase == .error || sinImagen {
            return BotonDirecto(modo: .off, prefijo: "", texto: "Directo", etiqueta: "Directo")
        }
        if foto.directo.disponible && !foto.directo.enDirecto && !foto.demo {
            let s = foto.segundosDetras
            return BotonDirecto(
                modo: .behind, prefijo: "Ir al directo · ", texto: "−\(s) s",
                etiqueta: "Ir al directo (vas \(s) segundos por detrás)")
        }
        if foto.fase == .pausado {
            return BotonDirecto(modo: .resume, prefijo: "", texto: "Reanudar", etiqueta: "Reanudar en directo")
        }
        return BotonDirecto(modo: .live, prefijo: "", texto: "Directo", etiqueta: "Ya en directo")
    }

    /// Titular y frase del panel del vídeo mientras no hay imagen (`stageMessage`, status.ts; a4 §8.1).
    static func mensaje(_ foto: FotoReproductor) -> MensajeEscenario? {
        switch foto.fase {
        case .idle:
            if let espera = foto.espera { return MensajeEscenario(titulo: "Buscando señal", texto: espera, tono: .ocupado) }
            if foto.motivoParada == .traspaso {
                return MensajeEscenario(titulo: "En otro dispositivo", texto: textoReposo(foto), tono: .reposo)
            }
            return MensajeEscenario(titulo: "Sin señal", texto: textoReposo(foto), tono: .reposo)
        case .cargando:
            if foto.conexion == .activa { return nil }
            let titulo = foto.arranco || foto.intento != nil ? "Reconectando" : "Conectando"
            return MensajeEscenario(titulo: titulo, texto: foto.mensaje ?? "Conectando con AceStream…", tono: .ocupado)
        case .reconectando:
            return MensajeEscenario(titulo: "Reconectando", texto: foto.mensaje ?? "Reconectando…", tono: .ocupado)
        case .error:
            return MensajeEscenario(
                titulo: "No se pudo abrir",
                texto: foto.mensaje ?? "El reproductor no pudo iniciar esta fuente. Prueba la siguiente.", tono: .error)
        default:
            return nil
        }
    }

    /// Botón del panel: «Reintentar» en error (salvo el motor caído) o «Reproducir aquí» tras un traspaso.
    static func botonMensaje(_ foto: FotoReproductor) -> (titulo: String, icono: NombreIcono)? {
        if foto.fase == .idle && foto.motivoParada == .traspaso && foto.espera == nil { return ("Reproducir aquí", .play) }
        if foto.fase == .error { return ("Reintentar", .refresh) }
        return nil
    }

    /// Datos de reposo del panel: solo en reposo, sin espera y sin traspaso.
    static func conDatosDeReposo(_ foto: FotoReproductor) -> Bool {
        foto.fase == .idle && foto.espera == nil && foto.motivoParada != .traspaso
    }

    /// Rótulo del mini (`miniKicker`, MiniPlayer.tsx).
    static func rotuloMini(_ fase: FaseReproductor) -> String {
        switch fase {
        case .reproduciendo, .buffer, .buscando: "Sonando"
        case .cargando: "Conectando…"
        case .reconectando: "Reconectando…"
        case .pausado: "En pausa"
        case .error: "Sin señal"
        case .idle: "Detenido"
        }
    }
}
