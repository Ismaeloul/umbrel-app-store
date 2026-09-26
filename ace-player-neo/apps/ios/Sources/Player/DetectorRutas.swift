import AVFoundation
import AVKit
import Observation

/// ¿Hay a dónde mandar el vídeo por AirPlay? (decisión 6, b2 D.6): el botón de AirPlay de la cápsula
/// `[Directo · AirPlay · pantalla completa]` solo se enseña con `AVRouteDetector.multipleRoutesDetected`. Se
/// entera por la notificación del detector (sin KVO). Buscar rutas gasta batería: solo mientras el teatro está
/// a la vista (`activar()` / `desactivar()` los llama la pantalla del partido).
@MainActor
@Observable
final class DetectorRutas {
    private(set) var hayRutas = false

    @ObservationIgnored private let detector = AVRouteDetector()
    @ObservationIgnored private var observador: NSObjectProtocol?
    @ObservationIgnored private var usos = 0

    init() {}

    /// Empieza a buscar rutas (cuenta los usos: dos pantallas a la vez no se pisan).
    func activar() {
        usos += 1
        guard usos == 1 else { return }
        detector.isRouteDetectionEnabled = true
        observador = NotificationCenter.default.addObserver(
            forName: .AVRouteDetectorMultipleRoutesDetectedDidChange, object: detector, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.leer() }
        }
        leer()
    }

    func desactivar() {
        guard usos > 0 else { return }
        usos -= 1
        guard usos == 0 else { return }
        detector.isRouteDetectionEnabled = false
        if let observador { NotificationCenter.default.removeObserver(observador) }
        observador = nil
    }

    private func leer() {
        let hay = detector.multipleRoutesDetected
        if hay != hayRutas { hayRutas = hay }
    }
}
