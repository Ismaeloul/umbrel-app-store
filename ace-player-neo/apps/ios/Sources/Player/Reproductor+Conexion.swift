import Foundation
import os

/* Conexión, motor, vigilante, directo y fallos del reproductor (player/runtime.ts: connect, onGrantError,
   onFirstFrame, watchdog, goLive, back, fail, exhaust, failSystem). */

extension Reproductor {
    // MARK: Conexión

    func conectar(recuperacion: Bool) {
        guard let fuente else { return }
        generacion += 1
        let gen = generacion
        estadoConexion = EstadoConexion(generacion: gen, recuperacion: recuperacion)
        mensaje = recuperacion ? TextosReproductor.reconectandoConAceStream : TextosReproductor.conectando
        let canal = fuente.canal
        tareaConexion?.cancel()
        if demo {
            conectarDemo(canal)
            return
        }
        let modo = self.modo
        let visor = self.visor
        let servicio = self.servicio
        tareaConexion = Task {
            do {
                if recuperacion { await servicio.olvidarServidor() }
                let concesion = try await servicio.pedirStream(canal: canal, modo: modo, visor: visor)
                self.concedida(concesion, generacion: gen)
            } catch {
                self.falloAlPedir(APIError.desde(error), generacion: gen)
            }
        }
    }

    /// Demo: sin `channelStream`; el motor simulado da «señal» a los 1,8 s o, con «caíd» en el título, falla.
    private func conectarDemo(_ canal: CanalReproducible) {
        transicion(.concedida)
        let falla = canal.titulo.range(of: "ca[ií]d", options: [.regularExpression, .caseInsensitive]) != nil
        let url = URL(string: "demo:\(canal.id)" + (falla ? "?falla=1" : "")) ?? URL(fileURLWithPath: "/")
        motor.cargar(url: url, perfil: modo.perfilIOS)
        arrancarEstadisticasDemo()
    }

    /// Estadísticas inventadas cada 1,5 s (DEMO_STATS_MS, `startDemoStats`).
    private func arrancarEstadisticasDemo() {
        tareaDemo?.cancel()
        tareaDemo = Task { [weak self] in
            while !Task.isCancelled {
                guard self?.tirarEstadisticasDemo() != nil else { return }
                try? await Task.sleep(for: .milliseconds(1500))
            }
        }
    }

    /// Pares 18–57, bajada 900–2399 KB/s, subida 80–299 KB/s (a7 §13.13).
    private func tirarEstadisticasDemo() {
        estadisticas = StreamStatsData(
            sessionId: "", viewerIds: [], status: "dl", peers: 18 + Int.random(in: 0..<40),
            speedDown: Double(900 + Int.random(in: 0..<1500)), speedUp: Double(80 + Int.random(in: 0..<220)),
            downloaded: nil, at: FechaISO.texto(reloj()))
    }

    func concedida(_ concesion: Concesion, generacion gen: Int) {
        guard gen == generacion, fuente != nil, conexion == .pidiendo || conexion == .conectando else {
            // Respuesta de una conexión vieja: si nadie usa esa sesión, se suelta.
            if sesion?.id != concesion.grant.session.id {
                let servicio = self.servicio
                let visor = self.visor
                let id = concesion.grant.session.id
                Task { await servicio.soltar(sesion: id, visor: visor, motivo: .channelChange) }
            }
            return
        }
        if let anterior = sesion, anterior.id != concesion.grant.session.id { olvidarSesion() }
        sesion = Sesion(
            id: concesion.grant.session.id, url: concesion.url, protocolo: concesion.grant.protocol,
            latidoMs: max(5000, concesion.grant.session.heartbeatMs))
        sesionId = concesion.grant.session.id
        protocolo = concesion.grant.protocol
        codec = concesion.grant.codec
        if conexion == .pidiendo { transicion(.concedida) }
        let perfil = concesion.grant.latency.ios ?? modo.perfilIOS
        motor.cargar(url: concesion.url, perfil: perfil)
        if quiereReproducir { motor.reproducir() }
        arrancarLatido()
    }

    /// `onGrantError`: el motor caído espera a que vuelva; los errores de sistema no se reintentan ni saltan de
    /// fuente; el resto reintenta si vale la pena (sin red, plazo, 5xx, 429, 504).
    func falloAlPedir(_ error: APIError, generacion gen: Int) {
        guard gen == generacion, fuente != nil else { return }
        switch error {
        case .cancelado:
            return
        case .necesitaEmparejar:
            fallarSistema(TextosReproductor.sinAcceso, motivo: .sinAcceso, codigo: error.codigo ?? "unauthorized")
        case .servidor(let codigo, _, _, _) where codigo == "engine_unavailable":
            fallarSistema(error.mensaje, motivo: .sinMotor, codigo: codigo)
            esperandoMotor = true
        case .servidor(let codigo, _, _, _) where Self.erroresDeSistema.contains(codigo):
            fallarSistema(error.mensaje, motivo: .fallo, codigo: codigo)
        case .servidor(let codigo, let estado, _, _):
            fallar(error.mensaje, reintentable: estado >= 500 || estado == 429, codigo: codigo)
        case .red, .sinServidor, .servidorInalcanzable:
            fallar(error.mensaje, codigo: error.codigo)
        default:
            fallar(TextosReproductor.noSePudoAbrir, detalle: error.mensaje)
        }
    }

    /// `SYSTEM_ERRORS` (runtime.ts): no son culpa de la fuente.
    static let erroresDeSistema: Set<String> = [
        "ffmpeg_missing", "remux_busy", "handoff_denied", "unauthorized", "device_revoked", "cross_origin",
        "origin_forbidden", "demo_unsupported",
    ]

    // MARK: Eventos del motor

    func alEventoMotor(_ evento: EventoMotor) {
        guard fuente != nil else { return }
        switch evento {
        case .listo:
            if conexion == .conectando { transicion(.colchonListo) }
            if quiereReproducir { motor.reproducir() }
        case .primerFotograma:
            if conexion == .conectando { transicion(.colchonListo) }
            if conexion == .arrancando, transicion(.primerFotograma) { alArrancar() }
        case .estado(let estado):
            alCambiarEstado(estado)
        case .atasco:
            fuente?.rebuffers += 1
        case .fallo(let detalle):
            registro.info("Fallo del vídeo: \(detalle, privacy: .public)")
            guard [.conectando, .precarga, .arrancando, .activa].contains(conexion) else { return }
            // El motor de la demo dice su motivo; AVPlayer, un corte («error»/«ended» del vídeo en la web).
            fallar(demo ? detalle : TextosReproductor.senalCortada, detalle: detalle)
        }
    }

    /// `onFirstFrame`.
    private func alArrancar() {
        guard var f = fuente else { return }
        let recuperacion = estadoConexion?.recuperacion ?? false
        estadoConexion?.ticsConexion = 0
        estadoConexion?.ticsParado = 0
        estadoConexion?.ultimaPosicion = motor.tiempoActual
        estadoConexion?.ticsGracia = recuperacion ? UmbralesReproductor.graciaTics : 0
        mensaje = nil
        intento = nil
        medio = motor.estadoTiempo == .reproduciendo ? .reproduciendo : .buffer
        let ahora = reloj()
        if f.empezoEn == nil {
            f.empezoEn = ahora
            f.ultimoSigue = ahora
            f.ttffMs = ahora.timeIntervalSince(f.pedidaEn) * 1000
            fuente = f
            primeraImagenMs = f.ttffMs
            arranco = true
            enviarResultado(.arranco, segundos: 0)
            contar(.arranco(f.canal))
        } else if recuperacion {
            notificar(TextosReproductor.senalRecuperada, tono: .ok, senal: .ok)
        }
        arranco = true
        medirDirecto()
        arrancarMedidor()
        sistema?.cambio(self)
    }

    private func alCambiarEstado(_ estado: EstadoTiempo) {
        switch estado {
        case .reproduciendo:
            tareaPausaAjena?.cancel()
            // P1: un play desde fuera (PiP, pantalla de bloqueo) restaura la intención.
            if !quiereReproducir { quiereReproducir = true }
            if conexion == .activa { medio = .reproduciendo }
        case .esperando:
            if conexion == .activa { medio = .buffer }
        case .pausado:
            if pausasPropias > 0 {
                pausasPropias -= 1
                if conexion == .activa { medio = .pausado }
            } else if quiereReproducir && conexion == .activa {
                confirmarPausaAjena()
            } else if conexion == .activa {
                medio = .pausado
            }
        }
        sistema?.cambio(self)
    }

    /// Una pausa que no hemos pedido (botón del PiP, auriculares, llamada) se toma como decisión de quien mira
    /// si dura; un corte de red también pausa AVPlayer, pero llega su fallo antes de confirmarla.
    private func confirmarPausaAjena() {
        tareaPausaAjena?.cancel()
        let gen = generacion
        let esperar = self.esperar
        tareaPausaAjena = Task {
            try? await esperar(UmbralesReproductor.confirmarPausaAjena)
            guard !Task.isCancelled, gen == self.generacion, self.conexion == .activa,
                self.motor.estadoTiempo == .pausado
            else { return }
            self.quiereReproducir = false
            self.medio = .pausado
            self.sistema?.cambio(self)
        }
    }

    // MARK: Vigilante (1,5 s) y medidor (0,5 s)

    func arrancarVigilante() {
        guard automatico, tareaVigilante == nil else { return }
        tareaVigilante = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(UmbralesReproductor.tic))
                guard let self, !Task.isCancelled else { return }
                self.tic()
            }
        }
    }

    /// Repinta directo y colchón cada 500 ms mientras hay imagen (METER_MS).
    func arrancarMedidor() {
        guard automatico else { return }
        tareaMedidor?.cancel()
        tareaMedidor = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard let self, !Task.isCancelled else { return }
                self.medirDirecto()
            }
        }
    }

    /// Un tic del vigilante (con los umbrales de HLS nativo, a7 §9.4).
    public func tic() {
        guard fuente != nil, var c = estadoConexion, c.generacion == generacion else { return }
        switch conexion {
        case .conectando, .precarga, .arrancando:
            c.ticsConexion += 1
            estadoConexion = c
            if c.ticsConexion >= UmbralesReproductor.limiteConexionTics { fallar(TextosReproductor.sinSenalSuficiente) }
            return
        case .activa:
            break
        default:
            return
        }
        medirDirecto()
        let t = motor.tiempoActual
        if !quiereReproducir {
            c.ticsParado = 0
            c.ultimaPosicion = t
            estadoConexion = c
            return
        }
        if c.ticsGracia > 0 {
            c.ticsGracia -= 1
            c.ultimaPosicion = t
            estadoConexion = c
            return
        }
        if abs(t - c.ultimaPosicion) > UmbralesReproductor.avanceMinimoS {
            c.ticsParado = 0
            c.ultimaPosicion = t
            estadoConexion = c
            talVezSigue()
            return
        }
        c.ticsParado += 1
        estadoConexion = c
        if c.ticsParado == UmbralesReproductor.empujonDirectoTics { empujarAlDirecto() }
        if c.ticsParado >= UmbralesReproductor.reconexionCongeladoTics { fallar(TextosReproductor.imagenParada) }
    }

    /// Imagen parada con vídeo por delante: saltar al directo en vez de reiniciar. «Vídeo disponible» es
    /// cualquiera de las tres: el directo va 6 s o más por delante, hay 2 s descargados por delante del cabezal
    /// o AVPlayer dice que puede seguir (`isPlaybackLikelyToKeepUp`) y aun así no avanza.
    private func empujarAlDirecto() {
        guard let ventana = motor.ventana else { return }
        let seguridad = Directo.colchonSeguridad(modo: modo, duracionVentana: ventana.duracion)
        guard let objetivo = Directo.objetivo(ventana: ventana, seguridad: seguridad) else { return }
        let retraso = objetivo - motor.tiempoActual
        guard
            retraso >= UmbralesReproductor.empujonMinRetrasoS
                || motor.colchonPorDelante >= UmbralesReproductor.videoDisponibleS || motor.probableSinCortes
        else { return }
        registro.info("Imagen parada con \(retraso, format: .fixed(precision: 1)) s por delante: salto al directo")
        saltosAlDirecto += 1
        Task {
            _ = await self.saltar(a: objetivo)
            self.motor.reproducir()
        }
    }

    @discardableResult
    func saltar(a segundos: Double) async -> Bool {
        let anterior = medio
        if conexion == .activa { medio = .buscando }
        let llego = await motor.saltar(a: segundos)
        if medio == .buscando {
            switch motor.estadoTiempo {
            case .reproduciendo: medio = .reproduciendo
            case .esperando: medio = .buffer
            case .pausado: medio = anterior == .buscando ? .pausado : anterior
            }
        }
        return llego
    }

    func medirDirecto() {
        guard conexion == .activa else { return }
        let nuevo = InfoDirecto.medir(ventana: motor.ventana, actual: motor.tiempoActual, modo: modo)
        // Solo se publica si cambia de verdad (medio segundo o el estado).
        if nuevo.disponible != directo.disponible || nuevo.enDirecto != directo.enDirecto
            || abs(nuevo.recuperable - directo.recuperable) >= 0.5 || abs(nuevo.retraso - directo.retraso) >= 0.5
        {
            directo = nuevo
        }
        let colchon = (motor.colchonPorDelante * 10).rounded() / 10
        if colchon != colchonS { colchonS = colchon }
        if nuevo.disponible && motor.estadoTiempo == .reproduciendo {
            fuente?.latencia.suma += nuevo.retraso
            fuente?.latencia.n += 1
        }
    }

    /// El vigilante lo llama mientras el vídeo avanza: «sigue» cada 2 min.
    private func talVezSigue() {
        guard var f = fuente, f.empezoEn != nil, !demo else { return }
        let ahora = reloj()
        guard ahora.timeIntervalSince(f.ultimoSigue) >= UmbralesReproductor.sigueCada else { return }
        f.ultimoSigue = ahora
        fuente = f
        let cuerpo = OutcomeBody(id: f.canal.id, resultado: .sigue)
        let servicio = self.servicio
        Task { await servicio.resultado(cuerpo) }
    }

    // MARK: Directo y −30 s

    /// Botón DIRECTO (`goLive`): salta al borde útil (con el colchón del modo) y reproduce, con los avisos de
    /// la web.
    public func irAlDirecto() async {
        guard fuente != nil else { return }
        if demo {
            quiereReproducir = true
            motor.reproducir()
            notificar(TextosReproductor.directoEnDemo, icono: .directo)
            return
        }
        guard conexion == .activa else { return }
        let estabaSonando = motor.estadoTiempo == .reproduciendo
        let objetivo = motor.ventana.flatMap { ventana in
            Directo.objetivo(
                ventana: ventana, seguridad: Directo.colchonSeguridad(modo: modo, duracionVentana: ventana.duracion))
        }
        let detras = objetivo.map { max(0, $0 - motor.tiempoActual) } ?? 0
        guard let objetivo, detras > UmbralesReproductor.toleranciaDirectoS else {
            quiereReproducir = true
            motor.reproducir()
            medirDirecto()
            if estabaSonando {
                notificar(TextosReproductor.yaEnDirecto, icono: .directo)
            } else {
                notificar(TextosReproductor.directoReanudado, tono: .ok, icono: .directo)
            }
            return
        }
        let llego = await saltar(a: objetivo)
        quiereReproducir = true
        motor.reproducir()
        medirDirecto()
        if llego {
            notificar(TextosReproductor.deVueltaAlDirecto, tono: .ok, icono: .directo)
        } else {
            notificar(TextosReproductor.noDejaSaltar, tono: .warn, icono: .aviso)
        }
    }

    /// −30 s para repetir la jugada (`back`).
    public func retroceder() async {
        guard fuente != nil else { return }
        if demo {
            notificar(TextosReproductor.atrasEnDemo)
            return
        }
        guard let ventana = motor.ventana else {
            notificar(TextosReproductor.atrasSinVentana, tono: .warn, icono: .aviso)
            return
        }
        let actual = motor.tiempoActual.isFinite ? motor.tiempoActual : ventana.fin
        let destino = max(ventana.inicio, actual - UmbralesReproductor.retrocesoS)
        let real = actual - destino
        guard real >= 1 else {
            notificar(TextosReproductor.atrasAlPrincipio, tono: .warn, icono: .aviso)
            return
        }
        let llego = await saltar(a: destino)
        medirDirecto()
        if llego { notificar(TextosReproductor.retrocedido(Int(real.rounded())), icono: .back) }
    }

    // MARK: Fallos y reconexión

    /// La conexión se ha roto: reconecta tras la espera exponencial o, sin presupuesto, da la fuente por
    /// perdida (`fail`).
    public func fallar(_ motivo: String, reintentable: Bool = true, codigo: String? = nil, detalle: String? = nil) {
        guard var f = fuente, conexion != .idle, conexion != .error, conexion != .reconectando else { return }
        terminarConexion()
        let ahora = reloj()
        f.reconexiones = f.reconexiones.filter { ahora.timeIntervalSince($0) < UmbralesReproductor.ventanaReconexion }
        let maximo =
            (f.origen == .automatico && f.empezoEn == nil)
            ? PoliticaReconexion.maxIntentosArranqueAutomatico : PoliticaReconexion.maxIntentos
        if let detalle { registro.info("Fallo: \(motivo, privacy: .public) (\(detalle, privacy: .public))") }
        if !reintentable || f.reconexiones.count >= maximo {
            fuente = f
            agotar(motivo, codigo: codigo)
            return
        }
        f.reconexiones.append(ahora)
        f.reconexionesTotales += 1
        fuente = f
        reconexiones = f.reconexionesTotales
        let n = f.reconexiones.count
        transicion(.fallo)
        medio = .idle
        intento = IntentoReconexion(n: n, max: maximo)
        let texto = TextosReproductor.reconexion(motivo, n: n, max: maximo)
        mensaje = texto
        notificar(texto, tono: .warn, icono: .refresh)
        let clave = f.clave
        let esperar = self.esperar
        tareaReconexion?.cancel()
        tareaReconexion = Task {
            try? await esperar(PoliticaReconexion.espera(intento: n))
            guard !Task.isCancelled, self.fuente?.clave == clave, self.conexion == .reconectando else { return }
            self.transicion(.reintentar)
            self.conectar(recuperacion: true)
        }
        sistema?.cambio(self)
    }

    /// Reconexiones agotadas (`exhaust`): la fuente se da por perdida y se pregunta por la siguiente.
    private func agotar(_ motivo: String, codigo: String?) {
        guard var f = fuente else { return }
        f.fallida = true
        fuente = f
        let segundos = f.empezoEn.map { Int(reloj().timeIntervalSince($0).rounded()) } ?? 0
        let resultado: OutcomeResult = f.empezoEn != nil ? .cayo : .fallo
        enviarResultado(resultado, segundos: segundos)
        informar(.source, codigo: codigo ?? "player_source_failed", mensaje: motivo)
        soltarSesion(.error)
        terminarConexion()
        transicion(.agotado)
        medio = .idle
        errores += 1
        textoFalloPendiente = nil
        let aviso = FalloFuente(canal: f.canal, origen: f.origen, resultado: resultado, segundos: segundos, motivo: motivo)
        let cambiada = alFallarFuente?(aviso) ?? false
        let respuesta = textoFalloPendiente
        textoFalloPendiente = nil
        if cambiada { cambiosAutomaticos += 1 }
        if fuente?.clave != f.clave {
            // Quien escucha ya ha puesto otra fuente a sonar: esa manda.
            mensaje = TextosReproductor.probandoSiguiente
            notificar(TextosReproductor.probandoSiguiente, tono: .warn, senal: .checking)
            return
        }
        intento = nil
        motivoParada = .fallo
        let texto = cambiada ? TextosReproductor.probandoSiguiente : (respuesta ?? MotivoReposo.fallo.mensaje)
        mensaje = texto
        notificar(texto, tono: cambiada ? .warn : .err, senal: cambiada ? .checking : .fail)
        sistema?.cambio(self)
    }

    /// Un fallo que no es de la fuente (motor caído, remux lleno, sin acceso…): se enseña y no se salta.
    func fallarSistema(_ texto: String, motivo: MotivoParada, codigo: String) {
        guard fuente != nil else { return }
        terminarConexion()
        soltarSesion(.error)
        informar(codigo == "engine_unavailable" ? .engine : .client, codigo: codigo, mensaje: texto)
        if !transicion(.agotado) { conexion = .error }
        medio = .idle
        intento = nil
        motivoParada = motivo
        mensaje = texto
        sistema?.cambio(self)
    }
}
