import AVFoundation
import UIKit

/* La cámara de emparejar (a2 §22.3, §22.7; b-arquitectura §1.12): la sesión de captura, la ÚNICA capa de la
   imagen (`resizeAspectFill`) y la lectura de QR, con vida de pantalla (la crea PantallaEmparejar y la para al
   irse). La vista (`EscanerQR`) solo cuelga la capa: al girar se cuelga de la vista nueva y la sesión sigue en
   marcha. Lectura solo dentro de la ventana ampliada 24 pt por lado (`rectOfInterest`), giro con
   `AVCaptureDevice.RotationCoordinator`, aviso cuando otra app se queda la cámara (interrupciones) y parada al
   leer, al ir a segundo plano y al salir de la pantalla. De `QRScannerView` (rescatado en la poda). La háptica y
   los textos los pone el modelo (ModeloEmparejar). */

/// Lo que sabe la cámara (el modelo lo convierte en `EstadoCamara`).
enum EstadoCaptura: Equatable, Sendable {
    case preparando, activa, ocupada, sinPermiso, restringida, sinCamara
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

@MainActor final class CamaraQR: NSObject, AVCaptureMetadataOutputObjectsDelegate {
    var alCambiar: (@MainActor (EstadoCaptura) -> Void)?
    var alPrimeraImagen: (@MainActor () -> Void)?
    var alLeer: (@MainActor (String) -> Bool)?

    private let caja = CajaSesion()
    private let salida = AVCaptureMetadataOutput()
    private var capa: AVCaptureVideoPreviewLayer?
    private var giro: AVCaptureDevice.RotationCoordinator?
    private weak var anfitrion: UIView?
    private var ventana: CGRect = .zero
    private var configurada = false
    private var preparando = false
    private var quiereLeer = true
    private var ultimoLeido: String?
    private var intento = 0
    private var vezReleer = 0
    private var observadores: [NSObjectProtocol] = []
    private var estado: EstadoCaptura = .preparando

    // MARK: Vista

    /// La vista del cartel que se monta (la primera vez, o la nueva al girar): la capa pasa a colgar de ella.
    func alojar(en vista: UIView) {
        anfitrion = vista
        colgarCapa()
        guard !configurada, !preparando else { return }
        Task { await prepararCamara() }
    }

    /// La vista se desmonta: la capa se suelta solo si aún cuelga de ella (al girar ya cuelga de la nueva).
    func desalojar(de vista: UIView) {
        if anfitrion === vista { anfitrion = nil }
        guard let capa, capa.superlayer === vista.layer else { return }
        capa.removeFromSuperlayer()
    }

    /// Tamaño, giro y zona de lectura con la vista que aloja la capa.
    func maquetar(en vista: UIView, ventana nueva: CGRect) {
        guard vista === anfitrion else { return }
        ventana = nueva
        colgarCapa()
        aplicarGiro()
        ajustarZonaDeLectura()
    }

    private func colgarCapa() {
        guard let capa, let anfitrion else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if capa.superlayer !== anfitrion.layer { anfitrion.layer.addSublayer(capa) }
        capa.frame = anfitrion.bounds
        CATransaction.commit()
    }

    // MARK: Lectura

    /// Arranca o para la lectura (leído, en pausa, segundo plano…).
    func cambiarLectura(_ activo: Bool) {
        let antes = quiereLeer
        quiereLeer = activo
        guard configurada, antes != activo else { return }
        if activo {
            if observadores.isEmpty { observar() }
            caja.arrancar()
        } else {
            caja.parar()
        }
    }

    /// Al volver a la app: si ya hay permiso, pasa a preparar la cámara.
    func recomprobar(_ vez: Int) {
        guard vez != intento else { return }
        intento = vez
        guard !configurada, !preparando else { return }
        Task { await prepararCamara() }
    }

    /// El modelo deja volver a leer el mismo QR (tras un fallo de red se puede reintentar sin escribir nada).
    func releer(_ vez: Int) {
        guard vez != vezReleer else { return }
        vezReleer = vez
        ultimoLeido = nil
    }

    /// Para la sesión (al salir de la pantalla) y deja de escuchar sus avisos.
    func detener() {
        quiereLeer = false
        caja.parar()
        for observador in observadores { NotificationCenter.default.removeObserver(observador) }
        observadores = []
    }

    // MARK: Preparación

    private func informar(_ nuevo: EstadoCaptura) {
        guard nuevo != estado else { return }
        estado = nuevo
        alCambiar?(nuevo)
    }

    private func prepararCamara() async {
        guard !configurada, !preparando else { return }
        preparando = true
        defer { preparando = false }
        // Sin cámara (simulador, fallo) no se pide permiso: no serviría de nada (a2 §22.3.2).
        guard AVCaptureDevice.default(for: .video) != nil else {
            informar(.sinCamara)
            return
        }
        guard await hayPermiso() else { return }
        informar(.preparando)
        configurarSesion()
    }

    private func hayPermiso() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return true
        case .notDetermined:
            informar(.preparando)
            let concedido = await AVCaptureDevice.requestAccess(for: .video)
            if !concedido { informar(.sinPermiso) }
            return concedido
        case .restricted:
            informar(.restringida)
            return false
        default:
            informar(.sinPermiso)
            return false
        }
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
        crearCapa(camara)
        observar()
        configurada = true
        if quiereLeer { caja.arrancar() }
    }

    private func crearCapa(_ camara: AVCaptureDevice) {
        let capa = AVCaptureVideoPreviewLayer(session: caja.sesion)
        capa.videoGravity = .resizeAspectFill
        self.capa = capa
        colgarCapa()
        giro = AVCaptureDevice.RotationCoordinator(device: camara, previewLayer: capa)
        aplicarGiro()
    }

    /// La imagen derecha al girar el iPhone (a2 §22.7).
    private func aplicarGiro() {
        guard let giro, let conexion = capa?.connection else { return }
        let angulo = giro.videoRotationAngleForHorizonLevelPreview
        if conexion.isVideoRotationAngleSupported(angulo) { conexion.videoRotationAngle = angulo }
    }

    /// Solo se leen QR dentro de la ventana ampliada 24 pt por cada lado (a2 §22.3.1).
    private func ajustarZonaDeLectura() {
        guard let capa, let anfitrion, configurada, ventana.width > 0, estado == .activa else { return }
        let zona = ventana.insetBy(dx: -24, dy: -24).intersection(anfitrion.bounds)
        guard !zona.isNull, zona.width > 0 else { return }
        salida.rectOfInterest = capa.metadataOutputRectConverted(fromLayerRect: zona)
    }

    // MARK: Avisos de la sesión

    /// Arranque (primera imagen) e interrupciones (otra app usa la cámara).
    private func observar() {
        let sesion = caja.sesion
        escuchar(AVCaptureSession.didStartRunningNotification, sesion) { $0.arrancada() }
        escuchar(AVCaptureSession.wasInterruptedNotification, sesion) { $0.informar(.ocupada) }
        escuchar(AVCaptureSession.interruptionEndedNotification, sesion) { $0.informar(.activa) }
    }

    private func escuchar(_ nombre: Notification.Name, _ sesion: AVCaptureSession, _ accion: @escaping @MainActor (CamaraQR) -> Void) {
        let observador = NotificationCenter.default.addObserver(forName: nombre, object: sesion, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {  // permitido: queue .main
                if let self { accion(self) }
            }
        }
        observadores.append(observador)
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
