import AVFoundation
import SwiftUI
import UIKit

/* La cámara del cartel de emparejar (a2 §22.3, §27.3; b-arquitectura §1.12): embebida (no en hoja), con la
   imagen a sangre (`resizeAspectFill`), lectura solo dentro de la ventana ampliada 24 pt por lado
   (`rectOfInterest`), giro con `AVCaptureDevice.RotationCoordinator`, aviso cuando otra app se queda la
   cámara (interrupciones) y parada al leer, al ir a segundo plano y al salir de la pantalla. De
   `QRScannerView` (rescatado en la poda). La háptica y los textos los pone el modelo (ModeloEmparejar). */

/// Lo que sabe la cámara (el modelo lo convierte en `EstadoCamara`).
enum EstadoCaptura: Equatable, Sendable {
    case preparando, activa, ocupada, sinPermiso, restringida, sinCamara
}

/// La cámara embebida. `activo` = debe estar leyendo; `ventana` = la ventana del marco en coordenadas de
/// esta vista; `recomprobar` cambia al volver a la app (se mira otra vez el permiso).
struct EscanerQR: UIViewControllerRepresentable {
    var activo: Bool
    var ventana: CGRect
    var recomprobar: Int
    let alCambiar: @MainActor (EstadoCaptura) -> Void
    let alPrimeraImagen: @MainActor () -> Void
    let alLeer: @MainActor (String) -> Bool

    func makeUIViewController(context: Context) -> ControladorEscanerQR {
        let controlador = ControladorEscanerQR()
        controlador.alCambiar = alCambiar
        controlador.alPrimeraImagen = alPrimeraImagen
        controlador.alLeer = alLeer
        controlador.ventana = ventana
        controlador.quiereLeer = activo
        controlador.intento = recomprobar
        return controlador
    }

    func updateUIViewController(_ controlador: ControladorEscanerQR, context: Context) {
        controlador.alCambiar = alCambiar
        controlador.alPrimeraImagen = alPrimeraImagen
        controlador.alLeer = alLeer
        if controlador.ventana != ventana {
            controlador.ventana = ventana
            controlador.ajustarZonaDeLectura()
        }
        if controlador.intento != recomprobar {
            controlador.intento = recomprobar
            controlador.recomprobarPermiso()
        }
        controlador.cambiarLectura(activo)
    }

    static func dismantleUIViewController(_ controlador: ControladorEscanerQR, coordinator: ()) {
        controlador.detener()
    }
}

/// Sesión de captura fuera del hilo principal (`startRunning` bloquea).
private final class CajaSesion: @unchecked Sendable {  // permitido: AVCaptureSession no es Sendable; solo se arranca y para en `cola`
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
    var alCambiar: (@MainActor (EstadoCaptura) -> Void)?
    var alPrimeraImagen: (@MainActor () -> Void)?
    var alLeer: (@MainActor (String) -> Bool)?
    var ventana: CGRect = .zero
    var quiereLeer = true
    var intento = 0

    private let caja = CajaSesion()
    private let salida = AVCaptureMetadataOutput()
    private var capa: AVCaptureVideoPreviewLayer?
    private var giro: AVCaptureDevice.RotationCoordinator?
    private var configurada = false
    private var preparando = false
    private var ultimoLeido: String?
    private var observadores: [NSObjectProtocol] = []
    private var estado: EstadoCaptura = .preparando

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.isAccessibilityElement = false
        Task { await prepararCamara() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        capa?.frame = view.bounds
        aplicarGiro()
        ajustarZonaDeLectura()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        caja.parar()
    }

    /// Para la sesión (al desmontarse la vista).
    func detener() {
        caja.parar()
        for observador in observadores { NotificationCenter.default.removeObserver(observador) }
        observadores = []
    }

    /// Arranca o para la lectura (leído, en pausa, segundo plano…).
    func cambiarLectura(_ activo: Bool) {
        let antes = quiereLeer
        quiereLeer = activo
        guard configurada, antes != activo else { return }
        if activo {
            caja.arrancar()
        } else {
            caja.parar()
        }
    }

    /// Al volver a la app: si ya hay permiso, pasa a preparar la cámara.
    func recomprobarPermiso() {
        guard !configurada, !preparando else { return }
        Task { await prepararCamara() }
    }

    private func informar(_ nuevo: EstadoCaptura) {
        guard nuevo != estado else { return }
        estado = nuevo
        alCambiar?(nuevo)
    }

    private func prepararCamara() async {
        guard !configurada, !preparando else { return }
        preparando = true
        defer { preparando = false }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            informar(.preparando)
            guard await AVCaptureDevice.requestAccess(for: .video) else {
                informar(.sinPermiso)
                return
            }
        case .restricted:
            informar(.restringida)
            return
        default:
            informar(.sinPermiso)
            return
        }
        informar(.preparando)
        configurarSesion()
    }

    private func configurarSesion() {
        guard let camara = AVCaptureDevice.default(for: .video),
            let entrada = try? AVCaptureDeviceInput(device: camara),
            caja.sesion.canAddInput(entrada)
        else {
            informar(.sinCamara)
            return
        }
        caja.sesion.beginConfiguration()
        caja.sesion.addInput(entrada)
        guard caja.sesion.canAddOutput(salida) else {
            caja.sesion.commitConfiguration()
            informar(.sinCamara)
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
        giro = AVCaptureDevice.RotationCoordinator(device: camara, previewLayer: capa)
        aplicarGiro()
        observar()
        configurada = true
        if quiereLeer { caja.arrancar() }
    }

    /// La imagen derecha al girar el iPhone (a2 §22.7).
    private func aplicarGiro() {
        guard let giro, let conexion = capa?.connection else { return }
        let angulo = giro.videoRotationAngleForHorizonLevelPreview
        if conexion.isVideoRotationAngleSupported(angulo) { conexion.videoRotationAngle = angulo }
    }

    /// Solo se leen QR dentro de la ventana ampliada 24 pt por cada lado (a2 §22.3.1).
    func ajustarZonaDeLectura() {
        guard let capa, configurada, ventana.width > 0, estado == .activa else { return }
        let zona = ventana.insetBy(dx: -24, dy: -24).intersection(view.bounds)
        guard !zona.isNull, zona.width > 0 else { return }
        salida.rectOfInterest = capa.metadataOutputRectConverted(fromLayerRect: zona)
    }

    /// Arranque (primera imagen) e interrupciones (otra app usa la cámara).
    private func observar() {
        let centro = NotificationCenter.default
        let sesion = caja.sesion
        observadores.append(centro.addObserver(forName: AVCaptureSession.didStartRunningNotification, object: sesion, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {  // permitido: queue .main
                self?.arrancada()
            }
        })
        observadores.append(centro.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: sesion, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {  // permitido: queue .main
                self?.informar(.ocupada)
            }
        })
        observadores.append(centro.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: sesion, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {  // permitido: queue .main
                self?.informar(.activa)
            }
        })
    }

    private func arrancada() {
        informar(.activa)
        alPrimeraImagen?()
        ajustarZonaDeLectura()
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

    /// Un mismo texto de QR no se procesa dos veces seguidas (a2 §22.3.1). Si el modelo dice que ya vale
    /// (enlace de emparejar), la cámara se para (la imagen queda congelada).
    private func procesar(_ texto: String) {
        guard quiereLeer, texto != ultimoLeido else { return }
        ultimoLeido = texto
        if alLeer?(texto) == true {
            quiereLeer = false
            caja.parar()
        }
    }
}
