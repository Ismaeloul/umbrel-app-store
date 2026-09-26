import Foundation
import Observation

/* La sesión de fuentes (b-arquitectura §2.6, I0→M3): apps/web/src/features/sources/session.ts entero. UNA sola
   sesión de vida de proceso (partido o canal suelto) con su política de cambio de fuente; si la fuente se cae
   con el mini sonando, pasa a la siguiente verificada igual (a7 §10, a4 §20):
   - Resuelve el partido (`football/resolve`, 20 s), guarda las candidatas en el orden del servidor y, con
     comprobador, espera a la primera verificada y la arranca (arranque automático). Sin comprobador, la mejor.
   - Sigue al comprobador por SSE (`scan.progress` / `scan.verdict`) y sin SSE sondea cada 1,5 s. Tres fallos
     seguidos: «El comprobador no responde; se muestran todas las fuentes».
   - POLÍTICA ÚNICA DE CAMBIO DE FUENTE: mientras la persona no elige nada, si la fuente se cae (3 reconexiones;
     1 antes de la primera imagen) se pasa a la siguiente verificada que no se haya probado. En cuanto elige una
     (o pega un hash), todo es manual: nunca se salta sola. Salto de entrada tras «Encontrar canal».
   - Detener (o el traspaso) apaga todo el automatismo; la lista se queda. Reproducir algo que no está en la
     lista (zapping, biblioteca) termina la sesión.
   - Canal suelto: «Otras fuentes» = las hermanas de la biblioteca (`librarySiblings`, §0.0 punto 1); nunca
     salta sola.
   El identificador de fuente es opaco (se compara tal cual): un tipo de fuente nuevo del servidor entra en el
   mismo orden y en el mismo cambio automático sin tocar nada. */

/// Lo que la sesión de fuentes necesita de la app (lo conforma `ContenedorApp`; los tests pasan un doble).
@MainActor protocol EntornoSesionFuentes: AnyObject {
    var api: APIClient { get }
    var reproductor: Reproductor { get }
    var avisos: Avisos { get }
    var haptica: Haptica { get }
    var hojas: CentroHojas { get }
    var reloj: any Reloj { get }
    var visor: String { get }
    var tiempoRealAbierto: Bool { get }
    /// La biblioteca: hermanas del canal suelto, nombres de las listas y lo que devuelve Recientes (M3, aditivo).
    var datos: DatosApp { get }
}

enum FaseSesionFuentes: Sendable { case reposo, resolviendo, lista, opciones, noEncontrado, sinCanales }

/// `kind` de la sesión.
enum TipoSesionFuentes: Sendable { case partido, canal }

/// Errores de las acciones con texto de campo (pegar, vincular).
enum ErrorFuentes: Error, Sendable, Equatable {
    case hashNoValido

    var mensaje: String { ReglasFuentes.textoHashNoValido }
}

@MainActor @Observable final class SesionFuentes {
    private(set) var clave: String?  // "partido:<id>" · "canal:<hash>"
    private(set) var fase: FaseSesionFuentes = .reposo
    private(set) var entradas: [EntradaFuente] = []
    private(set) var activa: String?
    /// El último trabajo del comprobador que llegó entero.
    private(set) var trabajo: ScanJob?
    private(set) var resolucion: Resolution?
    /// Arranque por verificadas activo (`autoVerified`).
    private(set) var automatico = false
    private(set) var eleccionManual = false
    private(set) var rebuscando = false
    private(set) var detenida = false
    private(set) var textoFallo: String?
    private(set) var textoEspera: String?
    /// `textoEspera` para `EntornoVideo.foto`: leído desde fuera a través del macro de `@Observable` tardaba más de
    /// 200 ms en tiparse en la CI.
    var esperaParaFoto: String? { textoEspera }
    /// Sin uso desde §0.0 punto 1: «Otras fuentes» del canal suelto son `entradas` (las hermanas de la biblioteca).
    private(set) var otrasSenales: [ResolutionCandidate] = []
    private(set) var buscandoOtras = false

    // Lo demás de `SessionState` (session.ts).
    private(set) var tipo: TipoSesionFuentes?
    private(set) var partido: FootballMatch?
    /// Nombre del canal (canal suelto).
    private(set) var tituloCanal = ""
    /// El trabajo del comprobador tal como lo guarda la web (`scan`).
    private(set) var comprobador: EstadoComprobador?
    private(set) var precalentado: PreheatPublic?
    /// Salto de entrada armado (`switchArmed`).
    private(set) var saltoArmado = false
    /// La hoja «Encontrar canal» tiene que estar abierta (`resolverOpen`).
    private(set) var resolverAbierto = false

    @ObservationIgnored private weak var entorno: (any EntornoSesionFuentes)?
    /// Sondeo del comprobador sin SSE (SCAN_POLL_MS); los tests lo acortan.
    @ObservationIgnored var intervaloSondeo: Duration = .milliseconds(1500)
    @ObservationIgnored private var generacion = 0
    @ObservationIgnored private var tareaResolver: Task<Void, Never>?
    @ObservationIgnored private var seguimiento: SeguimientoTrabajo?
    @ObservationIgnored private var fallosComprobador = 0
    @ObservationIgnored private var reportesSeguidos: [String: ReporteSeguido] = [:]
    @ObservationIgnored private var rebusqueda: (antes: Set<String>, ia: Bool)?
    @ObservationIgnored private var vistaAbierta = false

    /// Plazos de la resolución (RESOLVE_TIMEOUT_MS / RESEARCH_TIMEOUT_MS): 20 s al entrar, 30 s al rebuscar.
    static let plazoResolver: TimeInterval = 20
    static let plazoRebuscar: TimeInterval = 30
    /// SCAN_MAX_FAILURES, REPORT_MAX_POLLS y REPORT_MAX_WAIT_MS.
    static let fallosMaximos = 3
    static let consultasReporte = 32
    static let esperaMaximaReporte: TimeInterval = 31 * 60

    init() {}

    /// Dos fases: el contenedor se crea y luego se presenta (evita el ciclo en el init). Los tests pasan un doble.
    /// Engancha al reproductor: sus sucesos (`onPlayerChange`), sus avisos, su háptica y Recientes.
    func conectar(_ entorno: any EntornoSesionFuentes) {
        // Una sola vez por entorno: otra llamada añadiría otro oyente y duplicaría los sucesos.
        if let actual = self.entorno, actual === entorno { return }
        self.entorno = entorno
        let reproductor = entorno.reproductor
        reproductor.escuchar { [weak self] suceso in self?.alSuceso(suceso) }
        reproductor.avisar = { [weak entorno] aviso in
            _ = entorno?.avisos.avisar(
                aviso.texto, clase: aviso.clase, tono: aviso.tono, icono: aviso.icono, senal: aviso.senal)
        }
        reproductor.vibrar = { [weak entorno] tipo in entorno?.haptica.disparar(tipo) }
        reproductor.alGuardarReciente = { [weak entorno] biblioteca in entorno?.datos.biblioteca.escribir(biblioteca) }
        // La lista de zapping sale de la biblioteca al momento (`zappingList`): ‹ ›, ← → y la pantalla de bloqueo.
        reproductor.listaViva = { [weak entorno] in Self.listaZapping(entorno?.datos.biblioteca.datos) }
    }

    /// `zappingList` (M5) como canales para el reproductor (favoritos y directorio declaran su tipo).
    static func listaZapping(_ biblioteca: LibraryView?) -> [CanalReproducible] {
        Zapping.lista(biblioteca).map { (item: CanalZapping) -> CanalReproducible in
            CanalReproducible(id: item.id, titulo: item.titulo, ih: item.ih ?? false)  // kindFromIh(ih ?? false)
        }
    }

    // MARK: Lo que se lee

    var enPartido: Bool { tipo == .partido }
    var conComprobador: Bool { comprobador != nil }
    var terminado: Bool { ReglasFuentes.comprobadorTerminado(comprobador) }

    /// Los canales anunciados del partido (`matchInfoOf`: los nombres, sin vacíos).
    var canales: [String] { partido?.channels.map(\.name).filter { !$0.isEmpty } ?? [] }

    private var ahora: Date { entorno?.reloj.ahora ?? .distantPast }
    private var pantalla: EnPantalla { entorno?.reproductor.enPantalla ?? .nada }
    private var listas: [WebSourceSummary] { entorno?.datos.biblioteca.datos?.webSources ?? [] }

    /// Cada fuente con su número, estado, medidor, frase y si está en pantalla (useSources.ts).
    func filas(ahora: Date) -> [FilaFuente] {
        ReglasFuentes.filas(
            entradas, pantalla: pantalla, ahora: ahora, activa: activa, listas: listas, conComprobador: conComprobador)
    }

    /// Las que se ven (regla 22): con comprobador, la activa, las vivas y las iniciales sin probar.
    func filasVisibles(ahora: Date) -> [FilaFuente] {
        let todas = filas(ahora: ahora)
        guard conComprobador else { return todas }
        return todas.filter { ReglasFuentes.visibleMientrasComprueba($0.entrada, efectivo: $0.efectivo, activa: activa) }
    }

    /// Las demás (caídas o en cola), plegadas al final («Ver n más…»).
    func filasPlegadas(ahora: Date) -> [FilaFuente] {
        let visibles = Set(filasVisibles(ahora: ahora).map(\.id))
        return filas(ahora: ahora).filter { !visibles.contains($0.id) }
    }

    var visibles: [EntradaFuente] { filasVisibles(ahora: ahora).map(\.entrada) }
    var plegadas: [EntradaFuente] { filasPlegadas(ahora: ahora).map(\.entrada) }

    var progreso: Double { ReglasFuentes.progreso(comprobador, entradas: entradas.count) }

    func textoProgreso(ahora: Date) -> String {
        let efectivos = ReglasFuentes.efectivos(entradas, pantalla: pantalla, ahora: ahora)
        return ReglasFuentes.textoProgreso(comprobador, entradas: entradas, efectivos: efectivos, precalentado: precalentado)
    }

    /// El canal por el que se pregunta en «Encontrar canal» (`resolverChannel`).
    var tituloResolver: String {
        if let primero = resolucion?.channels.first, !primero.isEmpty { return primero }
        return canales.first ?? TextosReproductor.canalPorConfirmar
    }

    private func numero(_ id: String) -> Int { (entradas.firstIndex { $0.id == id } ?? -1) + 1 }

    /// `matchChannelFor`: con el que casó la fuente, si es de este partido; si no, el primero (o el del canal).
    private func canalDelPartido(_ entrada: EntradaFuente?) -> String {
        if let canal = entrada?.canal, !canal.isEmpty, canales.contains(canal) { return canal }
        return canales.first ?? tituloCanal
    }

    /// `belongsOnScreen`: suena o se conecta una fuente de esta sesión.
    private func perteneceAPantalla(_ p: EnPantalla) -> Bool {
        guard let id = p.id, p.sonando || p.conectando else { return false }
        return entradas.contains { $0.id == id }
    }

    /// `setWaitingMessage`: lo que dice el vídeo mientras se espera una fuente.
    private func fijarEspera(_ texto: String?) {
        if textoEspera != texto { textoEspera = texto }
        entorno?.reproductor.fijarEspera(texto)
    }

    private func toast(_ texto: String, tono: TonoAviso = .info, icono: NombreIcono? = nil, accion: AccionAviso? = nil) {
        entorno?.avisos.avisar(texto, tono: tono, icono: icono, accion: accion)
    }

    private func senal(_ texto: String, tono: TonoAviso = .info, icono: NombreIcono? = nil, senal: EstadoSenal? = nil) {
        entorno?.avisos.avisar(texto, clase: .senal, tono: tono, icono: icono, senal: senal)
    }

    // MARK: Empezar y terminar

    /// `endSession`: otro partido, otro canal o algo que no es de la sesión.
    func terminarSesion() {
        generacion += 1
        tareaResolver?.cancel()
        tareaResolver = nil
        pararSeguimientos()
        if clave != nil { fijarEspera(nil) }
        clave = nil
        tipo = nil
        partido = nil
        tituloCanal = ""
        fase = .reposo
        resolucion = nil
        entradas = []
        activa = nil
        trabajo = nil
        comprobador = nil
        precalentado = nil
        automatico = false
        saltoArmado = false
        eleccionManual = false
        rebuscando = false
        detenida = false
        textoFallo = nil
        resolverAbierto = false
    }

    private func empezar(clave nueva: String, tipo: TipoSesionFuentes) {
        terminarSesion()
        clave = nueva
        self.tipo = tipo
    }

    private func pararSeguimientos() {
        seguimiento?.parar()
        seguimiento = nil
        for reporte in reportesSeguidos.values { reporte.parar() }
        reportesSeguidos = [:]
        rebusqueda = nil
        fallosComprobador = 0
    }

    /// `leaveSession`: la vista se va. Si de esta sesión no suena nada, se apaga el automatismo (arrancar un vídeo
    /// con la persona en otra pantalla sería una sorpresa); si suena (mini), sigue vivo.
    func salirVista() {
        vistaAbierta = false
        guard clave != nil, !perteneceAPantalla(pantalla) else { return }
        tareaResolver?.cancel()
        seguimiento?.parar()
        seguimiento = nil
        fijarEspera(nil)
        automatico = false
        saltoArmado = false
        if fase == .resolviendo { fase = .reposo }
    }

    // MARK: Entrar a un partido

    /// `enterMatch`: idempotente mientras la sesión de ese partido siga viva (resolviendo, sonando, detenida
    /// con fuentes o con elección manual): solo refresca los datos del partido.
    func entrarPartido(_ partido: FootballMatch) async {
        vistaAbierta = true
        let nueva = "partido:\(partido.id)"
        if clave == nueva {
            let viva =
                fase == .resolviendo || perteneceAPantalla(pantalla) || (detenida && !entradas.isEmpty)
                || eleccionManual
            if viva {
                self.partido = partido
                if resolverAbierto { entorno?.hojas.abrir(.encontrarCanal) }
                return
            }
        }
        empezar(clave: nueva, tipo: .partido)
        self.partido = partido
        if canales.isEmpty {
            fase = .sinCanales
            toast(TextosReproductor.canalSinAnunciar, tono: .warn, icono: .tv)
            return
        }
        await resolverPartido()
    }

    private func resolverPartido() async {
        guard let entorno, let partido else { return }
        let gen = generacion
        let canales = self.canales
        tareaResolver?.cancel()
        fase = .resolviendo
        textoFallo = nil
        let p = pantalla
        if !perteneceAPantalla(p) && p.id == nil { fijarEspera(TextosReproductor.buscandoFuentes) }
        var peticion = API.resolver(partido: partido.id, canales: canales, cliente: entorno.visor)
        peticion.plazo = Self.plazoResolver
        let api = entorno.api
        let tarea = Task { [weak self] in
            do {
                let datos = try await api.enviar(peticion)
                guard let self, gen == self.generacion, !Task.isCancelled else { return }
                self.aplicarResolucionDeEntrada(datos)
            } catch {
                guard let self, gen == self.generacion, !Task.isCancelled else { return }
                if case .cancelado = APIError.desde(error) { return }
                self.resolucionFallida(canales)
            }
        }
        tareaResolver = tarea
        await tarea.value
    }

    /// Error de red: la misma hoja, como «no encontrado» y sin buscador.
    private func resolucionFallida(_ canales: [String]) {
        fijarEspera(nil)
        fase = .noEncontrado
        resolucion = Resolution(
            status: .notFound, channels: canales, checked: ["saved", "m3u", "library", "acestream"], candidate: nil,
            candidates: [], engineAvailable: false,
            ai: AiInfo(enabled: false, used: false, model: nil, catalogSize: 0, error: nil), program: nil,
            research: false, preheated: nil, preheat: nil, scan: nil)
        abrirResolver()
    }

    private func aplicarResolucionDeEntrada(_ datos: Resolution) {
        guard datos.status == .found, let mejor = datos.candidate else {
            fijarEspera(nil)
            fase = datos.status == .choices ? .opciones : .noEncontrado
            resolucion = datos
            precalentado = datos.preheat
            abrirResolver()
            return
        }
        let lista = datos.candidates.isEmpty ? [mejor] : datos.candidates
        let momento = ahora
        let nuevas = ReglasFuentes.sinDuplicados(lista.map { EntradaFuente($0, ahora: momento) })
        let enPantalla = pantalla.id
        let sonando = nuevas.contains { $0.id == enPantalla } ? enPantalla : nil
        fase = .lista
        resolucion = datos
        precalentado = datos.preheat
        entradas = nuevas
        activa = sonando
        if let scan = datos.scan { configurarComprobador(scan) }
        if sonando != nil {
            // Ya suena una fuente de este partido (se volvió a la vista): nada que arrancar.
            fijarEspera(nil)
            return
        }
        if datos.scan != nil {
            automatico = true
            fijarEspera(TextosReproductor.comprobandoFuentes(entradas.count))
            intentarArranqueAutomatico()
            return
        }
        // Sin comprobador: la mejor colocada.
        fijarEspera(nil)
        if let elegida = entradas.first(where: { $0.id == mejor.id }) ?? entradas.first {
            reproducirEntrada(elegida, origen: .usuario)
        }
    }

    // MARK: Canal suelto

    /// `enterChannel`: sus hermanas del mismo canal (regla 23) y, si nada suena todavía, lo reproduce. Tras un
    /// «Detener» no lo relanza. Volver a entrar con la biblioteca cambiada rehace las hermanas conservando lo visto.
    func entrarCanal(_ canal: RefCanal, listaActiva: String?) async {
        vistaAbierta = true
        let biblioteca = entorno?.datos.biblioteca.datos
        let lista = listaActiva ?? biblioteca?.activeWebSourceId
        let hermanas = ReglasFuentes.hermanas(biblioteca, id: canal.hash)
        let nuevas =
            hermanas.count > 1 ? ReglasFuentes.sinDuplicados(hermanas.map { EntradaFuente($0, listaActiva: lista) }) : []
        let nueva = "canal:\(canal.hash)"
        if clave == nueva {
            if !canal.titulo.isEmpty { tituloCanal = canal.titulo }
            entradas = conservarLoVisto(nuevas)
            return
        }
        // Un canal que ya es fuente de la sesión de canal actual (volver del mini tras elegir una hermana).
        if tipo == .canal && entradas.contains(where: { $0.id == canal.hash }) {
            if !canal.titulo.isEmpty { tituloCanal = canal.titulo }
            return
        }
        empezar(clave: nueva, tipo: .canal)
        tituloCanal = canal.titulo
        entradas = nuevas
        activa = canal.hash
        fase = .lista
        guard let reproductor = entorno?.reproductor else { return }
        let enReposo = reproductor.fase == .idle || reproductor.fase == .error
        let desdeElInicio = reproductor.reposo == .inicio || reproductor.reposo == nil
        guard reproductor.canal?.id != canal.hash, enReposo, desdeElInicio else { return }
        let titulo = canal.titulo.isEmpty ? TextosReproductor.canal(canal.hash) : canal.titulo
        reproductor.reproducir(CanalReproducible(id: canal.hash, titulo: titulo), origen: .biblioteca)
    }

    private func conservarLoVisto(_ nuevas: [EntradaFuente]) -> [EntradaFuente] {
        var previas: [String: EntradaFuente] = [:]
        for entrada in entradas { previas[entrada.id] = entrada }
        return nuevas.map { entrada in
            guard let vieja = previas[entrada.id] else { return entrada }
            var mezcla = entrada
            mezcla.veredicto = vieja.veredicto
            mezcla.reportadaHasta = vieja.reportadaHasta
            mezcla.motivoReporte = vieja.motivoReporte
            return mezcla
        }
    }

    // MARK: Comprobador

    private func vigilar(_ id: String) -> SeguimientoTrabajo? {
        guard let entorno else { return nil }
        let api = entorno.api
        return SeguimientoTrabajo(
            id: id, intervalo: intervaloSondeo, pedir: { try await api.enviar(API.comprobacion(id: id)) },
            sseAbierto: { [weak entorno] in entorno?.tiempoRealAbierto ?? false })
    }

    private func configurarComprobador(_ ref: ScanRef) {
        seguimiento?.parar()
        fallosComprobador = 0
        entradas = ReglasFuentes.empezarComprobacion(entradas, inicial: ref.initialCount)
        comprobador = EstadoComprobador(
            id: ref.id, estado: .queued, total: max(ref.total, entradas.count), comprobadas: 0, jugables: 0,
            reintentoEn: nil)
        let gen = generacion
        let id = ref.id
        guard let nuevo = vigilar(id) else { return }
        nuevo.alTrabajo = { [weak self] trabajo in
            guard let self, gen == self.generacion, self.comprobador?.id == id else { return }
            self.alTrabajoPrincipal(trabajo)
        }
        nuevo.alError = { [weak self] in
            guard let self, gen == self.generacion, self.comprobador?.id == id else { return }
            self.alErrorComprobador()
        }
        nuevo.alVeredicto = { [weak self] veredicto in
            guard let self, gen == self.generacion else { return }
            self.entradas = ReglasFuentes.aplicarVeredicto(self.entradas, veredicto)
            self.trasCambioComprobador()
        }
        seguimiento = nuevo
        nuevo.empezar()
    }

    private func alTrabajoPrincipal(_ job: ScanJob) {
        if job.status == .cancelled {
            alErrorComprobador()
            return
        }
        fallosComprobador = 0
        trabajo = job
        entradas = ReglasFuentes.aplicarComprobacion(entradas, candidatos: job.candidates)
        comprobador = EstadoComprobador(
            id: job.id, estado: job.status, total: max(job.total, entradas.count), comprobadas: job.checked,
            jugables: job.playable, reintentoEn: job.retryAt)
        if job.status == .complete {
            seguimiento?.parar()
            seguimiento = nil
        }
        if job.status == .complete || job.status == .waiting { anunciarRebusqueda() }
        trasCambioComprobador()
    }

    private func alErrorComprobador() {
        fallosComprobador += 1
        guard fallosComprobador >= Self.fallosMaximos else { return }
        seguimiento?.parar()
        seguimiento = nil
        entradas = ReglasFuentes.olvidarComprobacion(entradas)
        comprobador = nil
        automatico = false
        saltoArmado = false
        toast(TextosReproductor.comprobadorNoResponde, tono: .warn, icono: .aviso)
        // Sin comprobador y sin nada en pantalla: la mejor colocada, como si no hubiera comprobador.
        guard tipo == .partido, !eleccionManual, !detenida, !perteneceAPantalla(pantalla) else { return }
        let momento = ahora
        let mejor = entradas.first { !ReglasFuentes.reportada($0, ahora: momento) }
        fijarEspera(nil)
        if let mejor { reproducirEntrada(mejor, origen: .usuario) }
    }

    private func trasCambioComprobador() {
        if intentarArranqueAutomatico() { return }
        quizaSaltoInicial()
    }

    /// `tryAutoStart`: arranca la primera verificada. true si ha mandado reproducir algo.
    @discardableResult
    private func intentarArranqueAutomatico() -> Bool {
        guard automatico, !detenida, tipo == .partido else { return false }
        let p = pantalla
        if perteneceAPantalla(p) { return false }
        let efectivos = ReglasFuentes.efectivos(entradas, pantalla: p, ahora: ahora)
        let total = entradas.count
        if let elegida = ReglasFuentes.elegirAutomatica(entradas, efectivos: efectivos, terminado: terminado) {
            let n = numero(elegida.id)
            let verificada = efectivos[elegida.id]?.estado == .working
            senal(
                verificada ? TextosReproductor.verificadaArrancando(n) : TextosReproductor.probamosFloja(n), icono: .tv,
                senal: verificada ? .ok : .weak)
            fijarEspera(nil)
            marcarProbada(elegida.id)
            reproducirEntrada(elegida, origen: .automatico)
            return true
        }
        if terminado {
            if comprobador?.estado == .waiting && total > 0 {
                fijarEspera(TextosReproductor.enReposo(total, hora: ReglasFuentes.horaMadrid(comprobador?.reintentoEn)))
                return false
            }
            let texto = total > 0 ? TextosReproductor.ningunaDaSenal(total) : TextosReproductor.sinFuentesAhora
            automatico = false
            textoFallo = texto
            fijarEspera(nil)
            senal(texto, tono: .err, senal: .fail)
            return false
        }
        let comprobadas = comprobador?.comprobadas ?? 0
        fijarEspera(
            comprobadas > 0
                ? TextosReproductor.comprobandoProgreso(comprobadas, de: comprobador?.total ?? total)
                : TextosReproductor.comprobandoFuentes(total))
        return false
    }

    private func marcarProbada(_ id: String) {
        guard let i = entradas.firstIndex(where: { $0.id == id }) else { return }
        entradas[i].probadaAuto = true
    }

    /// `maybeInitialSwitch`: la elegida en «Encontrar canal» sale fallida y no se está viendo → la primera viva.
    private func quizaSaltoInicial() {
        guard saltoArmado, !detenida,
            let siguiente = ReglasFuentes.elegirSaltoInicial(entradas, activa: activa, pantalla: pantalla, ahora: ahora)
        else { return }
        saltoArmado = false
        entorno?.haptica.disparar(.aviso)
        senal(TextosReproductor.saltoInicial(numero(siguiente.id)), icono: .tv)
        reproducirEntrada(siguiente, origen: .automatico)
    }

    private func anunciarRebusqueda() {
        guard let vigilada = rebusqueda else { return }
        rebusqueda = nil
        let p = pantalla
        let momento = ahora
        let nuevas = entradas.filter { entrada in
            let efectivo = ReglasFuentes.efectivo(entrada, pantalla: p, ahora: momento)
            let visible =
                comprobador == nil || ReglasFuentes.visibleMientrasComprueba(entrada, efectivo: efectivo, activa: activa)
            return !vigilada.antes.contains(entrada.id) && efectivo.estado != .failed && visible
        }.count
        toast(TextosReproductor.rebusquedaTerminada(nuevas, ia: vigilada.ia), tono: .ok, icono: .refresh)
    }

    // MARK: Reproducir

    /// `channelTitleFor`: el nombre del canal para el reproductor (el título sin el proveedor).
    private func tituloPara(_ entrada: EntradaFuente) -> String {
        if tipo == .canal { return entrada.titulo }
        let parte = ReglasFuentes.parteCanal(entrada.titulo)
        if !parte.isEmpty { return parte }
        if !entrada.canal.isEmpty { return entrada.canal }
        return canales.first ?? entrada.titulo
    }

    /// `leadFor`: «Fuente 1 verificada.» / «Fuente 1, señal floja.» / «Fuente 1.» (solo en partidos).
    private func lead(_ n: Int, _ efectivo: Efectivo) -> String? {
        guard tipo == .partido else { return nil }
        if efectivo.estado == .working && !efectivo.reportada { return "Fuente \(n) verificada." }
        if efectivo.estado == .weak { return "Fuente \(n), señal floja." }
        return "Fuente \(n)."
    }

    /// `playEntry`.
    private func reproducirEntrada(_ entrada: EntradaFuente, origen: OrigenReproduccion) {
        guard let reproductor = entorno?.reproductor else { return }
        let n = numero(entrada.id)
        let presentacion = ReglasFuentes.presentacion(entrada, listas: listas)
        let efectivo = ReglasFuentes.efectivo(entrada, pantalla: pantalla, ahora: ahora)
        var canal = CanalReproducible(
            id: entrada.id, titulo: tituloPara(entrada), ih: entrada.ih, partido: contexto(entrada),
            listaId: entrada.listaId, origen: entrada.origen)
        if tipo == .partido {
            canal.subtitulo = "Fuente \(n), \(presentacion.corto)"
        } else if entradas.count > 1 {
            canal.subtitulo = "Fuente \(n) de \(entradas.count)"
        }
        canal.lead = lead(n, efectivo)
        canal.fuente = String(presentacion.corto.prefix(60))
        reproductor.reproducir(canal, origen: origen)
        activa = entrada.id
        detenida = false
        textoFallo = nil
    }

    private func contexto(_ entrada: EntradaFuente) -> ContextoPartido? {
        guard tipo == .partido, let partido else { return nil }
        return ContextoPartido(
            id: partido.id, titulo: partido.title, competicion: partido.competition, canal: canalDelPartido(entrada))
    }

    // MARK: Lo que hace el reproductor (onPlayerChange)

    private func alSuceso(_ suceso: SucesoReproductor) {
        guard clave != nil else { return }
        switch suceso {
        case .parado:
            // Detener (o el traspaso): se apaga todo lo automático (regla 17); la lista se queda.
            pararSeguimientos()
            fijarEspera(nil)
            detenida = true
            automatico = false
            saltoArmado = false
        case .empezo(let canal):
            // Suena otra cosa que no es de esta sesión (zapping, biblioteca): se acaba.
            guard entradas.contains(where: { $0.id == canal.id }) else {
                if tipo == .canal && clave == "canal:\(canal.id)" { return }
                terminarSesion()
                return
            }
            if activa != canal.id { activa = canal.id }
        case .arranco(let canal):
            // Primera imagen: el reproductor la da por buena (manda 3 min) y el salto de entrada se apaga.
            guard let i = entradas.firstIndex(where: { $0.id == canal.id }) else { return }
            entradas[i].veredicto = VeredictoReproductor(estado: .working, motivo: "player_ok", fecha: ahora)
            if activa != canal.id { activa = canal.id }
            saltoArmado = false
            textoFallo = nil
        }
    }

    /// `handleSourceFailed`: la fuente agotó sus reconexiones. En automático, la siguiente verificada; en manual,
    /// nunca: se dice cuántas quedan. true si ya ha puesto otra a sonar; si no, deja el texto para el reproductor.
    func alFallarFuente(_ fallo: FalloFuente) -> Bool {
        guard clave != nil, let i = entradas.firstIndex(where: { $0.id == fallo.canal.id }) else { return false }
        let (estado, motivo) = ReglasFuentes.veredictoFallo(fallo.resultado, segundos: fallo.segundos)
        entradas[i].veredicto = VeredictoReproductor(estado: estado, motivo: motivo, fecha: ahora)
        let efectivos = ReglasFuentes.efectivos(entradas, pantalla: .nada, ahora: ahora)
        if automatico && !detenida && tipo == .partido {
            if let siguiente = ReglasFuentes.elegirAutomatica(entradas, efectivos: efectivos, terminado: terminado) {
                // Cambio automático de fuente: un aviso háptico, nunca la única señal.
                entorno?.haptica.disparar(.aviso)
                marcarProbada(siguiente.id)
                reproducirEntrada(siguiente, origen: .automatico)
                return true
            }
            if !terminado {
                responder(TextosReproductor.sigoComprobando)
                return false
            }
            let texto = TextosReproductor.ningunaDaSenal(entradas.count)
            automatico = false
            textoFallo = texto
            responder(texto)
            return false
        }
        entorno?.haptica.disparar(.error)
        let otras = entradas.enumerated().filter { j, entrada in
            j != i && efectivos[entrada.id]?.reportada != true && efectivos[entrada.id]?.estado != .failed
        }.count
        let esPartido = tipo == .partido
        responder(
            otras > 0
                ? TextosReproductor.manualConOtras(otras, partido: esPartido)
                : TextosReproductor.manualSinOtras(partido: esPartido))
        return false
    }

    private func responder(_ texto: String) { entorno?.reproductor.textoFalloPendiente = texto }

    /// Eventos del backend: el progreso y los veredictos del comprobador (y los de los reportes seguidos).
    func procesar(_ evento: SSEEvent) {
        seguimiento?.procesar(evento)
        for reporte in reportesSeguidos.values { reporte.seguimiento?.procesar(evento) }
    }

    // MARK: Acciones de la persona

    /// `selectSource`: elegir a mano. Desde aquí todo es manual (ya nunca salta sola).
    func elegir(_ hash: String) {
        guard let entrada = entradas.first(where: { $0.id == hash }) else { return }
        let p = pantalla
        // Pulsar la activa mientras suena no hace nada.
        if p.id == hash && (p.sonando || p.conectando) { return }
        automatico = false
        saltoArmado = false
        eleccionManual = true
        fijarEspera(nil)
        let presentacion = ReglasFuentes.presentacion(entrada, listas: listas)
        senal(TextosReproductor.eleccion(presentacion.etiqueta, id: hash), icono: .tv)
        reproducirEntrada(entrada, origen: .usuario)
    }

    /// `stepSource`: la siguiente (+1) o la anterior (−1) de las que se ven, en bucle (‹ › y deslizar el vídeo).
    func paso(_ delta: Int) {
        let ids = visibles.map(\.id)
        guard !ids.isEmpty, delta != 0 else { return }
        let direccion = delta > 0 ? 1 : -1
        let actual = activa.flatMap { ids.firstIndex(of: $0) }
        let indice = actual.map { ($0 + direccion + ids.count) % ids.count } ?? (direccion > 0 ? 0 : ids.count - 1)
        let id = ids[indice]
        if id != activa { elegir(id) }
    }

    /// `addManualSource`: «Pegar hash» en el partido. Si ya estaba, cambia a ella; si no, se añade al final como
    /// fuente «Externa». Todo pasa a manual.
    func pegar(_ texto: String) async throws {
        guard let hash = ReglasFuentes.normalizarHash(texto) else { throw ErrorFuentes.hashNoValido }
        let delReproductor = entorno?.reproductor.canal?.titulo ?? ""
        let titulo =
            [canales.first ?? "", delReproductor, tituloCanal].first { !$0.isEmpty } ?? TextosReproductor.stream(hash)
        let existia = entradas.contains { $0.id == hash }
        if !existia { entradas.append(.manual(id: hash, titulo: titulo, canal: canales.first ?? "")) }
        automatico = false
        saltoArmado = false
        eleccionManual = true
        cerrarHojaDePegar()
        if let actual = comprobador { comprobador?.total = max(actual.total, entradas.count) }
        fijarEspera(nil)
        if let entrada = entradas.first(where: { $0.id == hash }) { reproducirEntrada(entrada, origen: .usuario) }
        entorno?.haptica.disparar(.exito)
        toast(existia ? TextosReproductor.hashSeleccionado : TextosReproductor.hashAnadido, tono: .ok, icono: .play)
    }

    /// «Rebuscar» (`research`).
    func rebuscar() async {
        guard !rebuscando, let entorno else { return }
        guard tipo == .partido, let partido, !canales.isEmpty else {
            toast(TextosReproductor.rebuscarSinCanales, tono: .warn, icono: .aviso)
            return
        }
        let p = pantalla
        let momento = ahora
        let actualId = activa ?? p.id
        let actual = entradas.first { $0.id == actualId }
        let previas = Set(entradas.map(\.id))
        let efectivos = ReglasFuentes.efectivos(entradas, pantalla: p, ahora: momento)
        let antes = Set(
            entradas.filter { entrada in
                guard comprobador != nil, let efectivo = efectivos[entrada.id] else { return true }
                return ReglasFuentes.visibleMientrasComprueba(entrada, efectivo: efectivo, activa: activa)
            }.map(\.id))
        let gen = generacion
        rebusqueda = nil
        rebuscando = true
        defer { if gen == generacion { rebuscando = false } }
        var peticion = API.resolver(
            partido: partido.id, canales: canales, rebuscar: true, actual: actualId,
            actualEsInfohash: actual?.ih == true, cliente: entorno.visor)
        if actualId != nil && actual?.ih != true { peticion.query.append(QueryParam("currentIh", "0")) }
        peticion.plazo = Self.plazoRebuscar
        do {
            let datos = try await entorno.api.enviar(peticion)
            guard gen == generacion else { return }
            aplicarRebusqueda(datos, actual: actual, previas: previas, antes: antes)
        } catch {
            guard gen == generacion else { return }
            let convertido = APIError.desde(error)
            if case .cancelado = convertido { return }
            var porPlazo = false
            if case .red(let codigo) = convertido, codigo == .timedOut { porPlazo = true }
            toast(porPlazo ? TextosReproductor.rebuscarPlazo : TextosReproductor.rebuscarFallo, tono: .err, icono: .aviso)
        }
    }

    private func aplicarRebusqueda(_ datos: Resolution, actual: EntradaFuente?, previas: Set<String>, antes: Set<String>) {
        let frescas = datos.candidates.isEmpty ? (datos.candidate.map { [$0] } ?? []) : datos.candidates
        guard !frescas.isEmpty else {
            toast(TextosReproductor.rebuscarSinNovedades, tono: .warn, icono: .buscar)
            return
        }
        var vistas: [String: EntradaFuente] = [:]
        for entrada in entradas { vistas[entrada.id] = entrada }
        let momento = ahora
        var juntas = ReglasFuentes.sinDuplicados(
            frescas.map { candidata in
                var entrada = EntradaFuente(candidata, ahora: momento)
                // Lo que vio el reproductor sigue valiendo sus 3 minutos.
                if let vista = vistas[entrada.id] {
                    entrada.veredicto = vista.veredicto
                    entrada.probadaAuto = vista.probadaAuto
                }
                return entrada
            })
        if let actual, !juntas.contains(where: { $0.id == actual.id }) {
            var conservada = actual
            conservada.sonda = nil
            conservada.inicial = false
            juntas.append(conservada)
        }
        let nuevas = frescas.filter { !previas.contains($0.id) }.count
        // Si nada suena y la persona no ha elegido nada, lo nuevo puede arrancar solo (regla 19).
        let rearmar = !eleccionManual && !detenida && !perteneceAPantalla(pantalla)
        entradas = juntas
        precalentado = nil
        saltoArmado = false
        automatico = rearmar
        textoFallo = nil
        comprobador = nil
        seguimiento?.parar()
        seguimiento = nil
        if let scan = datos.scan { configurarComprobador(scan) }
        let ia = datos.ai.used
        rebusqueda = (antes, ia)
        toast(TextosReproductor.rebusqueda(juntas.count, nuevas: nuevas, ia: ia), icono: .refresh)
        if datos.scan == nil { anunciarRebusqueda() }
        if rearmar { trasCambioComprobador() }
    }

    /// «Reportar y comprobar» (`reportSource`): cuarentena hasta la fecha del servidor (o 30 min); NO cambia de
    /// fuente sola: si era la activa, ofrece «Ver la N». Lanza si no se pudo enviar (la hoja sigue abierta).
    func reportar(_ hash: String, motivo: SourceReportReason) async throws {
        guard let entorno, let entrada = entradas.first(where: { $0.id == hash }) else { return }
        let presentacion = ReglasFuentes.presentacion(entrada, listas: listas)
        let canal = canalDelPartido(entrada)
        let proveedor = presentacion.corto.isEmpty ? presentacion.tipo : presentacion.corto
        let cuerpo = ReportBody(
            id: entrada.id, reason: motivo, channel: canal.isEmpty ? nil : String(canal.prefix(200)),
            matchId: partido?.id, title: String(entrada.titulo.prefix(200)), source: String(proveedor.prefix(60)),
            ih: entrada.ih == true)
        let gen = generacion
        let respuesta: ReportResponse
        do {
            respuesta = try await entorno.api.enviar(API.reportarFuente(cuerpo))
        } catch {
            if case .cancelado = APIError.desde(error) { throw error }
            toast(TextosReproductor.reporteFallido, tono: .err, icono: .aviso)
            throw error
        }
        guard gen == generacion else { return }
        let momento = ahora
        let fin = respuesta.report.quarantineUntil.flatMap(FechaISO.parse).flatMap { $0 > momento ? $0 : nil }
        marcarReportada(hash, motivo: motivo, hasta: fin ?? momento.addingTimeInterval(ReglasFuentes.cuarentenaLocal))
        cerrarHojaDeReporte()
        let alternativa =
            activa == hash
            ? entradas.first { e in
                e.id != hash && ReglasFuentes.efectivo(e, pantalla: pantalla, ahora: momento).viva
            } : nil
        entorno.haptica.disparar(.exito)
        let accion = alternativa.map { otra in
            AccionAviso(titulo: TextosReproductor.verLa(numero(otra.id))) { [weak self] in self?.elegir(otra.id) }
        }
        toast(TextosReproductor.fuenteApartada, icono: .refresh, accion: accion)
        if let scan = respuesta.scan { seguirReporte(hash, motivo: motivo, trabajo: scan.id) }
    }

    private func marcarReportada(_ hash: String, motivo: SourceReportReason?, hasta: Date?) {
        guard let i = entradas.firstIndex(where: { $0.id == hash }) else { return }
        entradas[i].reportadaHasta = hasta
        entradas[i].motivoReporte = hasta == nil ? nil : motivo
    }

    /// `followReport`: sigue el trabajo del reporte; en reposo espera hasta el reintento; al terminar, el aviso.
    private func seguirReporte(_ hash: String, motivo: SourceReportReason, trabajo: String) {
        reportesSeguidos[hash]?.parar()
        let reporte = ReporteSeguido(hash: hash, motivo: motivo, trabajoId: trabajo, generacion: generacion)
        reportesSeguidos[hash] = reporte
        seguirTrabajoDeReporte(reporte)
    }

    private func seguirTrabajoDeReporte(_ reporte: ReporteSeguido) {
        guard let nuevo = vigilar(reporte.trabajoId) else { return }
        nuevo.alTrabajo = { [weak self, weak reporte] trabajo in
            guard let self, let reporte else { return }
            self.alTrabajoDeReporte(trabajo, reporte)
        }
        nuevo.alError = { [weak self, weak reporte] in
            guard let self, let reporte else { return }
            reporte.consultas += 1
            if reporte.consultas >= Self.consultasReporte { self.acabarReporte(reporte) }
        }
        reporte.seguimiento = nuevo
        nuevo.empezar()
    }

    private func acabarReporte(_ reporte: ReporteSeguido) {
        reporte.parar()
        if reportesSeguidos[reporte.hash] === reporte { reportesSeguidos[reporte.hash] = nil }
    }

    private func alTrabajoDeReporte(_ job: ScanJob, _ reporte: ReporteSeguido) {
        guard reporte.generacion == generacion else {
            acabarReporte(reporte)
            return
        }
        reporte.consultas += 1
        let resultado = job.candidates.first { $0.id == reporte.hash }
        if let resultado { entradas = ReglasFuentes.aplicarComprobacion(entradas, candidatos: [resultado]) }
        if job.status == .waiting, let reintento = job.retryAt {
            // Hasta la hora del reintento no hay nada nuevo: se deja de preguntar.
            let espera: TimeInterval =
                FechaISO.parse(reintento).map { at in
                    max(1.5, min(Self.esperaMaximaReporte, at.timeIntervalSince(ahora) + 0.75))
                } ?? 60
            reporte.seguimiento?.parar()
            reporte.seguimiento = nil
            reporte.pausa = Task { [weak self, weak reporte] in
                try? await Task.sleep(for: .seconds(espera))
                guard let self, let reporte, !Task.isCancelled else { return }
                self.seguirTrabajoDeReporte(reporte)
            }
            return
        }
        if job.status == .complete || job.status == .cancelled {
            acabarReporte(reporte)
            guard job.status == .complete else { return }
            let seguimiento = ReglasFuentes.seguimientoReporte(reporte.motivo, estado: resultado?.state)
            let actual = entradas.first { $0.id == reporte.hash }
            if !seguimiento.sigueApartada {
                marcarReportada(reporte.hash, motivo: nil, hasta: nil)
            } else if let actual, actual.reportadaHasta == nil {
                marcarReportada(
                    reporte.hash, motivo: reporte.motivo, hasta: ahora.addingTimeInterval(ReglasFuentes.cuarentenaLocal))
            }
            toast(seguimiento.texto, tono: seguimiento.tono, icono: seguimiento.tono == .ok ? .check : .aviso)
            return
        }
        if reporte.consultas >= Self.consultasReporte && entorno?.tiempoRealAbierto != true { acabarReporte(reporte) }
    }

    /// «Es el canal correcto» (`confirmSource`).
    func confirmar(_ hash: String) async {
        guard let entorno, let entrada = entradas.first(where: { $0.id == hash }) else { return }
        let canal = canalDelPartido(entrada)
        guard !canal.isEmpty else { return }
        let cuerpo = FeedbackBody(
            id: entrada.id, verdict: .correct, channel: String(canal.prefix(200)),
            title: String(entrada.titulo.prefix(200)), reason: .notStarting)
        do {
            _ = try await entorno.api.enviar(API.correccionFuente(cuerpo))
            if let i = entradas.firstIndex(where: { $0.id == hash }) { entradas[i].aprendida = .correct }
            toast(TextosReproductor.aprendida, tono: .ok, icono: .learn)
        } catch {
            toast(TextosReproductor.correccionFallida, tono: .err, icono: .aviso)
        }
    }

    // MARK: «Encontrar canal»

    /// Elegir una señal en «Encontrar canal» con «Recordar mi elección» marcado (lo que trae la hoja de la web).
    func elegirCandidata(_ candidata: ResolutionCandidate) async {
        await elegirCandidata(candidata, recordar: true)
    }

    /// `chooseCandidate`: se reproduce ya (sin esperar al comprobador); con «Recordar», se vincula el canal.
    func elegirCandidata(_ candidata: ResolutionCandidate, recordar: Bool) async {
        await elegirSenal(
            id: candidata.id, titulo: candidata.title, ih: candidata.ih, origen: candidata.source.rawValue,
            recordar: recordar)
    }

    /// «Vincular y reproducir» (`bindManual`).
    func vincularManual(_ hash: String) async throws {
        guard let limpio = ReglasFuentes.normalizarHash(hash) else { throw ErrorFuentes.hashNoValido }
        await elegirSenal(id: limpio, titulo: tituloResolver, ih: false, origen: "saved", recordar: true)
    }

    private func elegirSenal(id: String, titulo: String, ih: Bool, origen: String, recordar: Bool) async {
        guard let entorno else { return }
        let canal = tituloResolver
        let gen = generacion
        var vinculoFallido = false
        if recordar {
            let cuerpo = BindBody(
                channel: String(canal.prefix(200)), id: id, title: String((titulo.isEmpty ? canal : titulo).prefix(200)),
                ih: ih)
            do { _ = try await entorno.api.enviar(API.vincular(cuerpo)) } catch { vinculoFallido = true }
        }
        guard gen == generacion else { return }
        let momento = ahora
        var nuevas = ReglasFuentes.sinDuplicados((resolucion?.candidates ?? []).map { EntradaFuente($0, ahora: momento) })
        if !nuevas.contains(where: { $0.id == id }) {
            var elegida = EntradaFuente.manual(id: id, titulo: titulo.isEmpty ? canal : titulo, canal: canal)
            elegida.origen = origen
            elegida.ih = ih
            nuevas.append(elegida)
        }
        fase = .lista
        resolverAbierto = false
        cerrarHojaDeResolver()
        entradas = nuevas
        activa = id
        automatico = false
        eleccionManual = false
        detenida = false
        if let scan = resolucion?.scan {
            configurarComprobador(scan)
            saltoArmado = true
        }
        if let entrada = entradas.first(where: { $0.id == id }) { reproducirEntrada(entrada, origen: .usuario) }
        if vinculoFallido { toast(TextosReproductor.vinculoFallido, tono: .warn, icono: .aviso) }
    }

    // MARK: Hojas (la única puerta es CentroHojas)

    /// «Encontrar canal» (`openResolver`).
    func abrirResolver() {
        resolverAbierto = true
        if vistaAbierta { entorno?.hojas.abrir(.encontrarCanal) }
    }

    /// La hoja «Encontrar canal» se cerró (✕ o arrastrando).
    func resolverCerrado() { resolverAbierto = false }

    /// «Reportar fuente» (`openReport`).
    func abrirReporte(_ hash: String) {
        entorno?.hojas.abrir(.reportar(hash: hash, numero: numero(hash)))
    }

    /// «Reproducir otro hash» en el partido (`openPaste`).
    func abrirPegar() {
        guard let partido else { return }
        entorno?.hojas.abrir(.pegar(.partido(id: partido.id)))
    }

    private func cerrarHojaDeResolver() {
        if case .encontrarCanal? = entorno?.hojas.actual { entorno?.hojas.cerrar() }
    }

    private func cerrarHojaDeReporte() {
        if case .reportar? = entorno?.hojas.actual { entorno?.hojas.cerrar() }
    }

    private func cerrarHojaDePegar() {
        if case .pegar? = entorno?.hojas.actual { entorno?.hojas.cerrar() }
    }
}
