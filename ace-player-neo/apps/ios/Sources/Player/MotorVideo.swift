import AVFoundation
import Foundation

/* El motor de vídeo detrás de un protocolo: en la app es AVPlayer
   (`MotorAVPlayer`); en los tests, uno falso que se maneja a mano; en las
   pruebas de interfaz, uno simulado que «reproduce» sin red. El
   `Reproductor` solo habla con esto, así su máquina de estados se prueba
   entera sin vídeo de verdad. */

/// `timeControlStatus` de AVPlayer.
public enum EstadoTiempo: String, Sendable, Hashable {
    case pausado
    /// Esperando datos para seguir (`waitingToPlayAtSpecifiedRate`).
    case esperando
    case reproduciendo
}

/// Lo que cuenta el motor.
public enum EventoMotor: Sendable, Hashable {
    /// El elemento está listo para reproducir (`readyToPlay`).
    case listo
    /// El cabezal ha empezado a avanzar de verdad (primer fotograma).
    case primerFotograma
    /// Cambió `timeControlStatus`.
    case estado(EstadoTiempo)
    /// `AVPlayerItemPlaybackStalled`: se ha quedado sin datos.
    case atasco
    /// El elemento ha fallado (`status == .failed` o `AVPlayerItemFailedToPlayToEndTime`).
    case fallo(String)
}

@MainActor
public protocol MotorVideo: AnyObject {
    /// Quien escucha (el `Reproductor`).
    var alEvento: ((EventoMotor) -> Void)? { get set }
    var estadoTiempo: EstadoTiempo { get }
    /// `isPlaybackLikelyToKeepUp`.
    var probableSinCortes: Bool { get }
    /// Cabezal, en segundos.
    var tiempoActual: Double { get }
    /// Ventana del directo (`seekableTimeRanges`).
    var ventana: VentanaDirecto? { get }
    /// Segundos ya descargados por delante del cabezal (`loadedTimeRanges`).
    var colchonPorDelante: Double { get }
    /// El AVPlayer de verdad para pintarlo en una capa (nil en los falsos).
    var avPlayer: AVPlayer? { get }

    /// Carga una URL nueva (sustituye la anterior) con el perfil del modo.
    func cargar(url: URL, perfil: IosPlaybackProfile)
    /// Cambia el colchón y la distancia al directo sin reconectar.
    func aplicar(perfil: IosPlaybackProfile)
    func reproducir()
    func pausar()
    /// Salta a un punto; `true` si llegó.
    func saltar(a segundos: Double) async -> Bool
    /// Suelta el elemento actual (sin reproducción).
    func vaciar()
}
