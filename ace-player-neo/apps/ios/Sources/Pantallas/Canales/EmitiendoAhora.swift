import SwiftUI

/* «Emitiendo ahora» (M5; a5 §3.3; OnAirStrip.tsx): tus canales (favoritos y luego recientes) que dan un partido
   en juego, en un carril a sangre de carteles de `min(252, 74 %)`. Sin ninguno, la sección no existe. */

struct EmitiendoAhora: View {
    let entradas: [EntradaEmitiendo]
    let enPantalla: String?
    let favoritos: Set<String>
    let tapado: (EntradaEmitiendo) -> Bool
    let reproducir: (Item) -> Void
    @Environment(\.maquetacion) private var maquetacion

    private var anchoCartel: CGFloat { CGFloat(min(252, 0.74 * maquetacion.ancho)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            titulo
            CarrilCarteles(
                entradas, anchoCelda: anchoCartel, sangrado: CGFloat(maquetacion.rellenoIzquierdo),
                etiqueta: "Canales emitiendo ahora"
            ) { (entrada: EntradaEmitiendo) in
                CartelCanal(
                    entrada: entrada, enPantalla: enPantalla == entrada.item.id, favorito: favoritos.contains(entrada.item.id),
                    tapado: tapado(entrada)
                ) {
                    reproducir(entrada.item)
                }
            }
            .padding(.leading, -CGFloat(maquetacion.rellenoIzquierdo))
            .padding(.trailing, -CGFloat(maquetacion.rellenoDerecho))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.emitiendoAhora)
    }

    private var titulo: some View {
        HStack(spacing: 6) {
            PuntoDirecto()
            Text("Emitiendo ahora")
                .estilo(EstiloTexto(tamano: 17, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.45))
                .foregroundStyle(Palco.text)
            Num("\(entradas.count)", tamano: 13, etiqueta: ReglasBiblioteca.canales(entradas.count))
                .foregroundStyle(Palco.text3)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
