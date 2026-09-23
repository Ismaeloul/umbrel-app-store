import AVFoundation
import MediaPlayer
import UIKit

/// Lo que el sistema tiene que saber de la reproducción:
///
/// - `AVAudioSession` en `.playback` (suena con el silenciador y sigue en
///   segundo plano y en PiP), con las interrupciones (llamadas, Siri) y los
///   cambios de ruta (auriculares desconectados → pausa).
/// - `MPNowPlayingInfoCenter`: canal, partido y competición en la pantalla de
///   bloqueo y el Centro de Control, marcado como directo.
/// - `MPRemoteCommandCenter`: reproducir, pausa y canal anterior/siguiente.
@MainActor
public final class ControlesSistema: ControlesDelSistema {
    private weak var reproductor: Reproductor?
    private var observadores: [NSObjectProtocol] = []
    private var comandosRegistrados = false
    private var sesionActiva = false
    private var ultimoInfo: [String: String] = [:]

    public init() {}

    /// Engancha el reproductor: comandos remotos y avisos de la sesión de audio.
    public func conectar(_ reproductor: Reproductor) {
        self.reproductor = reproductor
        reproductor.sistema = self
        observarSesionDeAudio()
    }

    // MARK: ControlesDelSistema

    public func empezo(_ canal: CanalReproducible) {
        activarSesion()
        registrarComandos()
        publicar(canal: canal, reproduciendo: false)
    }

    public func cambio(_ reproductor: Reproductor) {
        guard let canal = reproductor.canal else { return }
        publicar(canal: canal, reproduciendo: reproductor.medio == .reproduciendo)
        let comandos = MPRemoteCommandCenter.shared()
        let conLista = reproductor.lista.count > 1
        comandos.nextTrackCommand.isEnabled = conLista
        comandos.previousTrackCommand.isEnabled = conLista
    }

    public func termino() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        ultimoInfo = [:]
        desactivarSesion()
    }

    // MARK: Sesión de audio

    private func activarSesion() {
        guard !sesionActiva else { return }
        let sesion = AVAudioSession.sharedInstance()
        do {
            try sesion.setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo)
            try sesion.setActive(true)
            sesionActiva = true
        } catch {
            // Sin sesión de audio el vídeo se ve igual; solo no sonaría con el silenciador.
            try? sesion.setCategory(.playback, mode: .moviePlayback)
        }
    }

    private func desactivarSesion() {
        guard sesionActiva else { return }
        sesionActiva = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func observarSesionDeAudio() {
        guard observadores.isEmpty else { return }
        let centro = NotificationCenter.default
        observadores.append(
            centro.addObserver(
                forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
            ) { [weak self] aviso in
                let tipo = (aviso.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                    .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
                let opciones = (aviso.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                    .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
                let empieza = tipo == .began
                let reanudar = opciones.contains(.shouldResume)
                MainActor.assumeIsolated { self?.interrupcion(empieza: empieza, reanudar: reanudar) }
            })
        observadores.append(
            centro.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
            ) { [weak self] aviso in
                let motivo = (aviso.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt)
                    .flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
                // Auriculares o altavoz Bluetooth desconectados: pausa (como el resto del sistema).
                guard motivo == .oldDeviceUnavailable else { return }
                MainActor.assumeIsolated { self?.reproductor?.pausaDelSistema() }
            })
    }

    private func interrupcion(empieza: Bool, reanudar: Bool) {
        guard let reproductor else { return }
        if empieza {
            reproductor.pausaDelSistema()
        } else {
            sesionActiva = false
            activarSesion()
            reproductor.finDeInterrupcion(reanudar: reanudar)
        }
    }

    // MARK: Now Playing

    private func publicar(canal: CanalReproducible, reproduciendo: Bool) {
        let centro = MPNowPlayingInfoCenter.default()
        let titulo = canal.partido?.titulo ?? canal.titulo
        let artista = canal.partido != nil ? canal.titulo : "Ace Neo"
        let album = canal.partido?.competicion ?? "En directo"
        let clave = ["t": titulo, "a": artista, "b": album]
        if clave != ultimoInfo || centro.nowPlayingInfo == nil {
            ultimoInfo = clave
            var info: [String: Any] = [
                MPMediaItemPropertyTitle: titulo,
                MPMediaItemPropertyArtist: artista,
                MPMediaItemPropertyAlbumTitle: album,
                MPNowPlayingInfoPropertyIsLiveStream: true,
                MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue,
            ]
            if let imagen = UIImage(named: "Marca") {
                info[MPMediaItemPropertyArtwork] = Self.caratula(imagen)
            }
            info[MPNowPlayingInfoPropertyPlaybackRate] = reproduciendo ? 1.0 : 0.0
            centro.nowPlayingInfo = info
        } else {
            centro.nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] = reproduciendo ? 1.0 : 0.0
        }
    }

    /// Fuera del actor principal: el sistema pide la imagen desde otro hilo.
    private nonisolated static func caratula(_ imagen: UIImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: imagen.size) { _ in imagen }
    }

    // MARK: Comandos remotos

    private func registrarComandos() {
        guard !comandosRegistrados else { return }
        comandosRegistrados = true
        let comandos = MPRemoteCommandCenter.shared()
        comandos.playCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.reproductor?.reanudar() }
            return .success
        }
        comandos.pauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.reproductor?.pausar() }
            return .success
        }
        comandos.togglePlayPauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.reproductor?.alternar() }
            return .success
        }
        comandos.nextTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.reproductor?.cambiarCanal(1) }
            return .success
        }
        comandos.previousTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.reproductor?.cambiarCanal(-1) }
            return .success
        }
        // En directo no hay avance ni barra que arrastrar.
        comandos.changePlaybackPositionCommand.isEnabled = false
        comandos.skipForwardCommand.isEnabled = false
        comandos.skipBackwardCommand.isEnabled = false
    }
}
