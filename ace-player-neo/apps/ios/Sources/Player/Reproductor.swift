import Foundation
import Observation
import os

/// Un aviso del reproductor para el `notify()` de la app (Avisos, M4): lo engancha la sesión de fuentes.
struct AvisoReproductor: Sendable, Hashable {
    var texto: String
    var clase: ClaseAviso = .senal
    var tono: TonoAviso = .info
    var icono: NombreIcono?
    var senal: EstadoSenal?
}

/// Lo que la sesión de fuentes (y quien quiera) necesita saber del reproductor (`onPlayerChange` de la web).
enum SucesoReproductor: Sendable, Hashable {
    /// Empieza a sonar otro canal (o fuente).
    case empezo(CanalReproducible)
    /// Primer fotograma real de esta fuente.
    case arranco(CanalReproducible)
    /// Se detuvo o pasó a otro dispositivo (`stop('detenido' | 'traspasado')`).
    case parado(MotivoParada)
}

/// El orquestador de la reproducción: pide la URL al backend, engancha AVPlayer, vigila, reconecta, salta
/// al directo, suelta la sesión y cuenta lo que pasa. Es `apps/web/src/player/runtime.ts` sobre
/// `MaquinaConexion` (textos de la web, a8 §3.11.8):
///
/// - El INTENTO pertenece a la fuente elegida: una reconexión no manda otro `arranco` y una fuente que se cae
///   tras 10 min se anota `cayo`, no `fallo`.
/// - Presupuesto de reconexiones POR VENTANA (las de los últimos 3 min) con espera exponencial (1, 2, 4 s):
///   3 antes de dar la fuente por perdida (1 en el arranque automático antes de la primera imagen). Agotadas,
///   se pregunta a `alFallarFuente` (la sesión de fuentes pasa a la siguiente verificada).
/// - La sesión es del backend (D5): latido cada 15 s y release al parar. Un 410/404 en el latido distingue el
///   traspaso a otro dispositivo de una sesión caducada.
/// - Imagen congelada con vídeo por delante: SALTA AL DIRECTO en vez de reiniciar; si sigue parada 24 s,
///   reconecta. `stream.reopened` reengancha sin intervención; `playback.handoff` para sin soltar.
/// - «Arrancó» = primer fotograma real, no el colchón lleno.
/// - Demo (`-AceNeoDemo`, como `?demo=1`): no pide `channelStream`, no late, no suelta ni manda resultados ni
///   diagnósticos (a7 §13.13); el motor simulado da «señal» a los 1,8 s.
///
/// Sin estado de presentación (vive en `PresentacionReproductor`).
@MainActor
@Observable
public final class Reproductor {
    // MARK: Lo que pinta la interfaz

    public internal(set) var canal: CanalReproducible?
    public internal(set) var conexion: FaseConexion = .idle
    public internal(set) var medio: FaseMedio = .idle
    public internal(set) var mensaje: String?
    public internal(set) var intento: IntentoReconexion?
    public internal(set) var directo: InfoDirecto = .nada
    public internal(set) var estadisticas: StreamStatsData?
    /// Ya hubo imagen con esta fuente (`started`).
    public internal(set) var arranco = false
    public internal(set) var sesionId: String?
    public internal(set) var motivoParada: MotivoParada?
    /// La persona quiere que suene (intención, no medida: `desiredPlaying`).
    public internal(set) var quiereReproducir = false
    public internal(set) var modo: PlaybackMode
    /// Sube con cada fuente perdida.
    public internal(set) var errores = 0
    /// Sube con cada canal nuevo.
    public internal(set) var cambiosDeFuente = 0
    /// Sube cada vez que, agotada una fuente, la sesión pasa sola a la siguiente.
    public internal(set) var cambiosAutomaticos = 0
    /// Hay una detención reciente que se puede deshacer («Deshacer» del mini).
    public internal(set) var puedeDeshacerDetencion = false
    /// Veces que el vigilante saltó al directo por imagen congelada.
    public internal(set) var saltosAlDirecto = 0
    /// Milisegundos desde que se pidió la fuente hasta la primera imagen (`ttffMs`, «Datos técnicos»).
    public internal(set) var primeraImagenMs: Double?
    /// Reconexiones de la fuente actual.
    public internal(set) var reconexiones = 0
    /// Lista de zapping (favoritos + lista activa, `zappingList`): la pantalla de bloqueo y ‹ › la recorren.
    public var lista: [CanalReproducible] = []
    /// Quién pidió lo que suena.
    var origen: OrigenReproduccion?
    /// Lo que la sesión de fuentes dice mientras espera una fuente (`waiting`): panel «Buscando señal».
    var espera: String?
    /// «Datos técnicos»: protocolo y códec de la concesión, colchón por delante.
    var protocolo: StreamProtocol?
    var codec: StreamCodec?
    var colchonS: Double = 0
    var silenciado = false

    public var fase: FaseReproductor { FaseReproductor.derivar(conexion, medio) }

    // MARK: Dependencias y enganches

    public let motor: any MotorVideo
    public let visor: String
    /// Modo demo (sin backend de reproducción, a7 §13.13).
    @ObservationIgnored var demo = ModoEjecucion.demo
    /// Id de este dispositivo en el backend (del arranque), para reconocer un traspaso.
    @ObservationIgnored public var dispositivoId: String?
    /// Quien decide la siguiente fuente al agotar las reconexiones. Devuelve `true` si ya ha puesto otra.
    @ObservationIgnored public var alFallarFuente: ((FalloFuente) -> Bool)?
    /// El texto que deja quien decide cuando NO pone otra (`SourceFailedReply.message`); se consume al agotar.
    @ObservationIgnored var textoFalloPendiente: String?
    /// Pantalla de bloqueo, Centro de Control y sesión de audio (nil en los tests).
    @ObservationIgnored public var sistema: (any ControlesDelSistema)?
    /// El `notify()` de la app (lo engancha la sesión de fuentes con `Avisos`).
    @ObservationIgnored var avisar: ((AvisoReproductor) -> Void)?
    /// La háptica de la app (lo engancha la sesión de fuentes con `Haptica`).
    @ObservationIgnored var vibrar: ((TipoHaptico) -> Void)?
    /// La biblioteca que devuelve apuntar en Recientes (la sesión la escribe en `DatosApp`).
    @ObservationIgnored var alGuardarReciente: ((LibraryView) -> Void)?
    /// Zapping: a dónde navegar (`partido/canal/<hash>`); lo engancha quien lleva la ruta.
    @ObservationIgnored var alZapear: ((CanalReproducible) -> Void)?
    @ObservationIgnored private var oyentes: [(SucesoReproductor) -> Void] = []

    let servicio: any ServicioReproduccion
    let esperar: @Sendable (TimeInterval) async throws -> Void
    let reloj: @Sendable () -> Date
    let automatico: Bool
    let registro = Logger(subsystem: "es.ismaeloul.aceplayerneo", category: "reproductor")

    // MARK: Estado interno (de la fuente y de la conexión)

    struct EstadoFuente {
        let clave: Int
        var canal: CanalReproducible
        let origen: OrigenReproduccion
        let pedidaEn: Date
        var reconexiones: [Date] = []
        var empezoEn: Date?
        var arrancoEnviado = false
        var ultimoSigue: Date = .distantPast
        var metricasEnviadas = false
        var ttffMs: Double?
        var rebuffers = 0
        var reconexionesTotales = 0
        var latencia: (suma: Double, n: Int) = (0, 0)
        /// Agotada: ya no manda resumen de métricas al cambiar de canal.
        var fallida = false
    }

    struct EstadoConexion {
        let generacion: Int
        var recuperacion = false
        var ticsConexion = 0
        var ticsParado = 0
        var ticsGracia = 0
        var ultimaPosicion: Double = 0
    }

    struct Sesion {
        let id: String
        var url: URL
        var protocolo: StreamProtocol
        let latidoMs: Int
    }

    /// Lo último que sonaba antes de `detener()`, para «Deshacer».
    struct Detencion {
        let canal: CanalReproducible
        let lista: [CanalReproducible]
        let origen: OrigenReproduccion
    }

    @ObservationIgnored var ultimaDetencion: Detencion?
    @ObservationIgnored var fuente: EstadoFuente?
    @ObservationIgnored var estadoConexion: EstadoConexion?
    @ObservationIgnored var sesion: Sesion?
    @ObservationIgnored var generacion = 0
    @ObservationIgnored var claves = 0
    @ObservationIgnored var pausasPropias = 0
    /// El motor AceStream estaba caído al pedir la fuente: se reengancha cuando vuelva (`waitingForEngine`).
    @ObservationIgnored var esperandoMotor = false
    @ObservationIgnored var tareaConexion: Task<Void, Never>?
    @ObservationIgnored var tareaReconexion: Task<Void, Never>?
    @ObservationIgnored var tareaLatido: Task<Void, Never>?
    @ObservationIgnored var tareaVigilante: Task<Void, Never>?
    @ObservationIgnored var tareaMedidor: Task<Void, Never>?
    @ObservationIgnored var tareaPausaAjena: Task<Void, Never>?
    @ObservationIgnored var tareaDemo: Task<Void, Never>?

    /// - Parameters:
    ///   - automatico: arranca el vigilante (1,5 s), el medidor (0,5 s) y el latido (15 s). En los tests va a
    ///     `false` y se llama a `tic()` y `latir()` a mano.
    ///   - esperar: la espera entre reconexiones (en los tests, inmediata).
    public init(
        motor: any MotorVideo, servicio: any ServicioReproduccion, visor: String,
        modo: PlaybackMode = .porDefecto, automatico: Bool = true,
        esperar: @escaping @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) },
        reloj: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.motor = motor
        self.servicio = servicio
        self.visor = visor
        self.automatico = automatico
        self.esperar = esperar
        self.reloj = reloj
        self.modo = modo
        motor.alEvento = { [weak self] evento in self?.alEventoMotor(evento) }
    }

    // MARK: Lo que leen las reglas y las vistas

    /// Por qué no suena nada (`idleReason`).
    var reposo: MotivoReposo? { MotivoReposo.de(motivoParada, hayCanal: canal != nil) }

    /// La foto del estado que usan `EstadoVisible` (línea de estado, botón de directo, panel del vídeo).
    var foto: FotoReproductor {
        FotoReproductor(
            fase: fase, conexion: conexion, hayCanal: canal != nil, arranco: arranco, lead: canal?.lead,
            espera: espera, reposo: reposo, mensaje: mensaje, intento: intento, directo: DirectoVisible(directo),
            demo: demo)
    }

    /// Lo que está en pantalla para las reglas de fuentes (`onScreenOf`).
    var enPantalla: EnPantalla { EnPantalla(fase: fase, id: canal?.id, arranco: arranco) }

    /// Hay lista de zapping con otro canal (`canZap`).
    var puedeZapear: Bool {
        lista.count > 1 || (lista.count == 1 && lista.first?.id != canal?.id)
    }

    /// Se puede retroceder 30 s (`conn === 'activa' && started && !demo`).
    var puedeRetroceder: Bool { conexion == .activa && arranco && !demo }

    func escuchar(_ oyente: @escaping (SucesoReproductor) -> Void) { oyentes.append(oyente) }

    func contar(_ suceso: SucesoReproductor) {
        for oyente in oyentes { oyente(suceso) }
    }

    func notificar(
        _ texto: String, clase: ClaseAviso = .senal, tono: TonoAviso = .info, icono: NombreIcono? = nil,
        senal: EstadoSenal? = nil
    ) {
        avisar?(AvisoReproductor(texto: texto, clase: clase, tono: tono, icono: icono, senal: senal))
    }

    /// `setWaitingMessage`: lo que dice el vídeo mientras la sesión de fuentes espera una fuente.
    func fijarEspera(_ texto: String?) {
        guard espera != texto else { return }
        espera = texto
    }

    // MARK: Órdenes

    /// Pone a sonar un canal. El mismo canal ya en marcha no se reinicia (idempotente: solo se actualizan
    /// título, subtítulo y frase). La sesión anterior no se suelta a mano: la concesión nueva con el mismo
    /// visor la sustituye en el backend (a7 §9.2).
    public func reproducir(
        _ nuevo: CanalReproducible, origen: OrigenReproduccion = .usuario, lista: [CanalReproducible]? = nil
    ) {
        if let lista { self.lista = lista }
        if let actual = canal, actual.id == nuevo.id, fuente != nil, conexion.enMarcha {
            canal = nuevo
            fuente?.canal = nuevo
            sistema?.cambio(self)
            return
        }
        if let anterior = fuente { terminarFuente(porque: anterior.fallida ? nil : "cambio de canal") }
        olvidarSesion()
        claves += 1
        fuente = EstadoFuente(clave: claves, canal: nuevo, origen: origen, pedidaEn: reloj())
        empezarFuente(nuevo, origen: origen)
        transicion(.solicitar)
        sistema?.empezo(nuevo)
        sistema?.cambio(self)
        if nuevo.apuntar { apuntarEnRecientes(nuevo) }
        contar(.empezo(nuevo))
        conectar(recuperacion: false)
        arrancarVigilante()
    }

    private func empezarFuente(_ nuevo: CanalReproducible, origen: OrigenReproduccion) {
        canal = nuevo
        self.origen = origen
        motivoParada = nil
        mensaje = nil
        intento = nil
        estadisticas = nil
        arranco = false
        directo = .nada
        medio = .idle
        primeraImagenMs = nil
        reconexiones = 0
        protocolo = nil
        codec = nil
        colchonS = 0
        quiereReproducir = true
        puedeDeshacerDetencion = false
        ultimaDetencion = nil
        esperandoMotor = false
        cambiosDeFuente += 1
    }

    /// Para del todo y suelta la sesión (`stop('detenido')`). Se recuerda lo que sonaba para «Deshacer».
    public func detener() {
        guard let actual = canal else { return }
        ultimaDetencion = Detencion(canal: actual, lista: lista, origen: fuente?.origen ?? .usuario)
        puedeDeshacerDetencion = true
        terminarFuente(porque: "detenida")
        soltarSesion(.user)
        terminarConexion()
        fuente = nil
        transicion(.detener)
        quedarEnReposo(.usuario)
        sistema?.termino()
        contar(.parado(.usuario))
    }

    /// Reposo tras detener o un traspaso: sin canal y con el mensaje de la web.
    func quedarEnReposo(_ motivo: MotivoParada) {
        motivoParada = motivo
        mensaje = MotivoReposo.de(motivo, hayCanal: false)?.mensaje
        canal = nil
        origen = nil
        intento = nil
        medio = .idle
        quiereReproducir = false
        arranco = false
        estadisticas = nil
        protocolo = nil
        codec = nil
        sesionId = nil
        primeraImagenMs = nil
        directo = .nada
        colchonS = 0
        esperandoMotor = false
        tareaVigilante?.cancel()
        tareaVigilante = nil
    }

    /// Vuelve a poner lo que se acababa de detener (el «Deshacer» del mini). false si no había nada.
    @discardableResult
    public func deshacerDetencion() -> Bool {
        guard let detencion = ultimaDetencion, canal == nil else { return false }
        ultimaDetencion = nil
        puedeDeshacerDetencion = false
        reproducir(detencion.canal, origen: detencion.origen, lista: detencion.lista)
        return true
    }

    public func pausar() {
        guard canal != nil else { return }
        quiereReproducir = false
        tareaPausaAjena?.cancel()
        pausasPropias += 1
        motor.pausar()
        medio = conexion == .activa ? .pausado : medio
        sistema?.cambio(self)
    }

    public func reanudar() {
        guard canal != nil else { return }
        if conexion == .error {
            reintentar()
            return
        }
        guard conexion != .idle else { return }
        quiereReproducir = true
        motor.reproducir()
        sistema?.cambio(self)
    }

    /// Pausa y reanuda (`toggle`): con error reintenta; conectando no hace nada (un play ahora se saltaría el
    /// arranque).
    public func alternar() {
        switch conexion {
        case .error: reintentar()
        case .activa: quiereReproducir ? pausar() : reanudar()
        default: return
        }
    }

    /// Reintentar la misma fuente desde cero (`retry`: el toque sobre el error).
    public func reintentar() {
        guard var f = fuente else { return }
        f.reconexiones = []
        f.fallida = false
        fuente = f
        motivoParada = nil
        esperandoMotor = false
        quiereReproducir = true
        transicion(.solicitar)
        conectar(recuperacion: f.empezoEn != nil)
        arrancarVigilante()
        sistema?.cambio(self)
    }

    public func silenciar(_ silencio: Bool) {
        silenciado = silencio
        motor.silenciar(silencio)
    }

    /// Zapping (← → y la pantalla de bloqueo): háptica rigid, aviso «Zapping: <canal>» y el canal siguiente de
    /// la lista (`zapTarget`: si el actual no está, el primero; en bucle; nunca el mismo).
    public func cambiarCanal(_ paso: Int) {
        guard let destino = Self.destinoZapeo(lista, actual: canal?.id, paso: paso) else { return }
        vibrar?(.rigida)
        notificar(TextosReproductor.zapping(destino.titulo), icono: .tv)
        reproducir(destino, origen: .zapping)
        alZapear?(destino)
    }

    /// `zapTarget` (player/zapping.ts).
    nonisolated static func destinoZapeo(_ lista: [CanalReproducible], actual: String?, paso: Int)
        -> CanalReproducible?
    {
        let total: Int = lista.count
        guard total > 0 else { return nil }
        var siguiente: Int = 0
        if let actual, let indice: Int = lista.firstIndex(where: { (canal: CanalReproducible) -> Bool in canal.id == actual }) {
            let desplazado: Int = (indice + paso) % total
            siguiente = (desplazado + total) % total
        }
        let destino: CanalReproducible = lista[siguiente]
        return destino.id == actual ? nil : destino
    }

    /// Cambia el modo (Ajustes; lo guarda `PreferenciasLocales`). En iPhone no reconecta (P11): solo cambian
    /// el colchón y la distancia al directo. Toast «Modo «X» activado» (api.ts › setPlaybackMode).
    public func cambiarModo(_ nuevo: PlaybackMode) {
        guard nuevo != modo else { return }
        modo = nuevo
        motor.aplicar(perfil: nuevo.perfilIOS)
        notificar(TextosReproductor.modoActivado(nuevo.etiqueta), clase: .accion, tono: .ok)
    }

    /// La sesión de audio se interrumpió (llamada, Siri) o se desconectaron los auriculares.
    public func pausaDelSistema() {
        guard canal != nil else { return }
        pausar()
    }

    /// Terminó la interrupción y el sistema dice que se puede seguir.
    public func finDeInterrupcion(reanudar: Bool) {
        guard reanudar, canal != nil, conexion == .activa else { return }
        self.reanudar()
    }

    // MARK: Máquina

    @discardableResult
    func transicion(_ evento: EventoConexion) -> Bool {
        guard let nueva = MaquinaConexion.siguiente(conexion, evento) else {
            registro.debug(
                "Transición ignorada: \(self.conexion.rawValue, privacy: .public) + \(evento.rawValue, privacy: .public)")
            return false
        }
        conexion = nueva
        return true
    }
}

/// Pantalla de bloqueo, Centro de Control y sesión de audio.
@MainActor
public protocol ControlesDelSistema: AnyObject {
    func empezo(_ canal: CanalReproducible)
    func cambio(_ reproductor: Reproductor)
    func termino()
}
