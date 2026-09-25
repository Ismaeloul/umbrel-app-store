import SwiftUI

/// El ÚNICO `.sensoryFeedback(` de la app (en RaizView; regla R5). Cada `PulsoHaptico` nuevo vibra una vez
/// con su tipo (canario C5: el cierre devuelve `SensoryFeedback`).
struct HapticaRaiz: ViewModifier {
    let haptica: Haptica
    func body(content: Content) -> some View {
        content.sensoryFeedback(trigger: haptica.pulso) { _, nuevo in nuevo.tipo.feedback }
    }
}
