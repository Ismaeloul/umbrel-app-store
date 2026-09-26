import Foundation

/* La sesión del backend y lo que se le cuenta (player/runtime.ts: heartbeat, handoff, reattach, release,
   eventos del SSE, vuelta a primer plano, resultados y diagnósticos). En demo no se late, no se suelta y no se
   mandan resultados ni diagnósticos (a7 §13.13). */

extension Reproductor {
    // MARK: Latido

    func arrancarLatido() {
        tareaLatido?.cancel()
        guard automatico, !demo, let s = sesion else { return }
        let id = s.id
        let intervalo = TimeInterval(s.latidoMs) / 1000
        tareaLatido = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(intervalo))
                guard let self, !Task.isCancelled, self.sesion?.id == id else { return }
                await self.latir()
            }
        }
    }

    /// Un latido: mantiene la sesión y descubre cambios de URL o que se ha perdido.
    public func latir() async {
        guard let s = sesion, !demo else { return }
        do {
            let recibido = try await servicio.latido(sesion: s.id, visor: visor, reproduciendo: medio == .reproduciendo)
            guard sesion?.id == s.id else { return }
            // La URL firmada cambia en cada latido (`?t=`): solo cuentan la ruta y el protocolo. En iOS la ruta solo
            // cambia cuando el servidor rehace el remux (a8 §3.11.8: el texto de `stream.reopened` remux_restart).
            if recibido.url.path() != s.url.path() || recibido.respuesta.protocol != s.protocolo {
                sesion?.url = recibido.url
                sesion?.protocolo = recibido.respuesta.protocol
                reenganchar(TextosReproductor.remuxReiniciado)
            }
        } catch {
            guard sesion?.id == s.id else { return }
            let codigo = APIError.desde(error).codigo
            if codigo == "session_expired" || codigo == "session_not_found" { await sesionPerdida(s.id) }
        }
    }

    /// El backend ya no nos tiene: ¿otro dispositivo se ha quedado el mando o caducó?
    private func sesionPerdida(_ id: String) async {
        guard sesion?.id == id, let f = fuente else { return }
        olvidarSesion()
        var otroDispositivo = false
        if let estado = try? await servicio.estadoReproduccion(), let ahora = estado.nowPlaying {
            let otroEquipo = dispositivoId.map { ahora.dev != $0 } ?? false
            otroDispositivo = otroEquipo || ahora.id != f.canal.id
        }
        guard fuente?.clave == f.clave else { return }
        if otroDispositivo {
            traspaso()
        } else {
            fallar(TextosReproductor.sesionCaducada)
        }
    }

    /// Otro dispositivo se ha quedado el mando (D5): aviso y `stop('traspasado')` sin soltar (ya lo hizo el
    /// backend).
    func traspaso() {
        notificar(TextosReproductor.traspaso, icono: .movil)
        terminarFuente(porque: "traspasado a otro dispositivo")
        olvidarSesion()
        fuente = nil
        transicion(.traspaso)
        quedarEnReposo(.traspaso)
        sistema?.termino()
        contar(.parado(.traspaso))
    }

    /// Cambio de URL sin contar como fallo (motor reiniciado, remux rehecho…): se pide otra vez la URL (unirse
    /// a la sesión es inmediato si sigue viva) para que llegue firmada y con el remux listo.
    private func reenganchar(_ aviso: String) {
        guard fuente != nil, transicion(.reenganche) else { return }
        mensaje = aviso
        medio = .idle
        notificar(aviso, icono: .refresh)
        motor.vaciar()
        conectar(recuperacion: false)
    }

    func soltarSesion(_ motivo: ReleaseReason) {
        guard let s = sesion else { return }
        olvidarSesion()
        guard !demo else { return }
        let servicio = self.servicio
        let visor = self.visor
        Task { await servicio.soltar(sesion: s.id, visor: visor, motivo: motivo) }
    }

    func olvidarSesion() {
        sesion = nil
        sesionId = nil
        tareaLatido?.cancel()
        tareaLatido = nil
    }

    // MARK: Eventos del backend (SSE)

    private func esNuestro(sesion id: String?, visores: [String]) -> Bool {
        guard let s = sesion else { return false }
        if let id, id != s.id { return false }
        return visores.isEmpty || visores.contains(visor)
    }

    /// - Parameter sintetico: el evento lo fabrica el sondeo de respaldo (sin SSE), no el servidor (`meta.synthetic`).
    public func procesar(_ evento: SSEEvent, sintetico: Bool = false) {
        guard fuente != nil else { return }
        switch evento {
        case .playbackHandoff(let datos):
            let mio = datos.viewerIds.contains(visor) || (datos.sessionId != nil && datos.sessionId == sesion?.id)
            if mio { traspaso() }
        case .streamReopened(let datos):
            guard esNuestro(sesion: datos.sessionId, visores: datos.viewerIds) else { return }
            reenganchar(
                datos.reason == .remuxRestart ? TextosReproductor.remuxReiniciado : TextosReproductor.motorReiniciado)
        case .streamModeChanged(let datos):
            // El remux de iOS sigue leyendo la sesión: si se rehace, llega `stream.reopened`.
            guard esNuestro(sesion: datos.sessionId, visores: datos.viewerIds), sesion?.protocolo != .hlsFmp4,
                datos.to != sesion?.protocolo
            else { return }
            reenganchar(datos.reason == .shared ? TextosReproductor.otroSeUne : TextosReproductor.vuelvesSolo)
        case .streamClosed(let datos):
            guard esNuestro(sesion: datos.sessionId, visores: datos.viewerIds) else { return }
            cerrada(datos)
        case .streamStats(let datos):
            if esNuestro(sesion: datos.sessionId, visores: datos.viewerIds) { estadisticas = datos }
        case .engineStatus(let estado):
            // Motor de vuelta con un canal esperando: se reengancha como recuperación (P13).
            guard esperandoMotor, estado.online, let f = fuente else { return }
            esperandoMotor = false
            notificar(TextosReproductor.motorDeVuelta(f.canal.titulo), icono: .motor)
            motivoParada = nil
            quiereReproducir = true
            transicion(.solicitar)
            conectar(recuperacion: f.empezoEn != nil)
            arrancarVigilante()
        case .playbackNowPlaying(let datos):
            // Sin SSE, el sondeo de respaldo avisa de cambios de mando: el latido confirma si nos han echado.
            guard sesion != nil, let ahora = datos.nowPlaying, let propio = dispositivoId, ahora.dev != propio else {
                return
            }
            Task { await self.latir() }
        default:
            break
        }
    }

    private func cerrada(_ datos: StreamClosedData) {
        switch datos.reason {
        case .released, .handoff:
            return
        case .revoked:
            olvidarSesion()
            fallarSistema(TextosReproductor.sinAcceso, motivo: .fallo, codigo: "device_revoked")
        case .expired:
            olvidarSesion()
            fallar(TextosReproductor.sesionCaducada)
        default:
            olvidarSesion()
            fallar(TextosReproductor.senalCortada, detalle: datos.code ?? datos.reason.rawValue)
        }
    }

    // MARK: Primer plano

    /// Vuelta a primer plano (`onForeground`): latido ya y, con el medio roto, reconexión limpia.
    public func volvioAPrimerPlano() {
        guard fuente != nil, conexion == .activa, !demo else { return }
        estadoConexion?.ticsParado = 0
        estadoConexion?.ultimaPosicion = motor.tiempoActual
        Task { await self.latir() }
        guard quiereReproducir else { return }
        if motor.estadoTiempo == .pausado { motor.reproducir() }
        // `readyState < 2` de la web: esperando datos sin nada por delante del cabezal.
        if motor.estadoTiempo == .esperando && !motor.probableSinCortes && motor.colchonPorDelante < 0.5 {
            fuente?.reconexiones = []
            fallar(TextosReproductor.reconectandoAlVolver)
        }
    }

    // MARK: Final de una fuente

    func terminarConexion() {
        tareaConexion?.cancel()
        tareaConexion = nil
        tareaReconexion?.cancel()
        tareaReconexion = nil
        tareaPausaAjena?.cancel()
        tareaPausaAjena = nil
        tareaMedidor?.cancel()
        tareaMedidor = nil
        tareaDemo?.cancel()
        tareaDemo = nil
        generacion += 1
        estadoConexion = nil
        motor.vaciar()
    }

    /// `endSource(porque)`: el resumen de la fuente una vez (si arrancó o reconectó alguna vez), la conexión
    /// fuera y la fuente olvidada. `porque == nil`: sin resumen (la fuente ya se había dado por perdida).
    func terminarFuente(porque: String?) {
        if let porque, let f = fuente, !f.metricasEnviadas, f.empezoEn != nil || f.reconexionesTotales > 0 {
            fuente?.metricasEnviadas = true
            informar(.client, codigo: "player_session", mensaje: "Fin de la reproducción (\(porque))")
        }
        terminarConexion()
        fuente = nil
    }

    // MARK: Resultados, diagnóstico y Recientes

    func enviarResultado(_ resultado: OutcomeResult, segundos: Int) {
        guard var f = fuente, !demo else { return }
        if resultado == .arranco {
            if f.arrancoEnviado { return }
            f.arrancoEnviado = true
            fuente = f
        }
        // Un `cayo` sin `arranco` antes no tiene sentido.
        if resultado == .cayo && !f.arrancoEnviado { return }
        let cuerpo = OutcomeBody(
            id: f.canal.id, resultado: resultado, segundos: resultado == .arranco ? nil : Double(segundos),
            title: String(f.canal.titulo.prefix(200)), listaId: f.canal.listaId.map { String($0.prefix(64)) },
            source: f.canal.fuente.map { String($0.prefix(60)) })
        let servicio = self.servicio
        Task { await servicio.resultado(cuerpo) }
    }

    func informar(_ causa: DiagnosticCause, codigo: String, mensaje: String) {
        guard let f = fuente, !demo else { return }
        let latencia = f.latencia.n > 0 ? (f.latencia.suma / Double(f.latencia.n) * 10).rounded() / 10 : nil
        let metricas = PlayerMetrics(
            timeToFirstFrameMs: f.ttffMs, rebuffers: f.rebuffers, reconnects: f.reconexionesTotales,
            liveLatencyS: latencia)
        let cuerpo = DiagnosticReportBody(
            cause: causa, code: codigo, message: String(mensaje.prefix(500)), hash: f.canal.id,
            channel: String((f.canal.partido?.canal ?? f.canal.titulo).prefix(120)), sessionId: sesion?.id,
            metrics: metricas)
        let servicio = self.servicio
        Task { await servicio.informar(cuerpo) }
    }

    /// `recordHistory`: apunta el canal en Recientes al pedirlo; la biblioteca que vuelve se escribe en la
    /// caché y un fallo avisa «No se pudo guardar el historial».
    func apuntarEnRecientes(_ canal: CanalReproducible) {
        let servicio = self.servicio
        Task {
            do {
                let biblioteca = try await servicio.guardarReciente(canal)
                self.alGuardarReciente?(biblioteca)
            } catch {
                if case .cancelado = APIError.desde(error) { return }
                self.notificar(TextosReproductor.noSePudoGuardarHistorial, clase: .accion, tono: .warn)
            }
        }
    }
}
