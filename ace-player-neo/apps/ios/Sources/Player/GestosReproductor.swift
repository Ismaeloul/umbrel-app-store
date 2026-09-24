import CoreGraphics
import Foundation

/// Qué se ve del reproductor por encima de las pestañas.
public enum VistaReproductor: String, Sendable, Hashable {
    /// Nada suena (o se paró a propósito) o ya se ve en el escenario.
    case ninguna
    /// El mini-reproductor sobre la barra de pestañas.
    case mini
    /// El escenario, a toda pantalla.
    case grande
}

/// Las decisiones de los gestos del reproductor, aparte de la vista para
/// probarlas solas (`GestosReproductorTests`). Los umbrales siguen los del
/// prototipo de Palco: basta con pasar una distancia o con soltar con velocidad.
public enum GestosReproductor {
    /// Lo que hace soltar el dedo sobre el mini-reproductor.
    public enum SoltarMini: Equatable, Sendable {
        /// Deslizar hacia arriba: abre el escenario.
        case abrir
        /// Deslizar hacia abajo: detiene (con «Deshacer»).
        case detener
        /// Poco recorrido: vuelve a su sitio.
        case nada
    }

    /// Recorrido hacia arriba que abre el escenario (`OPEN_AT`).
    public static let subidaParaAbrir: CGFloat = 36
    /// Recorrido hacia abajo que detiene (`STOP_AT`).
    public static let bajadaParaDetener: CGFloat = 44
    /// Recorrido lateral sobre el vídeo que cambia de fuente.
    public static let ladoParaZapear: CGFloat = 80
    /// Bajada del escenario a partir de la cual se arma «minimizar» (vibra).
    public static let bajadaArmada: CGFloat = 110

    /// - Parameters:
    ///   - traslacion: lo que se ha movido el dedo.
    ///   - prevista: dónde acabaría con la inercia (`predictedEndTranslation`).
    public static func alSoltarMini(traslacion: CGSize, prevista: CGSize) -> SoltarMini {
        let vertical = abs(traslacion.height) >= abs(traslacion.width)
        guard vertical else { return .nada }
        if -traslacion.height > subidaParaAbrir || (-prevista.height > 160 && -traslacion.height > 8) {
            return .abrir
        }
        if traslacion.height > bajadaParaDetener || (prevista.height > 220 && traslacion.height > 12) {
            return .detener
        }
        return .nada
    }

    /// Qué umbral tiene armado el mini mientras el dedo sigue puesto (para la háptica).
    public static func armadoMini(_ traslacion: CGSize) -> SoltarMini {
        guard abs(traslacion.height) >= abs(traslacion.width) else { return .nada }
        if -traslacion.height > subidaParaAbrir { return .abrir }
        if traslacion.height > bajadaParaDetener { return .detener }
        return .nada
    }

    /// Cómo sigue el mini al dedo: solo en vertical; hacia arriba con
    /// resistencia (se nota que tira del escenario) y hacia abajo también, más corta.
    public static func desplazamientoMini(_ traslacion: CGSize) -> CGSize {
        guard abs(traslacion.height) >= abs(traslacion.width) else { return .zero }
        let dy =
            traslacion.height < 0
            ? -resistencia(-traslacion.height, tope: 90) : resistencia(traslacion.height, tope: 70)
        return CGSize(width: 0, height: dy)
    }

    /// ¿Soltar el escenario lo minimiza? Por distancia o por velocidad.
    public static func alSoltarGrande(traslacion: CGFloat, prevista: CGFloat, alto: CGFloat) -> Bool {
        let umbral = min(150, max(80, alto * 0.18))
        return traslacion > umbral || (prevista > alto * 0.4 && traslacion > 20)
    }

    /// El escenario baja con el dedo (nunca sube de su sitio).
    public static func desplazamientoGrande(_ traslacion: CGFloat) -> CGFloat {
        traslacion > 0 ? traslacion : -resistencia(-traslacion, tope: 18)
    }

    /// Cuánto se ha minimizado (0 abierto … 1 abajo del todo), para escalar y oscurecer.
    public static func progreso(_ desplazamiento: CGFloat, alto: CGFloat) -> CGFloat {
        guard alto > 0 else { return 0 }
        return min(1, max(0, desplazamiento / alto))
    }

    /// Escala del escenario mientras baja (1 → 0,92 a los 320 pt, como el prototipo).
    public static func escala(_ bajada: CGFloat) -> CGFloat {
        1 - min(1, max(0, bajada / 320)) * 0.08
    }

    /// Esquinas del escenario mientras baja (0 → 34 pt a los 60 pt).
    public static func radio(_ bajada: CGFloat) -> CGFloat {
        min(34, max(0, bajada) * 34 / 60)
    }

    /// Opacidad del cuerpo (lo que no es el vídeo) mientras baja (1 → 0,25 a los 200 pt).
    public static func opacidadCuerpo(_ bajada: CGFloat) -> CGFloat {
        max(0.25, 1 - max(0, bajada) / 200 * 0.75)
    }

    /// Deslizar el vídeo a los lados: +1 siguiente fuente, −1 anterior, 0 nada.
    /// Solo cuenta si el gesto es más horizontal que vertical.
    public static func alSoltarFuente(traslacion: CGSize, prevista: CGSize) -> Int {
        guard abs(traslacion.width) > abs(traslacion.height) else { return 0 }
        if traslacion.width < -ladoParaZapear || (prevista.width < -260 && traslacion.width < -12) { return 1 }
        if traslacion.width > ladoParaZapear || (prevista.width > 260 && traslacion.width > 12) { return -1 }
        return 0
    }

    /// Qué cambio de fuente tiene armado el gesto lateral (para la pista y la háptica).
    public static func armadoFuente(_ traslacion: CGSize) -> Int {
        guard abs(traslacion.width) > abs(traslacion.height) else { return 0 }
        if traslacion.width < -ladoParaZapear { return 1 }
        if traslacion.width > ladoParaZapear { return -1 }
        return 0
    }

    /// Cómo sigue el vídeo al dedo de lado (con resistencia: no se va de la pantalla).
    public static func desplazamientoFuente(_ traslacion: CGSize) -> CGFloat {
        let dx = traslacion.width
        return dx < 0 ? -resistencia(-dx, tope: 120) : resistencia(dx, tope: 120)
    }

    /// Resistencia elástica: avanza cada vez menos hasta `tope`.
    public static func resistencia(_ valor: CGFloat, tope: CGFloat) -> CGFloat {
        guard valor > 0, tope > 0 else { return 0 }
        return tope * (1 - 1 / (valor / tope + 1))
    }
}
