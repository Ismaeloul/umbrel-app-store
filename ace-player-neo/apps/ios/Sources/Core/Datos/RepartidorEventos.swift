import Foundation

/* Reparte los eventos del SSE (b-arquitectura §2.5.3, I0→M1; a7 §6.3-§6.4, api/sse.ts): aplica
   `EfectosEvento.de(_:visor:)` (puro) a cada dueño y lleva el sondeo de respaldo mientras el tiempo real
   está en `.respaldo` (cada 5 s la reproducción y cada 20 s el motor, solo las consultas que alguien
   mira y con la app activa; si cambia `nowPlaying`, un `playback.nowPlaying` sintético).
   También une las piezas de datos entre sí al crearse (sesión ↔ datos ↔ tiempo real ↔ versión), para
   que `ContenedorApp` solo tenga que crearlas. */

@MainActor final class RepartidorEventos {
    private let datos: DatosApp
    private let tiempoReal: TiempoReal
    private let sesion: SesionApp
    private let reproductor: Reproductor
    private let fuentes: SesionFuentes
    private let senales: SenalPartidos
    private let avisos: Avisos
    private let cicloVida: CicloVida
    private var oyentes: [Int: (SSEEvent) -> Void] = [:]
    private var siguienteOyente = 1
    private var sondeo: Task<Void, Never>?
    let vigiaVersion: VigiaVersion

    /// `FALLBACK_PLAYBACK_MS` y `FALLBACK_ENGINE_MS` (api/sse.ts).
    static let sondeoReproduccion: Duration = .seconds(EsperaSSE.sondeoReproduccion)
    static let ticsPorSondeoMotor = Int(EsperaSSE.sondeoMotor / EsperaSSE.sondeoReproduccion)  // 20 s = 4 × 5 s

    init(
        datos: DatosApp, tiempoReal: TiempoReal, sesion: SesionApp, reproductor: Reproductor, fuentes: SesionFuentes,
        senales: SenalPartidos, avisos: Avisos, cicloVida: CicloVida
    ) {
        self.datos = datos
        self.tiempoReal = tiempoReal
        self.sesion = sesion
        self.reproductor = reproductor
        self.fuentes = fuentes
        self.senales = senales
        self.avisos = avisos
        self.cicloVida = cicloVida
        vigiaVersion = VigiaVersion(api: sesion.entorno.api, avisos: avisos)
        unir()
    }

    /// Las piezas de datos entre sí (§2.5.7 punto 6 y lo que no cablea `ContenedorApp`).
    private func unir() {
        let sesion = self.sesion
        let datos = self.datos
        let avisos = self.avisos
        let vigia = vigiaVersion
        sesion.conectar(datos: datos, tiempoReal: tiempoReal)
        sesion.vigiaVersion = vigia
        let senales = self.senales
        sesion.alOlvidarServidor = { [weak senales, weak vigia] in
            senales?.vaciar()
            vigia?.olvidarBase()
        }
        sesion.alAvisar = { [weak avisos] aviso in
            avisos?.avisar(aviso.texto, tono: aviso.tono, icono: aviso.icono, duracion: aviso.duracion)
        }
        datos.alFallarAdministracion = { [weak sesion] error, ruta in sesion?.anotar(error, en: ruta) }
        datos.alAbrirAdministracion = { [weak sesion] ruta in sesion?.anotarExito(en: ruta) }
        datos.alLlegarArranque = { [weak sesion, weak vigia] arranque in
            sesion?.arranqueRecibido(arranque)
            vigia?.leida(arranque.version)
        }
        vigia.alCambiar = { [weak sesion, weak datos] version in
            sesion?.versionCambiada(version)
            datos?.invalidarTodo()
        }
        tiempoReal.alCambiarEstado = { [weak self] estado in self?.cambioDeEstado(estado) }
        tiempoReal.alAbrirTrasCorte = { [weak self] in self?.trasCorte() }
        tiempoReal.alConectar = { [weak sesion] servidor in sesion?.conectado(a: servidor) }
    }

    /// Engancha el tiempo real (si nadie lo ha hecho) y deja el estado de las consultas al día.
    func arrancar() {
        if tiempoReal.alEvento == nil { tiempoReal.alEvento = { [weak self] evento in self?.aplicar(evento) } }
        cambioDeEstado(tiempoReal.estado)
    }

    func parar() {
        pararSondeo()
    }

    /// EfectosEvento.de(evento) → a cada dueño. Un evento dirigido a otro visor no llega a nadie.
    func aplicar(_ evento: SSEEvent) {
        guard EfectosEvento.esParaEsteVisor(evento, visor: reproductor.visor) else { return }
        for efecto in EfectosEvento.de(evento) { ejecutar(efecto) }
        for oyente in oyentes.values { oyente(evento) }
    }

    func escuchar(_ oyente: @escaping (SSEEvent) -> Void) -> Int {
        let id = siguienteOyente
        siguienteOyente += 1
        oyentes[id] = oyente
        return id
    }

    func dejarDeEscuchar(_ id: Int) { oyentes[id] = nil }

    // MARK: Efectos

    private func ejecutar(_ efecto: EfectoEvento) {
        switch efecto {
        case .invalidar(let rutas):
            datos.invalidar(rutas)
        case .invalidarTodo:
            datos.invalidarTodo()
        case .escribirMotor(let estado):
            datos.motor.escribir(estado)
        case .escribirSonando(let sonando, let aprendidos):
            datos.reproduccion.modificar { estado in
                estado.nowPlaying = sonando
                estado.learningCount = aprendidos
            }
        case .escribirSesiones(let sesiones):
            datos.reproduccion.modificar { $0.sessions = sesiones }
        case .trabajo(let id):
            datos.trabajos[id]?.invalidar()
        case .senalPartido(let progreso):
            let ahora: Date = senales.reloj.ahora  // en su línea: tipado en 237 ms (CI 36230463114)
            senales.anotar(progreso, ahora: ahora)
            let evento: SSEEvent = SSEEvent.scanProgress(progreso)  // tipo explícito: 220 ms en CI 36241843368
            fuentes.procesar(evento)
        case .veredicto(let veredicto):
            let evento: SSEEvent = SSEEvent.scanVerdict(veredicto)
            fuentes.procesar(evento)
        case .dispositivos(let cambio):
            revocadoDesdeOtro(cambio)
        case .alReproductor(let evento):
            reproductor.procesar(evento)
        case .versionPosible:
            let vigia = vigiaVersion
            Task { await vigia.revisar(motivo: "resync") }
        }
    }

    /// `devices.changed revoked` con el id propio y sin haberlo pedido = fuera (a9 §3.5.3, a2 §23.4).
    private func revocadoDesdeOtro(_ cambio: DevicesChangedData) {
        guard cambio.reason == .revoked, cambio.deviceId == sesion.dispositivo, !sesion.olvidando else { return }
        let sesion = self.sesion
        Task { await sesion.accesoPerdido(.revocadoDesdeOtro) }
    }

    // MARK: Respaldo

    private func cambioDeEstado(_ estado: EstadoTiempoReal) {
        datos.tiempoRealAbierto = estado == .abierto
        if estado == .respaldo { empezarSondeo() } else { pararSondeo() }
    }

    /// Tras un corte se pudo perder algo: se refresca lo que cambia solo (y la versión, a7 §5.2).
    private func trasCorte() {
        datos.invalidar(EfectosEvento.trasCorte)
        let vigia = vigiaVersion
        Task { await vigia.revisar(motivo: "reconexión") }
    }

    private func empezarSondeo() {
        guard sondeo == nil else { return }
        sondeo = Task { [weak self] in
            var tic = 0
            await self?.sondearReproduccion()
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.sondeoReproduccion)
                guard !Task.isCancelled, let self else { return }
                tic += 1
                guard self.cicloVida.fase == .activa else { continue }
                await self.sondearReproduccion()
                if tic % Self.ticsPorSondeoMotor == 0, self.datos.motor.observadores > 0 {
                    await self.datos.motor.refrescar()
                }
            }
        }
    }

    private func pararSondeo() {
        sondeo?.cancel()
        sondeo = nil
    }

    /// `pollPlayback`: vuelve a pedir la reproducción si alguien la mira y avisa si cambió lo que suena.
    private func sondearReproduccion() async {
        let consulta = datos.reproduccion
        guard consulta.observadores > 0 else { return }
        let antes = consulta.datos?.nowPlaying
        let habia = consulta.datos != nil
        await consulta.refrescar()
        guard habia, let ahora = consulta.datos, ahora.nowPlaying != antes else { return }
        let sintetico = SSEEvent.playbackNowPlaying(
            PlaybackNowPlayingData(nowPlaying: ahora.nowPlaying, learningCount: ahora.learningCount))
        reproductor.procesar(sintetico, sintetico: true)
        for oyente in oyentes.values { oyente(sintetico) }
    }
}
