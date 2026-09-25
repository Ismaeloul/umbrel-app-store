import CoreText
import SwiftUI

/* PROVISIONAL de I0 (fase 0.3b): lo MÍNIMO de Palco (b-arquitectura §2.2, módulo P) que necesitan los
   contratos de §2.3-§2.8 para compilar, con las firmas EXACTAS del contrato:
   - §2.2.3 `Mona.fuente` (sin caché) · §2.2.7 `PulsoHaptico`, `Haptica`, `TipoHaptico.feedback`,
     `HapticaRaiz` · §2.2.10 los `@Entry` · §2.2.11 `TamanoHoja` · §2.8 `SistemaView` (Color.clear).
   P trabaja en paralelo en nativa/palco sobre Sources/Palco y escribe todo esto de verdad. AL FUSIONAR
   nativa/palco SE BORRA ESTE FICHERO ENTERO (los mismos nombres en Sources/Palco lo sustituyen; si
   quedan los dos, el compilador dice «invalid redeclaration»). El linter le deja el `.sensoryFeedback(`
   (R5) solo mientras exista. */

// MARK: §2.2.3 Tipografía (solo lo que usa la raíz)

enum Mona {
    private static let wdth = 0x7764_7468, wght = 0x7767_6874

    /// Siempre los dos ejes (si falta uno, CoreText usa el defecto: wght 200).
    static func fuente(_ tamano: Double, peso: Double, anchura: Double = 100) -> Font {
        Font(ctFont(tamano, peso: peso, anchura: anchura))
    }

    static func ctFont(_ tamano: Double, peso: Double, anchura: Double = 100) -> CTFont {
        let ejes: [NSNumber: NSNumber] = [
            NSNumber(value: wdth): NSNumber(value: anchura), NSNumber(value: wght): NSNumber(value: peso),
        ]
        let atributos: [CFString: Any] = [
            kCTFontNameAttribute: "PalcoSans-ExtraLight",
            kCTFontVariationAttribute: ejes,
        ]
        let descriptor = CTFontDescriptorCreateWithAttributes(atributos as CFDictionary)
        return CTFontCreateWithFontDescriptor(descriptor, CGFloat(tamano), nil)
    }
}

// MARK: §2.2.7 Háptica

struct PulsoHaptico: Equatable, Sendable {
    var n: Int
    var tipo: TipoHaptico
}

@MainActor @Observable final class Haptica {
    private(set) var pulso = PulsoHaptico(n: 0, tipo: .seleccion)
    var reducirMovimiento = false
    @ObservationIgnored private var ultimo: (tipo: TipoHaptico, ms: Double)?
    private let origen = ContinuousClock.now

    /// La ÚNICA forma de hacer vibrar el iPhone.
    func disparar(_ tipo: TipoHaptico) {
        let t = ContinuousClock.now - origen
        let ms = Double(t.components.seconds) * 1000 + Double(t.components.attoseconds) / 1e15
        guard ReglaHaptica.suena(tipo, ahoraMs: ms, ultimo: ultimo, reducirMovimiento: reducirMovimiento) else {
            return
        }
        ultimo = (tipo, ms)
        pulso = PulsoHaptico(n: pulso.n &+ 1, tipo: tipo)
    }
}

extension TipoHaptico {
    var feedback: SensoryFeedback {
        switch self {
        case .seleccion: .selection
        case .ligera: .impact(weight: .light)
        case .media: .impact(weight: .medium)
        case .fuerte: .impact(weight: .heavy)
        case .rigida: .impact(flexibility: .rigid)
        case .exito: .success
        case .aviso: .warning
        case .error: .error
        }
    }
}

/// El ÚNICO `.sensoryFeedback(` de la app (en RaizView).
struct HapticaRaiz: ViewModifier {
    let haptica: Haptica
    func body(content: Content) -> some View {
        content.sensoryFeedback(trigger: haptica.pulso) { _, nuevo in nuevo.tipo.feedback }
    }
}

// MARK: §2.2.10 Valores de entorno

extension EnvironmentValues {
    @Entry var maquetacion: Maquetacion = .referencia
    /// false en las pestañas ocultas: sondeos, relojes y animaciones continuas parados.
    @Entry var vistaActiva: Bool = true
    @Entry var modoDemo: Bool = false
    /// Transparencia reducida del sistema O de la app (Ajustes › Apariencia).
    @Entry var cristalOpaco: Bool = false
    /// Movimiento reducido del sistema O -AceNeoMovimientoReducido (capturas).
    @Entry var movimientoReducido: Bool = false
    @Entry var radioInterior: CGFloat = 8
    @Entry var cacheImagenes: CacheImagenes? = nil
}

// MARK: §2.2.11 Tamaño de las hojas

enum TamanoHoja: Sendable { case sm, md, lg }  // anchos de la web en ≥ 768: 420 / 560 / 760

// MARK: §2.8 Galería «Sistema» (P)

struct SistemaView: View {
    var body: some View {
        Color.clear
            .overlay { Text("Sistema") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.pantalla("sistema"))
    }
}
