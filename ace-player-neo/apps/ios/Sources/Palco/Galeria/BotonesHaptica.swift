import SwiftUI

/// Un botón por tipo de háptica (a1 §8), todos por el pulso central, y la cuenta de pulsos que han llegado a la
/// raíz: en el simulador no vibra, pero la cuenta dice que `HapticaRaiz` ha recibido el pulso (también con una
/// hoja abierta y en horizontal; LaboratorioUITests.testHapticaConHoja).
struct BotonesHaptica: View {
    @Environment(Haptica.self) private var haptica

    var body: some View {
        VStack(alignment: .leading, spacing: S.s2) {
            Flujo(horizontal: S.s2, vertical: S.s2) {
                ForEach(TipoHaptico.allCases, id: \.self) { tipo in
                    BotonPalco(tipo.rawValue, variante: .quieto, tamano: .sm) { haptica.disparar(tipo) }
                }
            }
            Text(cuenta).font(Martian.fuente(11)).foregroundStyle(Palco.text2)
        }
    }

    private var cuenta: String { "Pulsos: \(haptica.pulso.n) · \(haptica.pulso.tipo.rawValue)" }
}
