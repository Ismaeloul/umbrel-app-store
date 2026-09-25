#if DEBUG
    import SwiftUI

    /// Bloque 8: marcos del vuelo tarjeta → teatro (canario C15). Cada tarjeta publica su marco en `.global` con
    /// `.piezaVuelo` (el de la app: `onGeometryChange` → `TransicionTeatro.publicar`) dentro de un `LazyVStack`
    /// del ScrollView del banco. «Leer marcos» enseña el de la tarjeta 2: tras desplazar, debe casar con el que
    /// ve XCUITest (LaboratorioUITests.testMarcosGlobalesSiguenAlDesplazamiento).
    struct LabMarcos: View {
        @Environment(TransicionTeatro.self) private var transicion
        @State private var lecturas = 0
        @State private var lectura = "Sin leer"
        private let tarjetas = Array(1...8)

        var body: some View {
            BloqueLab(8, "Marcos del vuelo") {
                VStack(alignment: .leading, spacing: S.s3) {
                    BotonPalco("Leer marcos", variante: .quieto, tamano: .sm) { leer() }
                    Text(lectura).font(Martian.fuente(11)).foregroundStyle(Palco.text2)
                    LazyVStack(spacing: S.s2) {
                        ForEach(tarjetas, id: \.self) { numero in
                            TarjetaMarco(numero: numero)
                        }
                    }
                }
            }
        }

        private func leer() {
            lecturas += 1
            let clave = ClaveMarco(pieza: .tarjeta, partido: "lab-2")
            guard let marco = transicion.marcos[clave] else {
                lectura = "Lectura \(lecturas) · sin marco"
                return
            }
            let y = String(format: "%.2f", Double(marco.minY))
            let alto = String(format: "%.2f", Double(marco.height))
            lectura = "Lectura \(lecturas) · y=\(y) · alto=\(alto)"
        }
    }

    private struct TarjetaMarco: View {
        let numero: Int

        var body: some View {
            Text("Tarjeta \(numero)")
                .estilo(.cuerpo)
                .foregroundStyle(Palco.text)
                .padding(.horizontal, S.s4)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .background(Palco.surface, in: RoundedRectangle(cornerRadius: R.m, style: .circular))
                .piezaVuelo(.tarjeta, partido: "lab-\(numero)")
                .accessibilityElement(children: .combine)
        }
    }
#endif
