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
