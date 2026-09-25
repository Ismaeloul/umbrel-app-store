import AVKit
import MediaPlayer
import XCTest

@testable import AceNeo

/// Lo que el reproductor le cuenta al sistema: Now Playing, comandos remotos
/// y el delegado del PiP (que AVKit lo reconozca de verdad).
final class SistemaTests: XCTestCase {
    @MainActor
    func testElDelegadoDelPiPRespondeATodosLosAvisos() {
        let delegado = DelegadoPiP()
        let selectores = [
            "pictureInPictureControllerWillStartPictureInPicture:",
            "pictureInPictureControllerDidStartPictureInPicture:",
            "pictureInPictureControllerDidStopPictureInPicture:",
            "pictureInPictureController:failedToStartPictureInPictureWithError:",
            "pictureInPictureController:restoreUserInterfaceForPictureInPictureStopWithCompletionHandler:",
        ]
        for nombre in selectores {
            XCTAssertTrue(delegado.responds(to: NSSelectorFromString(nombre)), "AVKit no vería \(nombre)")
        }
    }

    @MainActor
    func testElPiPDeVerdadSinReproductorNoRompeNada() {
        let gestor = GestorPiP()
        XCTAssertFalse(gestor.activo)
        gestor.conectar(nil)
        // Sin reproducción no se puede abrir, pero no debe romper nada.
        XCTAssertFalse(gestor.posible)
        gestor.alternar()
        gestor.cerrar()
        gestor.pasoASegundoPlano()
        gestor.volvioAPrimerPlano()
        XCTAssertFalse(gestor.activo)
    }

    @MainActor
    func testNowPlayingConElPartidoYComandosRemotos() throws {
        let motor = MotorFalso()
        let servicio = try ServicioFalso()
        let reproductor = Reproductor(
            motor: motor, servicio: servicio, visor: "ios_prueba", automatico: false, esperar: { _ in })
        let controles = ControlesSistema()
        controles.conectar(reproductor)
        let canal = CanalReproducible(
            id: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", titulo: "DAZN 1", ih: false,
            partido: ContextoPartido(id: "p1", titulo: "Local – Visitante", competicion: "LaLiga", canal: "DAZN 1"))

        reproductor.reproducir(canal, lista: [canal])

        let info = try XCTUnwrap(MPNowPlayingInfoCenter.default().nowPlayingInfo)
        XCTAssertEqual(info[MPMediaItemPropertyTitle] as? String, "Local – Visitante")
        XCTAssertEqual(info[MPMediaItemPropertyArtist] as? String, "DAZN 1")
        XCTAssertEqual(info[MPMediaItemPropertyAlbumTitle] as? String, "LaLiga")
        XCTAssertEqual(info[MPNowPlayingInfoPropertyIsLiveStream] as? Bool, true)
        XCTAssertFalse(MPRemoteCommandCenter.shared().nextTrackCommand.isEnabled, "Con un solo canal no hay siguiente")

        // Pausar desde el Centro de Control llega al reproductor.
        reproductor.pausar()
        XCTAssertFalse(reproductor.quiereReproducir)
        XCTAssertEqual(motor.pausas, 1)

        reproductor.detener()
        XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)
    }

    @MainActor
    func testAuricularesDesconectadosPausan() async throws {
        let motor = MotorFalso()
        let reproductor = Reproductor(
            motor: motor, servicio: try ServicioFalso(), visor: "ios_prueba", automatico: false, esperar: { _ in })
        let controles = ControlesSistema()
        controles.conectar(reproductor)
        reproductor.reproducir(CanalReproducible(id: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", titulo: "DAZN 1"))
        NotificationCenter.default.post(
            name: AVAudioSession.routeChangeNotification, object: nil,
            userInfo: [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue])
        await esperarHasta("Pausa al quitar los auriculares") { !reproductor.quiereReproducir }
        reproductor.detener()
    }
}
