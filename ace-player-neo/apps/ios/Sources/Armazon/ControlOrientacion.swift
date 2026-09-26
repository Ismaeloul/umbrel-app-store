import SwiftUI
import UIKit

/* Pantalla completa y vuelta a vertical segura (b-arquitectura §1.7, M4; a2 §16.0 y §27.8). Las orientaciones de la
   app son vertical y las dos horizontales (decisión A: se calca el horizontal de la web). ⛶ lo pide M3
   (`PresentacionReproductor.alternarPantallaCompleta` → `Orientacion.pedir`). Al salir de ⛶ con el teléfono aún
   en horizontal, iOS volvería a girar con el siguiente aviso del sensor: mientras el aparato no diga «vertical»,
   la ventana solo admite vertical; después vuelve a admitir las tres. */

struct ControlOrientacion: ViewModifier {
    @Environment(PresentacionReproductor.self) private var presentacion
    @Environment(EstadoVentana.self) private var ventana

    func body(content: Content) -> some View {
        content
            .onChange(of: presentacion.pantallaCompletaForzada) { antes, ahora in
                guard antes, !ahora else { return }
                ControlOrientacion.volverAVerticalSegura(ventana)
            }
    }

    static let todas: UIInterfaceOrientationMask = [.portrait, .landscapeLeft, .landscapeRight]

    /// Solo vertical hasta que el aparato esté en vertical (o boca arriba/abajo) y luego las tres.
    static func volverAVerticalSegura(_ ventana: EstadoVentana) {
        guard UIDevice.current.orientation.isLandscape else { return }
        ventana.mascaraOrientacion = .portrait
        VigiaGiro().esperarVertical(ventana)
    }
}

/// Espera al primer aviso del sensor en vertical y suelta la máscara; se quita solo.
@MainActor private final class VigiaGiro {
    private var token: NSObjectProtocol?

    func esperarVertical(_ ventana: EstadoVentana) {
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        token = NotificationCenter.default.addObserver(
            forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main
        ) { [self] _ in
            MainActor.assumeIsolated { self.revisar(ventana) }  // permitido: el aviso llega en la cola principal (queue: .main)
        }
    }

    private func revisar(_ ventana: EstadoVentana) {
        let orientacion = UIDevice.current.orientation
        guard orientacion == .portrait || orientacion.isFlat || ventana.mascaraOrientacion != .portrait else { return }
        if ventana.mascaraOrientacion == .portrait { ventana.mascaraOrientacion = ControlOrientacion.todas }
        if let token { NotificationCenter.default.removeObserver(token) }
        token = nil
        UIDevice.current.endGeneratingDeviceOrientationNotifications()
    }
}
