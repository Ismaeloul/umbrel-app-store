import Foundation

/* Lo que se ve del reproductor: apps/web/src/player/status.ts (statusFor, liveButton, stageMessage),
   IDLE_MESSAGES de player/runtime.ts y las filas de «Datos técnicos» de player/NerdPanel.tsx. Funciones puras
   sobre una foto del estado público del reproductor (`FotoReproductor`); las vistas solo pintan. En iOS no
   hay «bloqueado» (autoplay bloqueado) ni «rebuffer» propio (a7 §14.3): esas ramas de la web no existen. */

/// Por qué no suena nada (`IdleReason` de la web).
enum MotivoReposo: String, Sendable, Hashable, CaseIterable {
    case inicio, detenido, traspasado, fallo
    case sinMotor = "sin-motor"

    /// `IDLE_MESSAGES` (player/runtime.ts).
    var mensaje: String {
        switch self {
        case .inicio: "Elige un partido en la agenda o un canal de la biblioteca."
        case .detenido: "Reproducción detenida. Elige otro partido o canal."
        case .traspasado: "La reproducción ha pasado a otro dispositivo."
        case .fallo: "Este canal no tiene pares ahora mismo. Puede que no esté emitiendo todavía."
        case .sinMotor: "El motor AceStream no responde. Se reanudará solo cuando vuelva."
        }
    }

    /// De la parada del reproductor (nil sin canal = el reposo inicial).
    static func de(_ parada: MotivoParada?, hayCanal: Bool) -> MotivoReposo? {
        switch parada {
        case .usuario: .detenido
        case .traspaso: .traspasado
        case .fallo, .sinAcceso: .fallo
        case .sinMotor: .sinMotor
        case nil: hayCanal ? nil : .inicio
        }
    }
}

/// `LiveInfo` de la web, medido como en `meter()` de runtime.ts.
struct DirectoVisible: Sendable, Hashable {
    var disponible: Bool
    /// En el borde (con el margen de 3 s para pintar).
    var enDirecto: Bool
    /// Segundos por detrás del borde útil (`Math.ceil`).
    var porDetrasS: Int
    /// Lo cargado por delante hasta lo último que ha llegado (`Math.round`); nil sin directo.
    var retrasoS: Int?

    static let nada = DirectoVisible(disponible: false, enDirecto: true, porDetrasS: 0, retrasoS: nil)

    init(disponible: Bool, enDirecto: Bool, porDetrasS: Int, retrasoS: Int?) {
        self.disponible = disponible
        self.enDirecto = enDirecto
        self.porDetrasS = porDetrasS
        self.retrasoS = retrasoS
    }

    init(_ info: InfoDirecto) {
        guard info.disponible else {
            self = .nada
            return
        }
        self.init(
            disponible: true, enDirecto: info.enDirecto, porDetrasS: Int(info.recuperable.rounded(.up)),
            retrasoS: Int(info.retraso.rounded(.toNearestOrAwayFromZero)))
    }
}

/// Foto del estado público del reproductor (`PlayerState` de la web, lo que usan estas reglas).
struct FotoReproductor: Sendable, Hashable {
    var fase: FaseReproductor = .idle
    var conexion: FaseConexion = .idle
    var hayCanal = false
    /// Ya hubo un fotograma real con esta fuente (`started`).
    var arranco = false
    /// Frase de la fuente para la línea de estado: «Fuente 1 verificada.».
    var lead: String?
    /// Lo que la sesión de fuentes dice mientras espera una fuente (`waiting`).
    var espera: String?
    var reposo: MotivoReposo? = .inicio
    var mensaje: String?
    var intento: IntentoReconexion?
    var directo: DirectoVisible = .nada
    var demo = false
}

/// El botón de directo (`LiveButtonMode`).
enum ModoBotonDirecto: String, Sendable, Hashable { case live, behind, resume, off }

struct BotonDirecto: Sendable, Hashable {
    var modo: ModoBotonDirecto
    /// Lo que se puede esconder si no cabe («Ir al directo · »).
    var prefijo: String
    var texto: String
    /// Nombre accesible.
    var etiqueta: String
}

/// Titular y frase del panel del vídeo mientras no hay imagen (`stageMessage`).
struct MensajeEscenario: Sendable, Hashable {
    enum Tono: String, Sendable, Hashable { case reposo, ocupado, error }
    var titulo: String
    var texto: String
    var tono: Tono
}

enum EstadoVisible {
    private static func conLead(_ lead: String?, _ texto: String) -> String {
        let limpio = lead?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return limpio.isEmpty ? texto : "\(limpio) \(texto)"
    }

    /// `statusFor`: estado base de la línea de estado (nil: que la ponga la sesión de fuentes).
    static func linea(_ foto: FotoReproductor) -> ContenidoLinea? {
        switch foto.fase {
        case .idle:
            if let espera = foto.espera { return ContenidoLinea(texto: espera, senal: .checking) }
            if foto.reposo == .traspasado, let mensaje = foto.mensaje {
                return ContenidoLinea(texto: mensaje, icono: .movil)
            }
            if foto.reposo == .detenido, let mensaje = foto.mensaje {
                return ContenidoLinea(texto: mensaje, icono: .stop)
            }
            return nil
        case .cargando:
            let dato = foto.intento.map { "intento \($0.n) de \($0.max)" }
            return ContenidoLinea(texto: foto.mensaje ?? "Conectando con AceStream…", senal: .checking, dato: dato)
        case .reconectando:
            // El aviso ya lleva «(n/máx)»: sin dato a la derecha, que en el móvil no cabe.
            return ContenidoLinea(texto: foto.mensaje ?? "Reconectando…", tono: .warn, senal: .checking)
        case .error:
            return ContenidoLinea(texto: foto.mensaje ?? "No se pudo abrir el canal.", tono: .err, senal: .fail)
        case .buffer:
            return ContenidoLinea(texto: conLead(foto.lead, "La señal va justa: rellenando el colchón."), senal: .weak)
        case .buscando:
            return ContenidoLinea(texto: "Saltando…", icono: .refresh)
        case .pausado:
            let directo = foto.directo
            let dato = directo.disponible && directo.porDetrasS > 0 ? "−\(directo.porDetrasS) s" : nil
            return ContenidoLinea(texto: "En pausa. Pulsa Directo para volver al directo.", icono: .pause, dato: dato)
        case .reproduciendo:
            return lineaReproduciendo(foto)
        }
    }

    private static func lineaReproduciendo(_ foto: FotoReproductor) -> ContenidoLinea {
        if foto.demo { return ContenidoLinea(texto: conLead(foto.lead, "Vas en directo."), senal: .ok, dato: "demo") }
        let directo = foto.directo
        // Por detrás, lo importante es eso: sin la frase de la fuente, que en 390 px no cabe.
        if directo.disponible && !directo.enDirecto {
            return ContenidoLinea(texto: "Vas por detrás del directo.", senal: .ok, dato: "−\(directo.porDetrasS) s")
        }
        let dato = directo.retrasoS.map { "\($0) s de retraso" }
        return ContenidoLinea(texto: conLead(foto.lead, "Vas en directo."), senal: .ok, dato: dato)
    }

    /// `liveButton`: «Directo» en el borde; «Ir al directo · −34 s» detrás; «Reanudar» en pausa en el borde.
    static func botonDirecto(_ foto: FotoReproductor) -> BotonDirecto {
        // Sin imagen (conectando, reconectando, error) no hay directo al que ir.
        let sinImagen = foto.conexion != .activa
        if !foto.hayCanal || foto.fase == .idle || foto.fase == .error || sinImagen {
            return BotonDirecto(modo: .off, prefijo: "", texto: "Directo", etiqueta: "Directo")
        }
        let directo = foto.directo
        if directo.disponible && !directo.enDirecto && !foto.demo {
            let s = directo.porDetrasS
            return BotonDirecto(
                modo: .behind, prefijo: "Ir al directo · ", texto: "−\(s) s",
                etiqueta: "Ir al directo (vas \(s) segundos por detrás)")
        }
        if foto.fase == .pausado {
            return BotonDirecto(modo: .resume, prefijo: "", texto: "Reanudar", etiqueta: "Reanudar en directo")
        }
        return BotonDirecto(modo: .live, prefijo: "", texto: "Directo", etiqueta: "Ya en directo")
    }

    /// `stageMessage`: panel del vídeo sin imagen.
    static func mensajeEscenario(_ foto: FotoReproductor) -> MensajeEscenario? {
        switch foto.fase {
        case .idle:
            if let espera = foto.espera { return MensajeEscenario(titulo: "Buscando señal", texto: espera, tono: .ocupado) }
            if foto.reposo == .traspasado {
                return MensajeEscenario(titulo: "En otro dispositivo", texto: foto.mensaje ?? "", tono: .reposo)
            }
            return MensajeEscenario(
                titulo: "Sin señal", texto: foto.mensaje ?? MotivoReposo.inicio.mensaje, tono: .reposo)
        case .cargando:
            // Con imagen (reanudar tras una pausa) no se tapa el vídeo; sin ella, sí.
            if foto.conexion == .activa { return nil }
            return MensajeEscenario(
                titulo: foto.arranco || foto.intento != nil ? "Reconectando" : "Conectando",
                texto: foto.mensaje ?? "Conectando con AceStream…", tono: .ocupado)
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

    // MARK: «Datos técnicos» (player/NerdPanel.tsx)

    /// `formatSpeed`: KB/s → «214 KB/s» o «1,92 MB/s».
    static func velocidad(_ kbs: Double?) -> String {
        guard let kbs, kbs.isFinite else { return "—" }
        if kbs >= 1000 {
            return String(format: "%.2f", kbs / 1024).replacingOccurrences(of: ".", with: ",") + " MB/s"
        }
        return "\(Int(kbs.rounded(.toNearestOrAwayFromZero))) KB/s"
    }

    /// `seconds` de NerdPanel: hasta un decimal, sin ceros de más («6 s», «2,5 s»).
    static func segundos(_ valor: Double?) -> String {
        guard let valor, valor.isFinite else { return "—" }
        let redondo = (valor * 10).rounded(.toNearestOrAwayFromZero) / 10
        let texto =
            redondo == redondo.rounded()
            ? String(Int(redondo)) : String(format: "%.1f", redondo).replacingOccurrences(of: ".", with: ",")
        return "\(texto) s"
    }

    /// Entrega según el protocolo (`DELIVERY`).
    static func entrega(_ protocolo: StreamProtocol?) -> String {
        guard let protocolo else { return "—" }
        switch protocolo {
        case .mpegts: return "progresivo (MPEG-TS)"
        case .hls: return "HLS compartido"
        case .hlsFmp4: return "remux fMP4 para iPhone"
        case .desconocido: return protocolo.rawValue
        }
    }

    /// Lo que enseñan las filas de «Datos técnicos».
    struct DatosTecnicos: Sendable, Hashable {
        /// Texto del motor («en línea», «en línea (demo)»…), lo da quien pinta con el estado del motor.
        var motor: String
        /// «HLS del sistema» (AVPlayer) o «Demo».
        var demo: Bool
        var hayMotorVideo: Bool
        var protocolo: StreamProtocol?
        var estadisticas: StreamStatsData?
        var colchonS: Double?
        var retrasoS: Int?
        var primeraImagenMs: Double?
        var codec: StreamCodec?
        var sesion: String?
    }

    /// `nerdRows` (sin la fila del hash, que va aparte).
    static func filasDatosTecnicos(_ d: DatosTecnicos) -> [(String, String)] {
        let e = d.estadisticas
        let reproductor = d.hayMotorVideo ? (d.demo ? "Demo" : "HLS del sistema") : "—"
        let primera = d.primeraImagenMs.map { segundos($0 / 1000) } ?? "—"
        return [
            ("Motor", d.motor),
            ("Reproductor", reproductor),
            ("Entrega", entrega(d.protocolo)),
            ("Pares", e.map { String($0.peers) } ?? "—"),
            ("Bajada", velocidad(e?.speedDown)),
            ("Subida", velocidad(e?.speedUp)),
            ("Estado del motor", (e?.status).flatMap { $0.isEmpty ? nil : $0 } ?? "—"),
            ("Colchón", segundos(d.colchonS)),
            ("Retraso", segundos(d.retrasoS.map(Double.init))),
            ("Primera imagen", primera),
            ("Códec", d.codec.map { "\($0.video) · \($0.audio)" } ?? "—"),
            ("Sesión", d.sesion ?? "—"),
        ]
    }
}
