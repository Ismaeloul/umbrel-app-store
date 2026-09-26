import AVFoundation
import AVKit
import Observation
import UIKit

/* Picture in Picture de la única capa de vídeo (SuperficieVideo): movido de SuperficieVideo.swift sin cambios
   de comportamiento para que cada fichero quede por debajo de 400 líneas (R20). */

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
    /// Se volvió de segundo plano con la ventanita abierta: se vuelve a cerrar al activarse la escena (al entrar en
    /// primer plano iOS puede no hacer caso todavía a `stopPictureInPicture`).
    @ObservationIgnored private var cerrarAlActivarse = false
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
        cerrarAlActivarse = activo || arrancando || controlador?.activo == true
        cerrar()
    }

    /// La escena ya está activa: si la ventanita sigue abierta tras volver, se cierra ahora (como YouTube: el
    /// vídeo vuelve solo a su sitio, el teatro o el mini, sin corte).
    public func seActivoLaEscena() {
        guard cerrarAlActivarse else { return }
        cerrarAlActivarse = false
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
