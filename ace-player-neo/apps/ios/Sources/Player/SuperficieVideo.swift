import AVFoundation
import AVKit
import Observation
import SwiftUI
import UIKit

/* UNA sola capa de vídeo en toda la app.

   Antes cada pantalla (mini, centro de partido, pantalla completa) creaba su
   propio `AVPlayerLayer` con el mismo `AVPlayer`: al volver del PiP se veía
   el vídeo DOS veces (la ventana del PiP, que seguía con la capa antigua, y
   la capa nueva de la pantalla completa). Ahora hay una única capa
   (`SuperficieVideo.vista`) y las pantallas solo ponen HUECOS donde puede ir;
   la capa va al hueco de más prioridad que esté en pantalla (el vuelo, luego
   el inmersivo, luego el teatro, luego el mini). El PiP se crea una
   vez para esa capa: el automático al salir de la app y la vuelta siempre
   salen de ella. */

// MARK: - La capa y sus huecos

/// La vista de UIKit cuya capa ES el `AVPlayerLayer` (se redimensiona sola).
public final class CapaVideoUIView: UIView {
    override public class var layerClass: AnyClass { AVPlayerLayer.self }

    public var capa: AVPlayerLayer {
        // swiftlint:disable:next force_cast
        layer as! AVPlayerLayer
    }
}

/// Dónde puede ir el vídeo: gana el de más prioridad en pantalla (b-arquitectura §2.6).
/// `mini < teatro < inmersivo < vuelo` (el hueco que viaja del escenario al mini gana a todos).
public enum PrioridadHueco: Int, Sendable, Comparable {
    case mini = 1, teatro = 2, inmersivo = 3, vuelo = 4
    public static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }
}

/// Un hueco para el vídeo. Avisa a la superficie al entrar y salir de la ventana.
public final class HuecoVideoUIView: UIView {
    weak var superficie: SuperficieVideo?
    var prioridad: PrioridadHueco = .teatro
    var gravedad: AVLayerVideoGravity = .resizeAspect

    override public func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil {
            superficie?.entra(self)
        } else {
            superficie?.sale(self)
        }
    }

    override public func layoutSubviews() {
        super.layoutSubviews()
        for vista in subviews { vista.frame = bounds }
    }
}

/// Dueña de la única capa de vídeo: la mueve al hueco que toca.
@MainActor
public final class SuperficieVideo {
    public let vista = CapaVideoUIView()
    /// Huecos en pantalla, en orden de llegada.
    private var huecos: [Caja] = []

    private final class Caja {
        weak var hueco: HuecoVideoUIView?
        init(_ hueco: HuecoVideoUIView) { self.hueco = hueco }
    }

    public init() {
        vista.backgroundColor = .black
        vista.isAccessibilityElement = false
        vista.isUserInteractionEnabled = false
        vista.capa.videoGravity = .resizeAspect
    }

    /// El hueco donde está ahora la capa (nil si ninguno está en pantalla).
    public var huecoActual: HuecoVideoUIView? {
        vista.superview as? HuecoVideoUIView
    }

    func entra(_ hueco: HuecoVideoUIView) {
        huecos.removeAll { $0.hueco == nil || $0.hueco === hueco }
        huecos.append(Caja(hueco))
        recolocar()
    }

    func sale(_ hueco: HuecoVideoUIView) {
        huecos.removeAll { $0.hueco == nil || $0.hueco === hueco }
        recolocar()
    }

    /// Elige el hueco: el de más prioridad en pantalla y, a igualdad, el último que llegó.
    nonisolated static func elegir(_ candidatos: [(prioridad: PrioridadHueco, orden: Int)]) -> Int? {
        candidatos.indices.max { a, b in
            let x = candidatos[a]
            let y = candidatos[b]
            return x.prioridad == y.prioridad ? x.orden < y.orden : x.prioridad < y.prioridad
        }
    }

    public func recolocar() {
        let vivos = huecos.compactMap { caja -> HuecoVideoUIView? in
            guard let hueco = caja.hueco, hueco.window != nil else { return nil }
            return hueco
        }
        let candidatos = vivos.enumerated().map { (prioridad: $0.element.prioridad, orden: $0.offset) }
        guard let indice = Self.elegir(candidatos) else { return }
        let destino = vivos[indice]
        if vista.superview !== destino {
            destino.addSubview(vista)
            vista.frame = destino.bounds
        }
        vista.capa.videoGravity = destino.gravedad
    }
}

/// El hueco del vídeo en SwiftUI.
public struct VistaVideo: UIViewRepresentable {
    let superficie: SuperficieVideo
    var prioridad: PrioridadHueco
    var gravedad: AVLayerVideoGravity = .resizeAspect

    public init(superficie: SuperficieVideo, prioridad: PrioridadHueco, gravedad: AVLayerVideoGravity = .resizeAspect) {
        self.superficie = superficie
        self.prioridad = prioridad
        self.gravedad = gravedad
    }

    public func makeUIView(context: Context) -> HuecoVideoUIView {
        let hueco = HuecoVideoUIView()
        hueco.backgroundColor = .black
        hueco.clipsToBounds = true
        hueco.isAccessibilityElement = false
        hueco.isUserInteractionEnabled = false
        hueco.prioridad = prioridad
        hueco.gravedad = gravedad
        hueco.superficie = superficie
        return hueco
    }

    public func updateUIView(_ hueco: HuecoVideoUIView, context: Context) {
        let cambia = hueco.prioridad != prioridad || hueco.gravedad != gravedad
        hueco.prioridad = prioridad
        hueco.gravedad = gravedad
        if cambia { superficie.recolocar() }
    }

    public static func dismantleUIView(_ hueco: HuecoVideoUIView, coordinator: Coordinator) {
        hueco.superficie?.sale(hueco)
    }
}

// MARK: - Picture in Picture

/// Lo que el gestor necesita del `AVPictureInPictureController` (en los tests, un doble).
@MainActor
public protocol ControladorPiP: AnyObject {
    var activo: Bool { get }
    var posible: Bool { get }
    func empezar()
    func parar()
}

/// El de verdad, sobre la única capa de vídeo, con arranque automático al salir de la app.
@MainActor
final class ControladorPiPDelSistema: ControladorPiP {
    private let controlador: AVPictureInPictureController

    init?(capa: AVPlayerLayer, delegado: DelegadoPiP) {
        let creado: AVPictureInPictureController? = AVPictureInPictureController(playerLayer: capa)
        guard let creado else { return nil }
        creado.delegate = delegado
        creado.canStartPictureInPictureAutomaticallyFromInline = true
        controlador = creado
    }

    var activo: Bool { controlador.isPictureInPictureActive }
    var posible: Bool { controlador.isPictureInPicturePossible }
    func empezar() { controlador.startPictureInPicture() }
    func parar() { controlador.stopPictureInPicture() }
}

/// El cierre de «restaurar» de AVKit, para llevarlo a una tarea (AVKit lo llama en el hilo principal).
public struct CompletarRestauracion: @unchecked Sendable {
    let hacer: (Bool) -> Void
}

/// PiP de la única capa: botón, arranque automático al salir de la app,
/// vuelta al reproductor al tocar «volver» en la ventanita y al volver a la
/// app, y audio en segundo plano cuando no hay PiP.
@MainActor
@Observable
public final class GestorPiP {
    /// La ventanita está abierta (o terminando de abrirse).
    public private(set) var activo = false
    /// AVKit ha avisado de que va a abrirla (p. ej. al salir de la app).
    public private(set) var arrancando = false
    public let soportado: Bool
    public let superficie: SuperficieVideo

    /// Enseña el reproductor para que el vídeo vuelva a su sitio. AVKit
    /// espera a que termine para devolver la imagen (completa con `true`).
    @ObservationIgnored public var alRestaurar: (@MainActor () async -> Void)?
    /// Se abrió la ventanita (p. ej. para minimizar el reproductor grande).
    @ObservationIgnored public var alEmpezar: (@MainActor () -> Void)?

    @ObservationIgnored private var controlador: (any ControladorPiP)?
    @ObservationIgnored private var jugador: AVPlayer?
    @ObservationIgnored private var capaSoltada = false
    private let fabrica: @MainActor (AVPlayerLayer, DelegadoPiP) -> (any ControladorPiP)?
    private let delegado = DelegadoPiP()

    /// - Parameter fabrica: crea el controlador del PiP (en los tests, un doble).
    public init(
        superficie: SuperficieVideo = SuperficieVideo(),
        soportado: Bool = AVPictureInPictureController.isPictureInPictureSupported(),
        fabrica: (@MainActor (AVPlayerLayer, DelegadoPiP) -> (any ControladorPiP)?)? = nil
    ) {
        self.superficie = superficie
        self.soportado = soportado
        if let fabrica {
            self.fabrica = fabrica
        } else {
            self.fabrica = { capa, delegado -> (any ControladorPiP)? in
                ControladorPiPDelSistema(capa: capa, delegado: delegado)
            }
        }
        delegado.alIrAEmpezar = { [weak self] in self?.arrancando = true }
        delegado.alEmpezar = { [weak self] in self?.empezo() }
        delegado.alTerminar = { [weak self] in
            self?.arrancando = false
            self?.activo = false
        }
        delegado.alRestaurar = { [weak self] completar in
            guard let self else {
                completar.hacer(true)
                return
            }
            Task { @MainActor in
                await self.restaurar()
                completar.hacer(true)
            }
        }
    }

    /// Engancha el reproductor a la capa y prepara su PiP (una vez).
    public func conectar(_ player: AVPlayer?) {
        jugador = player
        if !capaSoltada { superficie.vista.capa.player = player }
        guard soportado, controlador == nil, player != nil else { return }
        controlador = fabrica(superficie.vista.capa, delegado)
    }

    /// Solo para los tests: el controlador sin reproductor de verdad.
    func prepararControlador() {
        guard controlador == nil else { return }
        controlador = fabrica(superficie.vista.capa, delegado)
    }

    /// El PiP se puede abrir ahora mismo.
    public var posible: Bool { controlador?.posible ?? false }

    public func alternar() {
        guard let controlador else { return }
        if controlador.activo || activo {
            controlador.parar()
        } else {
            controlador.empezar()
        }
    }

    /// Cierra la ventanita: AVKit pide restaurar la interfaz y el vídeo vuelve a la app.
    public func cerrar() {
        guard activo || arrancando || controlador?.activo == true else { return }
        controlador?.parar()
    }

    /// La app pasa a segundo plano. Sin PiP, la capa suelta el reproductor
    /// para que siga el audio (si no, iOS pausa el vídeo).
    public func pasoASegundoPlano() {
        guard !(activo || arrancando || controlador?.activo == true) else { return }
        superficie.vista.capa.player = nil
        capaSoltada = true
    }

    /// La app vuelve: la capa recupera el reproductor y, si seguía el PiP,
    /// se cierra para que el vídeo vuelva al reproductor de la app (nunca doble).
    public func volvioAPrimerPlano() {
        if capaSoltada {
            superficie.vista.capa.player = jugador
            capaSoltada = false
        }
        cerrar()
    }

    private func empezo() {
        arrancando = false
        activo = true
        if capaSoltada {
            superficie.vista.capa.player = jugador
            capaSoltada = false
        }
        alEmpezar?()
    }

    /// AVKit va a devolver el vídeo: primero se enseña el reproductor.
    func restaurar() async {
        await alRestaurar?()
    }

    // MARK: Para los tests (el delegado como lo llamaría AVKit)

    func simularInicio() {
        delegado.alIrAEmpezar?()
        delegado.alEmpezar?()
    }

    func simularFin() {
        delegado.alTerminar?()
    }

    func simularRestaurar(_ completar: @escaping (Bool) -> Void) {
        delegado.alRestaurar?(CompletarRestauracion(hacer: completar))
    }
}

/// Delegado del PiP: los avisos llegan en el hilo principal.
@MainActor
public final class DelegadoPiP: NSObject, AVPictureInPictureControllerDelegate {
    var alIrAEmpezar: (() -> Void)?
    var alEmpezar: (() -> Void)?
    var alTerminar: (() -> Void)?
    var alRestaurar: ((CompletarRestauracion) -> Void)?

    nonisolated public func pictureInPictureControllerWillStartPictureInPicture(
        _ pictureInPictureController: AVPictureInPictureController
    ) {
        MainActor.assumeIsolated { self.alIrAEmpezar?() }
    }

    nonisolated public func pictureInPictureControllerDidStartPictureInPicture(
        _ pictureInPictureController: AVPictureInPictureController
    ) {
        MainActor.assumeIsolated { self.alEmpezar?() }
    }

    nonisolated public func pictureInPictureControllerDidStopPictureInPicture(
        _ pictureInPictureController: AVPictureInPictureController
    ) {
        MainActor.assumeIsolated { self.alTerminar?() }
    }

    nonisolated public func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: any Error
    ) {
        MainActor.assumeIsolated { self.alTerminar?() }
    }

    nonisolated public func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        let completar = CompletarRestauracion(hacer: completionHandler)
        MainActor.assumeIsolated {
            if let alRestaurar = self.alRestaurar {
                alRestaurar(completar)
            } else {
                completar.hacer(true)
            }
        }
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
        vista.activeTintColor = UIColor(Palco.accent)  // el colorset «Accent» se fue en la poda: el mismo oro de tokens.css
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
