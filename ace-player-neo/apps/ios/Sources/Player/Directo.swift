import Foundation

/* El directo, en números: la ventana que se puede recorrer, el borde útil
   (que conserva un colchón de seguridad) y los umbrales del vigilante. Son
   los de la web (packages/shared/src/domain/live.ts y
   apps/web/src/player/constants.ts), para que el iPhone y la web decidan
   igual. */

/// Ventana del directo que se puede recorrer (`seekableTimeRanges`), en segundos.
public struct VentanaDirecto: Sendable, Hashable {
    public var inicio: Double
    public var fin: Double

    public init(inicio: Double, fin: Double) {
        self.inicio = inicio
        self.fin = fin
    }

    public var duracion: Double { fin - inicio }

    /// Elige, de varios tramos, el que contiene el cabezal (o el último), como `readSeekWindow`.
    public static func elegir(tramos: [(inicio: Double, fin: Double)], actual: Double) -> VentanaDirecto? {
        guard !tramos.isEmpty else { return nil }
        let validos = tramos.filter { $0.inicio.isFinite && $0.fin.isFinite }
        guard !validos.isEmpty else { return nil }
        let t = actual.isFinite ? actual : 0
        let elegido =
            validos.first { t >= $0.inicio - 0.25 && t <= $0.fin + 0.25 } ?? validos[validos.count - 1]
        guard elegido.fin > elegido.inicio else { return nil }
        return VentanaDirecto(inicio: elegido.inicio, fin: elegido.fin)
    }
}

public enum Directo {
    /// `rebuild` de cada modo (PLAYBACK_PROFILES): colchón tras un parón y tope de distancia al directo.
    public static func rebuild(_ modo: PlaybackMode) -> Double {
        switch modo {
        case .stable: 12
        case .balanced: 8
        case .low: 4
        }
    }

    /// Colchón que deja «Ir al directo» (`liveBufferSafety`):
    /// `min(rebuild del modo, max(1,2, duración de la ventana × 0,25))`.
    public static func colchonSeguridad(modo: PlaybackMode, duracionVentana: Double) -> Double {
        min(rebuild(modo), max(1.2, duracionVentana * 0.25))
    }

    /// Borde LIVE útil (`resolveLiveTarget`): el punto más avanzado que aún
    /// conserva el colchón de seguridad. `nil` sin ventana válida.
    public static func objetivo(ventana: VentanaDirecto?, preferido: Double? = nil, seguridad: Double = 0)
        -> Double?
    {
        guard let ventana, ventana.inicio.isFinite, ventana.fin.isFinite, ventana.duracion > 0 else { return nil }
        let pedida = seguridad.isFinite ? max(0, seguridad) : 0
        let disponible = min(pedida, max(0, ventana.duracion - 0.5))
        let bordeSeguro = ventana.fin - disponible
        let deseado = (preferido?.isFinite == true ? preferido : nil) ?? bordeSeguro
        return min(max(min(deseado, bordeSeguro), ventana.inicio), ventana.fin)
    }
}

/// Umbrales del reproductor (los de la web con HLS nativo, que es lo que usa AVPlayer).
public enum UmbralesReproductor {
    /// El vigilante da un «tic» cada 1,5 s.
    public static let tic: TimeInterval = 1.5
    /// Conectando sin imagen: 36 tics (54 s) hasta reconectar (el remux puede tardar).
    public static let limiteConexionTics = 36
    /// Imagen parada 4 tics (6 s) con vídeo por delante → saltar al directo.
    public static let empujonDirectoTics = 4
    /// Retraso mínimo respecto al borde útil para que el salto al directo tenga sentido.
    public static let empujonMinRetrasoS: Double = 6
    /// Vídeo ya descargado por delante del cabezal que cuenta como «hay vídeo disponible».
    public static let videoDisponibleS: Double = 2
    /// Imagen parada 16 tics (24 s) → reconexión.
    public static let reconexionCongeladoTics = 16
    /// Gracia tras (re)conectar: 4 tics sin contar la imagen parada.
    public static let graciaTics = 4
    /// Lo que tiene que avanzar el cabezal para contar como «avanza».
    public static let avanceMinimoS: Double = 0.2
    /// Presupuesto de reconexiones: se cuentan las de los últimos 3 minutos.
    public static let ventanaReconexion: TimeInterval = 180
    /// Aviso «sigue» al backend cada 2 min como poco.
    public static let sigueCada: TimeInterval = 120
    /// Retroceso del botón −30.
    public static let retrocesoS: Double = 30
    /// «Ya en directo» para decidir si el botón salta.
    public static let toleranciaDirectoS: Double = 1.25
    /// Para PINTAR «en directo» se deja más margen (el colchón oscila con la red).
    public static let mostrarDirectoS: Double = 3
    /// Una pausa que no hemos pedido se da por buena si sigue así este tiempo.
    public static let confirmarPausaAjena: TimeInterval = 0.7
}

/// Lo que pinta el botón «Directo».
public struct InfoDirecto: Sendable, Hashable {
    /// Hay ventana de directo (si no, el botón no se enseña).
    public var disponible: Bool
    /// Pegado al borde útil (con el margen de `mostrarDirectoS`).
    public var enDirecto: Bool
    /// Segundos reales por detrás del último fragmento anunciado.
    public var retraso: Double
    /// Segundos por detrás del borde útil (lo que se puede recuperar pulsando).
    public var recuperable: Double

    public init(disponible: Bool, enDirecto: Bool, retraso: Double, recuperable: Double) {
        self.disponible = disponible
        self.enDirecto = enDirecto
        self.retraso = retraso
        self.recuperable = recuperable
    }

    public static let nada = InfoDirecto(disponible: false, enDirecto: true, retraso: 0, recuperable: 0)

    /// Mide dónde está el cabezal respecto al directo.
    public static func medir(ventana: VentanaDirecto?, actual: Double, modo: PlaybackMode) -> InfoDirecto {
        guard let ventana, actual.isFinite else { return .nada }
        let seguridad = Directo.colchonSeguridad(modo: modo, duracionVentana: ventana.duracion)
        guard let objetivo = Directo.objetivo(ventana: ventana, seguridad: seguridad) else { return .nada }
        let recuperable = max(0, objetivo - actual)
        return InfoDirecto(
            disponible: true, enDirecto: recuperable <= UmbralesReproductor.mostrarDirectoS,
            retraso: max(0, ventana.fin - actual), recuperable: recuperable)
    }

    /// «Directo» o «−12 s».
    public var textoBoton: String {
        enDirecto ? "Directo" : "−\(Int(recuperable.rounded())) s"
    }

    /// Lo mismo para VoiceOver.
    public var etiquetaAccesible: String {
        let segundos = Int(retraso.rounded())
        return enDirecto
            ? "En directo, con \(segundos) segundos de retraso"
            : "Ir al directo; vas \(Int(recuperable.rounded())) segundos por detrás"
    }
}
