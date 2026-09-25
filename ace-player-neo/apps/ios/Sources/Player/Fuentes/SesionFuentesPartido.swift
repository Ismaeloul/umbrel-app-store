import Foundation
import Observation

/* Rescatado en la poda (fase 0.2, b-arquitectura §1.11 y §4.1.2) de `CentroPartidoModelo`
   (Features/MatchCenter/CentroPartidoModelo.swift) y de `HermanasModelo` (EscenarioView.swift), sin
   cambiar el comportamiento: solo el nombre y las dependencias. El `unowned let app: AppModel` pasa a
   ser `EntornoSesionFuentes`.
   Fase 0.3b (I0): se llamaba `SesionFuentes`; ese nombre es ahora el contrato de §2.6 (una sola sesión
   con `conectar(_:)`, Player/Fuentes/SesionFuentes.swift). Esto queda como REFERENCIA para M3, con sus
   pruebas (SesionFuentesTests), hasta que el port completo de session.ts lo absorba: M3 lo borra
   entonces. Los avisos van ya por el `Avisos` del contrato (§2.4.4). */

extension EnPantalla {
    /// Del reproductor: sonando si ya arrancó; conectando si aún no hay imagen.
    @MainActor
    init(_ reproductor: Reproductor) {
        guard let canal = reproductor.canal, reproductor.conexion.enMarcha else {
            self = .nada
            return
        }
        let fase = reproductor.fase
        let sonando = reproductor.arranco && [.reproduciendo, .pausado, .buffer, .buscando].contains(fase)
        self.init(
            id: canal.id, sonando: sonando,
            conectando: !sonando && [.cargando, .reconectando, .buffer].contains(fase))
    }
}

/// Fuentes del partido y su política: el `session.ts` de la web.
///
/// Vive fuera de la vista A PROPÓSITO (la guarda la app): si la fuente se
/// cae mientras suena en el mini-reproductor, se pasa a la siguiente
/// verificada igual.
///
/// - Resuelve el partido (`football/resolve`), guarda las candidatas y sigue
///   al comprobador (sondeo cada 1,5 s y `scan.verdict` por SSE).
/// - Arranque automático: con la pantalla abierta, la primera verificada;
///   sin comprobador, la mejor colocada.
/// - POLÍTICA ÚNICA DE CAMBIO DE FUENTE: mientras la persona no elige nada
///   («automático»), si la fuente se cae se pasa a la siguiente verificada
///   que no se haya probado. En cuanto elige una (o pega un hash), todo es
///   manual: nunca se salta sola y se le dice que elija otra.
@MainActor
@Observable
final class SesionFuentesPartido {
    let partido: FootballMatch
    private(set) var resolucion: Resolution?
    private(set) var entradas: [EntradaFuente] = []
    private(set) var trabajo: ScanJob?
    private(set) var cargando = false
    private(set) var fallo: String?
    /// La persona aún no ha elegido fuente: la app lleva la entrada al partido.
    private(set) var automatico = true
    private(set) var sinComprobador = false
    /// La vista está en pantalla (solo entonces arranca sola).
    private(set) var vistaAbierta = false
    /// La agenda pidió sus fuentes por adelantado (para la cápsula de señal); la app la conserva.
    private(set) var precalentado = false
    /// Suben con cada reporte y cada Content ID pegado (háptica de éxito).
    private(set) var reportes = 0
    private(set) var pegados = 0

    private unowned let entorno: any EntornoSesionFuentes
    @ObservationIgnored private var tareaSeguimiento: Task<Void, Never>?
    @ObservationIgnored private var cargado = false
    /// «Ver ahora» pulsado antes de tener fuentes: arranca la primera que valga.
    @ObservationIgnored private var arranqueSolicitado = false

    init(partido: FootballMatch, entorno: any EntornoSesionFuentes) {
        self.partido = partido
        self.entorno = entorno
    }

    private var reproductor: Reproductor { entorno.reproductor }

    var contexto: ContextoPartido {
        ContextoPartido(
            id: partido.id, titulo: FormatoAgenda.equipos(partido), competicion: partido.competition,
            canal: partido.channels.first?.name ?? "")
    }

    /// Suena (o se conecta) una fuente de este partido.
    var suenaAqui: Bool { reproductor.canal?.partido?.id == partido.id }

    /// La pantalla del partido entra o sale.
    func vista(abierta: Bool) {
        let antes = vistaAbierta
        vistaAbierta = abierta
        if abierta && !antes { intentarArranqueAutomatico() }
    }

    var terminado: Bool { sinComprobador || ReglasFuentes.terminado(trabajo) }

    var progreso: Double { ReglasFuentes.progreso(trabajo, total: entradas.count) }

    /// Estado efectivo de cada entrada (con lo que hay en pantalla ahora).
    func efectivos(ahora: Date = .now) -> [String: Efectivo] {
        let pantalla = EnPantalla(reproductor)
        var resultado: [String: Efectivo] = [:]
        for entrada in entradas {
            resultado[entrada.id] = ReglasFuentes.efectivo(entrada, pantalla: pantalla, ahora: ahora)
        }
        return resultado
    }

    /// Resumen para la cápsula de señal («Señal», «Floja», «Comprobando»…).
    var resumen: ResumenFuentes { ReglasFuentes.resumen(entradas, efectivos: efectivos()) }

    /// La fuente que suena ahora, si es de este partido.
    var entradaEnPantalla: EntradaFuente? {
        guard suenaAqui, let id = reproductor.canal?.id else { return nil }
        return entradas.first { $0.id == id }
    }

    /// Posición (1…n) de la fuente en pantalla, para el rótulo del vídeo.
    var indiceEnPantalla: Int? {
        guard let id = entradaEnPantalla?.id, let indice = entradas.firstIndex(where: { $0.id == id }) else { return nil }
        return indice + 1
    }

    /// Pide las fuentes por adelantado (la agenda, para los que van en directo o a menos de 45 min).
    func precalentar() async {
        precalentado = true
        await cargar()
    }

    // MARK: Resolver

    func cargar(rebuscar: Bool = false) async {
        if cargado && !rebuscar { return }
        cargando = true
        fallo = nil
        defer { cargando = false }
        let actual = suenaAqui ? reproductor.canal : nil
        do {
            let resolucion = try await entorno.api.enviar(
                API.resolver(
                    partido: partido.id, canales: partido.channels.map(\.name), rebuscar: rebuscar,
                    actual: actual?.id, actualEsInfohash: actual?.ih == true, cliente: "ios"))
            cargado = true
            self.resolucion = resolucion
            fusionar(resolucion.candidates.map { EntradaFuente($0, ahora: .now) })
            if let scan = resolucion.scan {
                sinComprobador = false
                seguir(scan.id)
            } else {
                sinComprobador = true
                trabajo = nil
            }
            if rebuscar {
                entorno.avisos.avisar(
                    entradas.isEmpty ? "No se han encontrado fuentes nuevas" : "Fuentes actualizadas", tono: .ok)
            }
            intentarArranqueAutomatico()
        } catch {
            let convertido = APIError.desde(error)
            if case .cancelado = convertido { return }
            fallo = convertido.mensaje
            arranqueSolicitado = false
        }
    }

    /// Junta lo nuevo con lo que ya se sabía (veredictos, sondas, probadas).
    private func fusionar(_ nuevas: [EntradaFuente]) {
        let anteriores = Dictionary(entradas.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var resultado = ReglasFuentes.sinDuplicados(nuevas).map { nueva -> EntradaFuente in
            guard let vieja = anteriores[nueva.id] else { return nueva }
            var mezcla = nueva
            mezcla.sonda = nueva.sonda ?? vieja.sonda
            mezcla.veredicto = vieja.veredicto
            mezcla.probadaAuto = vieja.probadaAuto
            if mezcla.reportadaHasta == nil { mezcla.reportadaHasta = vieja.reportadaHasta }
            return mezcla
        }
        // Las pegadas a mano no vienen en la resolución: se conservan arriba.
        let manuales = entradas.filter { $0.origen == "manual" && !resultado.map(\.id).contains($0.id) }
        resultado.insert(contentsOf: manuales, at: 0)
        entradas = resultado
    }

    // MARK: Comprobador

    private func seguir(_ id: String) {
        tareaSeguimiento?.cancel()
        tareaSeguimiento = Task { [weak self] in
            var fallos = 0
            for _ in 0..<240 {
                guard let self, !Task.isCancelled else { return }
                do {
                    let trabajo = try await self.entorno.api.enviar(API.comprobacion(id: id))
                    guard !Task.isCancelled else { return }
                    fallos = 0
                    self.aplicar(trabajo)
                    if ReglasFuentes.terminado(trabajo) { return }
                } catch {
                    if case .cancelado = APIError.desde(error) { return }
                    fallos += 1
                    if fallos >= 3 {
                        self.sinComprobador = true
                        self.entorno.avisos.avisar("El comprobador no responde; se muestran todas las fuentes")
                        self.intentarArranqueAutomatico()
                        return
                    }
                }
                try? await Task.sleep(for: .milliseconds(1500))
            }
        }
    }

    private func aplicar(_ trabajo: ScanJob) {
        self.trabajo = trabajo
        var porId: [String: ScanCandidate] = [:]
        for candidato in trabajo.candidates { porId[candidato.id.lowercased()] = candidato }
        for indice in entradas.indices {
            if let candidato = porId[entradas[indice].id.lowercased()] {
                entradas[indice].sonda = SondaFuente(candidato)
            }
        }
        intentarArranqueAutomatico()
    }

    /// Eventos del backend que tocan a este partido.
    func procesar(_ evento: SSEEvent) {
        switch evento {
        case .scanVerdict(let datos):
            guard let indice = entradas.firstIndex(where: { $0.id.lowercased() == datos.hash.lowercased() }) else {
                return
            }
            var estado: ScanCandidateState =
                switch datos.state {
                case .working: .working
                case .weak: .weak
                case .failed: .failed
                case .desconocido: .queued
                }
            if datos.playableOn?.ios == true, estado != .working, datos.reason == "unsupported_codec" {
                estado = .working
            }
            var sonda = entradas[indice].sonda ?? SondaFuente(estado: estado)
            sonda.estado = estado
            sonda.motivo = datos.reason
            sonda.reproducibleEnIOS = datos.playableOn?.ios
            entradas[indice].sonda = sonda
            intentarArranqueAutomatico()
        default:
            break
        }
    }

    // MARK: Arranque automático y cambio de fuente

    private func intentarArranqueAutomatico() {
        if arranqueSolicitado, atenderArranqueSolicitado() { return }
        guard automatico, vistaAbierta, !entradas.isEmpty else { return }
        // Ya suena (o se conecta) una de este partido.
        if suenaAqui && reproductor.conexion.enMarcha { return }
        let efectivos = efectivos()
        var elegida = ReglasFuentes.elegirAutomatica(entradas, efectivos: efectivos, terminado: terminado)
        if elegida == nil, sinComprobador, let mejor = resolucion?.candidate,
            let entrada = entradas.first(where: { $0.id == mejor.id }), !entrada.probadaAuto
        {
            elegida = entrada
        }
        guard let elegida else { return }
        poner(elegida, origen: .automatico)
    }

    private func poner(_ entrada: EntradaFuente, origen: OrigenReproduccion) {
        if let indice = entradas.firstIndex(where: { $0.id == entrada.id }) { entradas[indice].probadaAuto = true }
        let efectivos = efectivos()
        let lista = entradas.filter { efectivos[$0.id]?.estado == .working || $0.id == entrada.id }
            .map { $0.canalReproducible(partido: contexto) }
        reproductor.alFallarFuente = { [weak self] fallo in self?.fuenteFallida(fallo) ?? false }
        reproductor.reproducir(entrada.canalReproducible(partido: contexto), origen: origen, lista: lista)
    }

    /// Reconexiones agotadas: se anota lo que vio el reproductor y, en
    /// automático, se pasa a la siguiente verificada.
    private func fuenteFallida(_ fallo: FalloFuente) -> Bool {
        guard fallo.canal.partido?.id == partido.id else { return false }
        let (estado, motivo) = ReglasFuentes.veredictoFallo(fallo.resultado, segundos: fallo.segundos)
        if let indice = entradas.firstIndex(where: { $0.id == fallo.canal.id }) {
            entradas[indice].veredicto = VeredictoReproductor(estado: estado, motivo: motivo, fecha: .now)
            entradas[indice].probadaAuto = true
        }
        guard automatico else { return false }
        var efectivos: [String: Efectivo] = [:]
        for entrada in entradas {
            efectivos[entrada.id] = ReglasFuentes.efectivo(entrada, pantalla: .nada, ahora: .now)
        }
        guard let siguiente = ReglasFuentes.elegirAutomatica(entradas, efectivos: efectivos, terminado: true) else {
            return false
        }
        poner(siguiente, origen: .automatico)
        return true
    }

    /// La persona elige una fuente: a partir de aquí todo es manual.
    func elegir(_ entrada: EntradaFuente) {
        automatico = false
        poner(entrada, origen: .usuario)
    }

    /// «Ver» sin haber elegido: la mejor que haya ahora.
    func verMejor() {
        let efectivos = efectivos()
        if let elegida = ReglasFuentes.elegirAutomatica(entradas, efectivos: efectivos, terminado: true)
            ?? entradas.first(where: { efectivos[$0.id]?.reportada != true })
        {
            poner(elegida, origen: .usuario)
        }
    }

    /// «Ver ahora» desde la portada o el escenario: si ya hay fuentes, la
    /// mejor; si aún no, la primera que valga cuando lleguen.
    func verAhora() {
        if suenaAqui && reproductor.conexion.enMarcha { return }
        arranqueSolicitado = true
        if !atenderArranqueSolicitado(), cargado, !cargando, entradas.isEmpty {
            // Ya se preguntó y no hay nada: no queda nada que esperar.
            arranqueSolicitado = false
        }
    }

    /// Arranca la fuente pedida con «Ver ahora» en cuanto haya una que valga.
    private func atenderArranqueSolicitado() -> Bool {
        guard !entradas.isEmpty else { return false }
        let efectivos = efectivos()
        let elegida =
            ReglasFuentes.elegirAutomatica(entradas, efectivos: efectivos, terminado: terminado)
            ?? (terminado ? entradas.first(where: { efectivos[$0.id]?.reportada != true }) : nil)
        guard let elegida else { return false }
        arranqueSolicitado = false
        poner(elegida, origen: .usuario)
        return true
    }

    /// Deslizar el vídeo a los lados: la siguiente (+1) o la anterior (−1)
    /// fuente que no esté caída ni reportada. Elegir a mano apaga el automático.
    @discardableResult
    func elegirSiguiente(_ paso: Int) -> Bool {
        let efectivos = efectivos()
        let candidatas = ReglasFuentes.zapeables(entradas, efectivos: efectivos)
        guard candidatas.count > 1 else { return false }
        let actual = reproductor.canal?.id
        let indice = candidatas.firstIndex { $0.id == actual } ?? -1
        let siguiente = ((indice + paso) % candidatas.count + candidatas.count) % candidatas.count
        let destino = candidatas[siguiente]
        guard destino.id != actual else { return false }
        elegir(destino)
        return true
    }

    /// Hay al menos dos fuentes entre las que zapear.
    var puedeZapear: Bool {
        ReglasFuentes.zapeables(entradas, efectivos: efectivos()).count > 1
    }

    // MARK: Acciones

    /// Pega un Content ID o enlace `acestream://`; opcionalmente lo vincula al canal del partido.
    @discardableResult
    func pegar(_ texto: String, recordar: Bool) async -> Bool {
        guard let hash = ReglasFuentes.hashValido(texto) else {
            entorno.avisos.avisar(ReglasFuentes.textoHashNoValido, tono: .err)
            return false
        }
        let canal = partido.channels.first?.name ?? ""
        let existe = entradas.contains { $0.id == hash }
        if !existe {
            let manual = EntradaFuente(
                id: hash, titulo: canal.isEmpty ? "Señal pegada" : "\(canal) --> Pegada", ih: nil, origen: "manual",
                canal: canal)
            entradas.insert(manual, at: 0)
        }
        guard let entrada = entradas.first(where: { $0.id == hash }) else { return false }
        elegir(entrada)
        pegados += 1
        entorno.avisos.avisar(existe ? "Reproduciendo la señal pegada" : "Señal añadida y reproduciendo", tono: .ok)
        if recordar, !canal.isEmpty {
            _ = try? await entorno.api.enviar(API.vincular(BindBody(channel: canal, id: hash, title: canal)))
        }
        return true
    }

    /// Reporta una fuente: se aparta (cuarentena) y el comprobador la revisa.
    func reportar(_ entrada: EntradaFuente, motivo: SourceReportReason) async {
        let cuerpo = ReportBody(
            id: entrada.id, reason: motivo, channel: entrada.canal.isEmpty ? nil : entrada.canal,
            matchId: partido.id, title: entrada.titulo, source: entrada.origen, ih: entrada.ih)
        var hasta = Date.now.addingTimeInterval(ReglasFuentes.cuarentenaLocal)
        do {
            let respuesta = try await entorno.api.enviar(API.reportarFuente(cuerpo))
            if let fin = respuesta.report.quarantineUntil.flatMap(FechaISO.parse) { hasta = fin }
            reportes += 1
            entorno.avisos.avisar("Fuente reportada: se aparta y se vuelve a comprobar", tono: .ok)
        } catch {
            entorno.avisos.avisar(APIError.desde(error).mensaje, tono: .err)
        }
        if let indice = entradas.firstIndex(where: { $0.id == entrada.id }) {
            entradas[indice].reportadaHasta = hasta
            entradas[indice].motivoReporte = motivo
        }
        // Si era la que sonaba, a la siguiente verificada.
        if reproductor.canal?.id == entrada.id {
            let efectivos = efectivos()
            if let siguiente = ReglasFuentes.elegirAutomatica(entradas, efectivos: efectivos, terminado: true) {
                poner(siguiente, origen: automatico ? .automatico : .usuario)
            }
        }
    }

    /// «Es el canal correcto» / «No es este canal».
    func corregir(_ entrada: EntradaFuente, correcto: Bool) async {
        let cuerpo = FeedbackBody(
            id: entrada.id, verdict: correcto ? .correct : .incorrect,
            channel: entrada.canal.isEmpty ? nil : entrada.canal, title: entrada.titulo,
            reason: correcto ? nil : .wrongChannel)
        do {
            _ = try await entorno.api.enviar(API.correccionFuente(cuerpo))
            if let indice = entradas.firstIndex(where: { $0.id == entrada.id }) {
                entradas[indice].aprendida = correcto ? .correct : .incorrect
            }
            entorno.avisos.avisar(correcto ? "Anotado: es el canal correcto" : "Anotado: no se volverá a proponer", tono: .ok)
        } catch {
            entorno.avisos.avisar(APIError.desde(error).mensaje, tono: .err)
        }
    }

    /// Deja de seguir al comprobador (al salir sin nada sonando de este partido).
    func dormir() {
        arranqueSolicitado = false
        guard !suenaAqui else { return }
        tareaSeguimiento?.cancel()
        tareaSeguimiento = nil
        cargado = false
    }
}

/// Fuentes «hermanas» de un canal suelto: las candidatas del servidor por su nombre
/// (de `HermanasModelo`, EscenarioView.swift). M3 lo sustituye por «Otras fuentes» calcado de la web
/// (§0.0 punto 1: hermanas de la biblioteca, sin `footballResolve`).
@MainActor
@Observable
final class HermanasModelo {
    private(set) var entradas: [EntradaFuente] = []
    private(set) var cargando = false
    @ObservationIgnored private var nombreCargado: String?

    func cargar(_ canal: CanalReproducible?, entorno: any EntornoSesionFuentes) async {
        guard let canal, canal.origen != "manual", nombreCargado != canal.titulo else { return }
        nombreCargado = canal.titulo
        cargando = true
        defer { cargando = false }
        let nombre = ReglasFuentes.parteCanal(canal.titulo)
        guard let resolucion = try? await entorno.api.enviar(API.resolver(canales: [nombre], cliente: "ios")) else {
            return
        }
        entradas = ReglasFuentes.sinDuplicados(resolucion.candidates.map { EntradaFuente($0, ahora: .now) })
            .filter { $0.id.lowercased() != canal.id.lowercased() }
    }
}
