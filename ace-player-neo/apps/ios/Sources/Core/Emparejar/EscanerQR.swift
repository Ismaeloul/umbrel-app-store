import AVFoundation
import SwiftUI
import UIKit

// Rescatado en la poda (fase 0.2, b-arquitectura §1.11) de `QRScannerView`
// (Features/Pairing/QRScannerView.swift), sin cambiar el comportamiento. M7 lo convierte en la cámara
// embebida (rectOfInterest, RotationCoordinator, interrupciones; §1.12).

/// Lector de QR con AVFoundation (sin dependencias). Llama a `alLeer` con el
/// texto de cada QR distinto que ve; si devuelve true, deja de leer.
struct EscanerQR: UIViewControllerRepresentable {
    let alLeer: @MainActor (String) -> Bool
    let alFallar: @MainActor (String) -> Void

    func makeUIViewController(context: Context) -> ControladorEscanerQR {
        let controlador = ControladorEscanerQR()
        controlador.alLeer = alLeer
        controlador.alFallar = alFallar
        return controlador
    }

    func updateUIViewController(_ controlador: ControladorEscanerQR, context: Context) {}
}

/// Sesión de captura fuera del hilo principal (`startRunning` bloquea).
private final class CajaSesion: @unchecked Sendable {  // permitido: AVCaptureSession no es Sendable; solo se arranca y para en `cola`
    // AVCaptureSession es segura entre hilos para arrancar y parar; solo se
    // toca desde la cola `cola`, salvo al configurarla antes de arrancar.
    let sesion = AVCaptureSession()
    let cola = DispatchQueue(label: "es.ismaeloul.aceplayerneo.camara")  // permitido: startRunning bloquea; fuera del hilo principal

    func arrancar() {
        cola.async {
            if !self.sesion.isRunning { self.sesion.startRunning() }
        }
    }

    func parar() {
        cola.async {
            if self.sesion.isRunning { self.sesion.stopRunning() }
        }
    }
}

final class ControladorEscanerQR: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var alLeer: (@MainActor (String) -> Bool)?
    var alFallar: (@MainActor (String) -> Void)?

    private let caja = CajaSesion()
    private var capa: AVCaptureVideoPreviewLayer?
    private var ultimoLeido: String?
    private var terminado = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        Task { await prepararCamara() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        capa?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        caja.parar()
    }

    private func prepararCamara() async {
        let permitido: Bool
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            permitido = true
        case .notDetermined:
            permitido = await AVCaptureDevice.requestAccess(for: .video)
        default:
            permitido = false
        }
        guard permitido else {
            alFallar?("Ace Neo no tiene permiso para usar la cámara. Actívalo en Ajustes → Ace Neo, o teclea el código.")
            return
        }
        guard let camara = AVCaptureDevice.default(for: .video),
            let entrada = try? AVCaptureDeviceInput(device: camara),
            caja.sesion.canAddInput(entrada)
        else {
            alFallar?("La cámara no está disponible en este dispositivo. Teclea la dirección y el código.")
            return
        }
        let salida = AVCaptureMetadataOutput()
        caja.sesion.beginConfiguration()
        caja.sesion.addInput(entrada)
        guard caja.sesion.canAddOutput(salida) else {
            caja.sesion.commitConfiguration()
            alFallar?("No se puede leer códigos QR con esta cámara.")
            return
        }
        caja.sesion.addOutput(salida)
        salida.setMetadataObjectsDelegate(self, queue: .main)
        salida.metadataObjectTypes = [.qr]
        caja.sesion.commitConfiguration()

        let capa = AVCaptureVideoPreviewLayer(session: caja.sesion)
        capa.videoGravity = .resizeAspectFill
        capa.frame = view.bounds
        view.layer.addSublayer(capa)
        self.capa = capa
        caja.arrancar()
    }

    // La cola del delegado es la principal (`queue: .main`).
    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        let texto = metadataObjects.lazy
            .compactMap { ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }
            .first
        guard let texto else { return }
        MainActor.assumeIsolated {  // permitido: el delegado va en la cola principal (`queue: .main`)
            self.procesar(texto)
        }
    }

    /// La háptica de éxito y de error (antes `UINotificationFeedbackGenerator` aquí) la pone M7 con `Haptica`
    /// (a1 §8.1): la regla R8 del linter solo deja vibrar por ahí. Hasta entonces nadie usa este escáner.
    private func procesar(_ texto: String) {
        guard !terminado, texto != ultimoLeido else { return }
        ultimoLeido = texto
        if alLeer?(texto) == true {
            terminado = true
            caja.parar()
        }
    }
}
