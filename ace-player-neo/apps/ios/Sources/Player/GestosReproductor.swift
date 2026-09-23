import CoreGraphics
import Foundation

/// Qué se ve del reproductor por encima de las pestañas.
public enum VistaReproductor: String, Sendable, Hashable {
    /// Nada suena (o se paró a propósito) o ya se ve en el centro de partido.
    case ninguna
    /// El mini-reproductor sobre la barra de pestañas.
    case mini
    /// El reproductor grande, a toda pantalla.
    case grande
}

/// Las decisiones de los gestos del reproductor, aparte de la vista para
/// probarlas solas (`GestosReproductorTests`). Los umbrales siguen los del
/// sistema: basta con pasar una distancia o con soltar con velocidad.
public enum GestosReproductor {
    /// Lo que hace soltar el dedo sobre el mini-reproductor.
    public enum SoltarMini: Equatable, Sendable {
        /// Deslizar hacia arriba: abre el reproductor grande.
        case abrir
        /// Deslizar hacia un lado: detiene (como la X).
        case detener
        /// Poco recorrido: vuelve a su sitio.
        case nada
    }

    /// Recorrido hacia arriba que abre el reproductor.
    public static let subidaParaAbrir: CGFloat = 36
    /// Recorrido lateral que detiene.
    public static let ladoParaDetener: CGFloat = 110

    /// - Parameters:
    ///   - traslacion: lo que se ha movido el dedo.
    ///   - prevista: dónde acabaría con la inercia (`predictedEndTranslation`).
    public static func alSoltarMini(traslacion: CGSize, prevista: CGSize) -> SoltarMini {
        let vertical = abs(traslacion.height) >= abs(traslacion.width)
        if vertical, -traslacion.height > subidaParaAbrir || (-prevista.height > 160 && -traslacion.height > 8) {
            return .abrir
        }
        if !vertical, abs(traslacion.width) > ladoParaDetener || (abs(prevista.width) > 280 && abs(traslacion.width) > 24) {
            return .detener
        }
        return .nada
    }

    /// Cómo sigue el mini al dedo: de lado, libre; hacia arriba, con
    /// resistencia (se nota que tira del reproductor); hacia abajo, casi nada.
    public static func desplazamientoMini(_ traslacion: CGSize) -> CGSize {
        if abs(traslacion.width) > abs(traslacion.height) {
            return CGSize(width: traslacion.width, height: 0)
        }
        let dy = traslacion.height < 0 ? -resistencia(-traslacion.height, tope: 90) : resistencia(traslacion.height, tope: 14)
        return CGSize(width: 0, height: dy)
    }

    /// ¿Soltar el reproductor grande lo minimiza? Por distancia o por velocidad.
    public static func alSoltarGrande(traslacion: CGFloat, prevista: CGFloat, alto: CGFloat) -> Bool {
        let umbral = min(150, max(80, alto * 0.18))
        return traslacion > umbral || (prevista > alto * 0.4 && traslacion > 20)
    }

    /// El reproductor grande baja con el dedo (nunca sube de su sitio).
    public static func desplazamientoGrande(_ traslacion: CGFloat) -> CGFloat {
        traslacion > 0 ? traslacion : -resistencia(-traslacion, tope: 18)
    }

    /// Cuánto se ha minimizado (0 abierto … 1 abajo del todo), para escalar y oscurecer.
    public static func progreso(_ desplazamiento: CGFloat, alto: CGFloat) -> CGFloat {
        guard alto > 0 else { return 0 }
        return min(1, max(0, desplazamiento / alto))
    }

    /// Resistencia elástica: avanza cada vez menos hasta `tope`.
    public static func resistencia(_ valor: CGFloat, tope: CGFloat) -> CGFloat {
        guard valor > 0, tope > 0 else { return 0 }
        return tope * (1 - 1 / (valor / tope + 1))
    }
}
