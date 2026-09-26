import Foundation

/* Textos del escenario (player/status.ts y MiniPlayer.tsx de la web): el estado base de la cápsula de
   estado (statusFor), el botón Directo (liveButton), el panel del vídeo (stageMessage) y el rótulo del
   mini (miniKicker). Integración (I1): las reglas son las de M3 (`EstadoVisible`, Core/Reglas/Reproduccion);
   aquí solo queda la foto que el teatro necesita (título, hash y «quiere sonar», que la de M3 no lleva) y los
   dos detalles del panel que son del teatro (botón del panel y datos de reposo). */

/// El modo del botón Directo y el tono del panel son los de M3.
typealias ModoDirecto = ModoBotonDirecto
typealias TonoMensaje = MensajeEscenario.Tono

/// Lo que el escenario necesita saber del reproductor y de la sesión de fuentes (sin objetos: se prueba solo).
struct FotoEscenario: Hashable, Sendable {
    var titulo: String?
    var hash: String?
    var fase: FaseReproductor
    var conexion: FaseConexion
    var mensaje: String?
    var intento: IntentoReconexion?
    var directo: InfoDirecto
    /// Ya hubo imagen con esta fuente (`started`).
    var arranco: Bool
    var motivoParada: MotivoParada?
    var quiereReproducir: Bool
    var demo: Bool
    /// Texto de espera de la sesión de fuentes (`waiting`).
    var espera: String?
    /// «Fuente 1 verificada.» (solo en partidos).
    var lead: String?

    init(
        titulo: String? = nil, hash: String? = nil, fase: FaseReproductor = .idle, conexion: FaseConexion = .idle,
        mensaje: String? = nil, intento: IntentoReconexion? = nil, directo: InfoDirecto = .nada,
        arranco: Bool = false, motivoParada: MotivoParada? = nil, quiereReproducir: Bool = false,
        demo: Bool = false, espera: String? = nil, lead: String? = nil
    ) {
        self.titulo = titulo
        self.hash = hash
        self.fase = fase
        self.conexion = conexion
        self.mensaje = mensaje
        self.intento = intento
        self.directo = directo
        self.arranco = arranco
        self.motivoParada = motivoParada
        self.quiereReproducir = quiereReproducir
        self.demo = demo
        self.espera = espera
        self.lead = lead
    }

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

    /// Por qué no suena nada (`idleReason`, la regla de M3).
    var reposo: MotivoReposo? { MotivoReposo.de(motivoParada, hayCanal: hayCanal) }

    /// La foto de M3 que leen las reglas de `EstadoVisible`. En reposo, sin mensaje propio, el de `IDLE_MESSAGES`.
    var visible: FotoReproductor {
        let enReposo: String? = fase == .idle ? reposo?.mensaje : nil
        return FotoReproductor(
            fase: fase, conexion: conexion, hayCanal: hayCanal, arranco: arranco, lead: lead, espera: espera,
            reposo: reposo, mensaje: mensaje ?? enReposo, intento: intento, directo: DirectoVisible(directo),
            demo: demo)
    }
}

enum EstadoEscenario {
    /// Estado base de la línea de estado (`statusFor`, status.ts). nil: no hay nada que decir.
    static func base(_ foto: FotoEscenario) -> ContenidoLinea? { EstadoVisible.linea(foto.visible) }

    /// El botón Directo (`liveButton`, status.ts; a4 §5.4).
    static func directo(_ foto: FotoEscenario) -> BotonDirecto { EstadoVisible.botonDirecto(foto.visible) }

    /// Titular y frase del panel del vídeo mientras no hay imagen (`stageMessage`, status.ts; a4 §8.1).
    static func mensaje(_ foto: FotoEscenario) -> MensajeEscenario? { EstadoVisible.mensajeEscenario(foto.visible) }

    /// Botón del panel: «Reintentar» en error (salvo el motor caído) o «Reproducir aquí» tras un traspaso.
    static func botonMensaje(_ foto: FotoEscenario) -> (titulo: String, icono: NombreIcono)? {
        if foto.fase == .idle && foto.reposo == .traspasado && foto.espera == nil { return ("Reproducir aquí", .play) }
        if foto.fase == .error { return ("Reintentar", .refresh) }
        return nil
    }

    /// Datos de reposo del panel: solo en reposo, sin espera y sin traspaso.
    static func conDatosDeReposo(_ foto: FotoEscenario) -> Bool {
        foto.fase == .idle && foto.espera == nil && foto.reposo != .traspasado
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
