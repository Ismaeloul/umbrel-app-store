import SwiftUI

/// Lo que dice la cápsula de la esquina de la tarjeta de un partido.
public struct CapsulaSenal: Hashable, Sendable {
    public enum Tono: Sendable, Hashable { case ok, floja, fallo, comprobando, neutro, directo }

    public var texto: String
    public var tono: Tono
    /// Con punto (●) delante en vez de icono.
    public var punto: Bool
    public var icono: String?

    public init(texto: String, tono: Tono, punto: Bool = false, icono: String? = nil) {
        self.texto = texto
        self.tono = tono
        self.punto = punto
        self.icono = icono
    }
}

/// Reglas de la cápsula de señal (las del prototipo, `SignalCapsule`):
/// «Comprobando» solo con fuentes de verdad en cola o probándose; sin
/// sesión: en directo o a menos de 45 min → «Señal lista»; a menos de 6 h →
/// «Se comprueba 45 min antes»; terminado → «Final»; si no, nada.
public enum ReglasSenal {
    /// Cuánto antes empieza a comprobar el servidor las fuentes.
    public static let minutosPrecalentado = 45

    /// - Parameters:
    ///   - marcador: el de ESPN, si lo hay.
    ///   - faltan: minutos hasta el inicio (negativo si ya empezó; nil sin hora).
    ///   - resumen: lo que se sabe de sus fuentes (nil si no se ha preguntado).
    ///   - compacta: textos cortos para la tarjeta pequeña.
    public static func capsula(
        marcador: LiveScore?, faltan: Int?, resumen: ResumenFuentes?, compacta: Bool = false
    ) -> CapsulaSenal? {
        if marcador?.state == "post" { return CapsulaSenal(texto: "Final", tono: .neutro) }
        if let resumen, resumen.tono != .neutro {
            switch resumen.tono {
            case .ok: return CapsulaSenal(texto: resumen.etiqueta, tono: .ok, punto: true)
            case .floja: return CapsulaSenal(texto: resumen.etiqueta, tono: .floja)
            case .fallo: return CapsulaSenal(texto: resumen.etiqueta, tono: .fallo, icono: "exclamationmark.triangle")
            case .comprobando: return CapsulaSenal(texto: resumen.etiqueta, tono: .comprobando, icono: "ellipsis")
            case .neutro: break
            }
        }
        let enJuego = marcador?.state == "in" || (faltan.map { $0 <= 0 && $0 > -120 } ?? false)
        guard let faltan else {
            return enJuego ? CapsulaSenal(texto: "Señal lista", tono: .ok, punto: true) : nil
        }
        if enJuego || faltan < minutosPrecalentado {
            return CapsulaSenal(texto: "Señal lista", tono: .ok, punto: true)
        }
        if faltan < 6 * 60 {
            return CapsulaSenal(
                texto: compacta ? "45 min antes" : "Se comprueba 45 min antes", tono: .neutro, icono: "clock")
        }
        return nil
    }
}

extension CapsulaSenal.Tono {
    var tonoCapsula: TonoCapsula {
        switch self {
        case .ok: .ok
        case .floja: .floja
        case .fallo: .fallo
        case .comprobando: .comprobando
        case .neutro: .neutro
        case .directo: .directo
        }
    }
}

/// La cápsula pintada (sobre la tarjeta o suelta).
struct CapsulaSenalView: View {
    let capsula: CapsulaSenal
    var sobreImagen = true
    var compacta = false

    var body: some View {
        CapsulaPalco(
            texto: capsula.texto, tono: capsula.tono.tonoCapsula, punto: capsula.punto, icono: capsula.icono,
            sobreImagen: sobreImagen, compacta: compacta
        )
        .accessibilityLabel("Señal: \(capsula.texto)")
    }
}
