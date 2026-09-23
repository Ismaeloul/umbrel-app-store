import AVFoundation
import AVKit
import Observation
import SwiftUI
import UIKit

// MARK: - Capa de vídeo

/// Vista de UIKit cuya capa ES un `AVPlayerLayer` (así se redimensiona sola).
public final class CapaVideoUIView: UIView {
    override public class var layerClass: AnyClass { AVPlayerLayer.self }

    public var capa: AVPlayerLayer {
        // swiftlint:disable:next force_cast
        layer as! AVPlayerLayer
    }

    weak var gestor: GestorPiP?
}

/// El vídeo del reproductor en SwiftUI. Registra su capa en el gestor de PiP
/// para que el PiP (manual y automático al salir de la app) salga de la
/// superficie que se está viendo.
public struct VistaVideo: UIViewRepresentable {
    let player: AVPlayer?
    let pip: GestorPiP?
    var gravedad: AVLayerVideoGravity = .resizeAspect

    public init(player: AVPlayer?, pip: GestorPiP?, gravedad: AVLayerVideoGravity = .resizeAspect) {
        self.player = player
        self.pip = pip
        self.gravedad = gravedad
    }

    public func makeUIView(context: Context) -> CapaVideoUIView {
        let vista = CapaVideoUIView()
        vista.backgroundColor = .black
        vista.isAccessibilityElement = false
        vista.capa.videoGravity = gravedad
        vista.capa.player = player
        vista.gestor = pip
        pip?.registrar(vista.capa)
        return vista
    }

    public func updateUIView(_ vista: CapaVideoUIView, context: Context) {
        if vista.capa.player !== player { vista.capa.player = player }
        if vista.capa.videoGravity != gravedad { vista.capa.videoGravity = gravedad }
    }

    public static func dismantleUIView(_ vista: CapaVideoUIView, coordinator: Coordinator) {
        vista.gestor?.olvidar(vista.capa)
    }
}

// MARK: - Picture in Picture

/// PiP con `AVPictureInPictureController`: botón, arranque automático al
/// salir de la app (`canStartPictureInPictureAutomaticallyFromInline`) y
/// restaurar la interfaz al volver.
@MainActor
@Observable
public final class GestorPiP {
    public private(set) var activo = false
    public let soportado: Bool

    /// Qué hacer al volver del PiP (enseñar el reproductor).
    @ObservationIgnored public var alRestaurar: (() -> Void)?

    @ObservationIgnored private var controlador: AVPictureInPictureController?
    @ObservationIgnored private var capas: [Caja] = []
    private let delegado = DelegadoPiP()

    private final class Caja {
        weak var capa: AVPlayerLayer?
        init(_ capa: AVPlayerLayer) { self.capa = capa }
    }

    public init() {
        soportado = AVPictureInPictureController.isPictureInPictureSupported()
        delegado.alEmpezar = { [weak self] in self?.activo = true }
        delegado.alTerminar = { [weak self] in self?.activo = false }
        delegado.alRestaurar = { [weak self] in self?.alRestaurar?() }
    }

    /// El PiP se puede abrir ahora mismo.
    public var posible: Bool { controlador?.isPictureInPicturePossible ?? false }

    /// Una superficie aparece: pasa a ser la fuente del PiP.
    public func registrar(_ capa: AVPlayerLayer) {
        capas.removeAll { $0.capa == nil || $0.capa === capa }
        capas.append(Caja(capa))
        apuntar()
    }

    /// Una superficie desaparece: el PiP vuelve a la anterior que siga viva.
    public func olvidar(_ capa: AVPlayerLayer) {
        capas.removeAll { $0.capa == nil || $0.capa === capa }
        apuntar()
    }

    public func alternar() {
        guard let controlador else { return }
        if controlador.isPictureInPictureActive {
            controlador.stopPictureInPicture()
        } else {
            controlador.startPictureInPicture()
        }
    }

    public func cerrar() {
        controlador?.stopPictureInPicture()
    }

    /// Sin PiP, al pasar a segundo plano la capa se suelta del reproductor
    /// para que el audio siga (si no, iOS pausa el vídeo); al volver se engancha.
    public func soltarCapas(_ soltar: Bool, player: AVPlayer?) {
        guard !activo else { return }
        for caja in capas { caja.capa?.player = soltar ? nil : player }
    }

    private func apuntar() {
        guard soportado, !activo else { return }
        guard let capa = capas.last?.capa else {
            controlador = nil
            return
        }
        if controlador?.playerLayer === capa { return }
        let nuevo: AVPictureInPictureController? = AVPictureInPictureController(playerLayer: capa)
        nuevo?.delegate = delegado
        nuevo?.canStartPictureInPictureAutomaticallyFromInline = true
        controlador = nuevo
    }
}

/// Delegado del PiP: los avisos llegan en el hilo principal.
@MainActor
final class DelegadoPiP: NSObject, AVPictureInPictureControllerDelegate {
    var alEmpezar: (() -> Void)?
    var alTerminar: (() -> Void)?
    var alRestaurar: (() -> Void)?

    nonisolated func pictureInPictureControllerDidStartPictureInPicture(
        _ pictureInPictureController: AVPictureInPictureController
    ) {
        MainActor.assumeIsolated { self.alEmpezar?() }
    }

    nonisolated func pictureInPictureControllerDidStopPictureInPicture(
        _ pictureInPictureController: AVPictureInPictureController
    ) {
        MainActor.assumeIsolated { self.alTerminar?() }
    }

    nonisolated func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: any Error
    ) {
        MainActor.assumeIsolated { self.alTerminar?() }
    }

    nonisolated func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        MainActor.assumeIsolated { self.alRestaurar?() }
        completionHandler(true)
    }
}

// MARK: - AirPlay

/// Botón de AirPlay del sistema (`AVRoutePickerView`).
public struct BotonAirPlay: UIViewRepresentable {
    public init() {}

    public func makeUIView(context: Context) -> AVRoutePickerView {
        let vista = AVRoutePickerView()
        vista.prioritizesVideoDevices = true
        vista.tintColor = .white
        vista.activeTintColor = UIColor(named: "Accent") ?? .systemBlue
        vista.accessibilityLabel = "AirPlay"
        return vista
    }

    public func updateUIView(_ vista: AVRoutePickerView, context: Context) {}
}

// MARK: - Orientación

/// Pide al sistema girar a horizontal (pantalla completa) o volver a vertical.
@MainActor
public enum Orientacion {
    public static func pedir(_ mascara: UIInterfaceOrientationMask) {
        let escenas = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let escena = escenas.first(where: { $0.activationState == .foregroundActive }) ?? escenas.first else {
            return
        }
        escena.requestGeometryUpdate(.iOS(interfaceOrientations: mascara)) { _ in }
        escena.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
    }
}
