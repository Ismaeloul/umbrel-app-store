import AVFoundation
import Foundation

/// El motor de verdad: un `AVPlayer` con el HLS fMP4 del remux del backend.
///
/// No usa KVO: en Swift 6 los cierres de KVO heredan el actor principal y
/// AVFoundation los llama desde otros hilos. En su lugar sondea el estado
/// cada 250 ms (500 ms tras el primer fotograma) en el actor principal, que
/// es trabajo mínimo (leer cinco propiedades), y escucha las notificaciones
/// del elemento en la cola principal.
@MainActor
public final class MotorAVPlayer: MotorVideo {
    public var alEvento: ((EventoMotor) -> Void)?
    public let player: AVPlayer
    /// ¿La capa de vídeo ya pinta (`AVPlayerLayer.isReadyForDisplay`)? nil sin capa en pantalla (PiP,
    /// segundo plano, AirPlay): entonces basta con que el cabezal avance (a8 §3.11.7). Lo pone la presentación.
    var listoParaPintar: (@MainActor () -> Bool?)?
    public var avPlayer: AVPlayer? { player }

    private var item: AVPlayerItem?
    private var observadores: [NSObjectProtocol] = []
    private var sondeo: Task<Void, Never>?
    private var ultimoEstado: EstadoTiempo = .pausado
    private var avisadoListo = false
    private var avisadoFallo = false
    private var avisadoPrimerFotograma = false
    private var tiempoAlEmpezar: Double?

    public init() {
        player = AVPlayer()
        // AVPlayer espera a tener colchón antes de arrancar y tras un parón.
        player.automaticallyWaitsToMinimizeStalling = true
        // AirPlay de vídeo (no solo audio).
        player.allowsExternalPlayback = true
        player.preventsDisplaySleepDuringVideoPlayback = true
    }

    // MARK: Estado

    public var estadoTiempo: EstadoTiempo {
        switch player.timeControlStatus {
        case .playing: .reproduciendo
        case .waitingToPlayAtSpecifiedRate: .esperando
        case .paused: .pausado
        @unknown default: .pausado
        }
    }

    public var probableSinCortes: Bool { item?.isPlaybackLikelyToKeepUp ?? false }

    public var tiempoActual: Double {
        let segundos = player.currentTime().seconds
        return segundos.isFinite ? segundos : 0
    }

    public var ventana: VentanaDirecto? {
        guard let item else { return nil }
        let tramos = item.seekableTimeRanges.map { valor -> (inicio: Double, fin: Double) in
            let rango = valor.timeRangeValue
            return (rango.start.seconds, rango.end.seconds)
        }
        return VentanaDirecto.elegir(tramos: tramos, actual: tiempoActual)
    }

    public var colchonPorDelante: Double {
        guard let item else { return 0 }
        let t = tiempoActual
        for valor in item.loadedTimeRanges {
            let rango = valor.timeRangeValue
            let inicio = rango.start.seconds
            let fin = rango.end.seconds
            if inicio.isFinite, fin.isFinite, t >= inicio - 0.5, t <= fin { return max(0, fin - t) }
        }
        return 0
    }

    // MARK: Órdenes

    public func cargar(url: URL, perfil: IosPlaybackProfile) {
        quitarElemento()
        let nuevo = AVPlayerItem(url: url)
        configurar(nuevo, perfil: perfil)
        item = nuevo
        avisadoListo = false
        avisadoFallo = false
        avisadoPrimerFotograma = false
        tiempoAlEmpezar = nil
        ultimoEstado = .pausado
        observar(nuevo)
        player.replaceCurrentItem(with: nuevo)
        arrancarSondeo()
    }

    public func aplicar(perfil: IosPlaybackProfile) {
        guard let item else { return }
        configurar(item, perfil: perfil)
    }

    public func reproducir() {
        player.play()
    }

    public func pausar() {
        player.pause()
    }

    public func saltar(a segundos: Double) async -> Bool {
        guard item != nil, segundos.isFinite else { return false }
        let destino = CMTime(seconds: segundos, preferredTimescale: 600)
        let margen = CMTime(seconds: 0.5, preferredTimescale: 600)
        // Versión con cierre: la `async` de AVPlayer cruzaría el actor con un objeto no Sendable.
        return await withCheckedContinuation { continuacion in
            player.seek(to: destino, toleranceBefore: margen, toleranceAfter: margen) { terminado in
                continuacion.resume(returning: terminado)
            }
        }
    }

    public func vaciar() {
        quitarElemento()
        player.replaceCurrentItem(with: nil)
    }

    public func silenciar(_ silencio: Bool) {
        player.isMuted = silencio
    }

    // MARK: Interno

    private func configurar(_ item: AVPlayerItem, perfil: IosPlaybackProfile) {
        // Colchón por delante según el modo (Baja latencia 4 s, Equilibrado 8 s, Estable 12 s).
        item.preferredForwardBufferDuration = perfil.preferredForwardBufferDuration
        // Distancia al borde del directo: arranca unos segundos por detrás en vez de pegado.
        item.configuredTimeOffsetFromLive = CMTime(seconds: perfil.liveEdgeOffsetS, preferredTimescale: 600)
        // Tras un parón largo, AVPlayer avanza solo para mantener esa distancia.
        item.automaticallyPreservesTimeOffsetFromLive = true
    }

    private func quitarElemento() {
        sondeo?.cancel()
        sondeo = nil
        for observador in observadores { NotificationCenter.default.removeObserver(observador) }
        observadores = []
        item = nil
    }

    private func observar(_ item: AVPlayerItem) {
        let centro = NotificationCenter.default
        observadores = [
            centro.addObserver(
                forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main
            ) { [weak self] aviso in
                let error = aviso.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? NSError
                let mensaje = error?.localizedDescription ?? "El vídeo se ha interrumpido"
                MainActor.assumeIsolated { self?.fallo(mensaje) }
            },
            centro.addObserver(
                forName: AVPlayerItem.playbackStalledNotification, object: item, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.emitir(.atasco) }
            },
        ]
    }

    private func arrancarSondeo() {
        sondeo?.cancel()
        sondeo = Task { [weak self] in
            while !Task.isCancelled {
                let rapido = self?.avisadoPrimerFotograma == false
                try? await Task.sleep(for: .milliseconds(rapido ? 250 : 500))
                guard !Task.isCancelled, let self else { return }
                self.sondear()
            }
        }
    }

    private func sondear() {
        guard let item else { return }
        switch item.status {
        case .failed:
            fallo(item.error?.localizedDescription ?? "No se pudo abrir el vídeo")
            return
        case .readyToPlay:
            if !avisadoListo {
                avisadoListo = true
                emitir(.listo)
            }
        default:
            break
        }
        let estado = estadoTiempo
        if estado != ultimoEstado {
            ultimoEstado = estado
            emitir(.estado(estado))
        }
        // Primer fotograma (a8 §3.11.7): la capa ya pinta, el reproductor está en marcha y el cabezal avanzó
        // 0,05 s desde que empezó a reproducir (el respaldo de la web sin requestVideoFrameCallback).
        if !avisadoPrimerFotograma, estado == .reproduciendo {
            let t = tiempoActual
            if let inicio = tiempoAlEmpezar {
                let pinta = listoParaPintar?() ?? true
                if pinta && t - inicio >= Self.avancePrimerFotograma {
                    avisadoPrimerFotograma = true
                    emitir(.primerFotograma)
                }
            } else {
                tiempoAlEmpezar = t
            }
        }
    }

    /// Avance del cabezal que cuenta como primer fotograma (runtime.ts › watchFirstFrame: 0,05 s).
    static let avancePrimerFotograma = 0.05

    private func fallo(_ mensaje: String) {
        guard !avisadoFallo, item != nil else { return }
        avisadoFallo = true
        emitir(.fallo(mensaje))
    }

    private func emitir(_ evento: EventoMotor) {
        alEvento?(evento)
    }
}
