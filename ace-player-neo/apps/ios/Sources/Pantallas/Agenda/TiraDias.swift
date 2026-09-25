import SwiftUI

/* Tira de días (M5; a3 §5.1; DayStrip.tsx variante `line`): a sangre, pastillas de 58 × 74 separadas 4, la
   elegida con fondo `--surface` que aparece con el muelle rápido; «HOY» en `--accent-ink`; el recuento de lo
   que se ve con el filtro. Solo se recoloca la primera vez (sin animación) y cuando cambia el día elegido.
   Mientras carga, 7 pastillas vacías. */

struct DiaTira: Identifiable, Equatable {
    var fecha: String
    var etiqueta: EtiquetaDia
    var cuenta: Int
    var id: String { fecha }
}

struct TiraDias: View {
    let dias: [DiaTira]
    let elegido: String?
    let hoy: String
    let elegir: (String) -> Void
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido
    @State private var posicion = ScrollPosition(idType: String.self)
    @State private var centrado = false

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 4) {
                if dias.isEmpty {
                    ForEach(0..<7, id: \.self) { _ in PastillaVacia() }
                } else {
                    ForEach(dias) { dia in pastilla(dia) }
                }
            }
            .scrollTargetLayout()
            .padding(.top, 4)
            .padding(.bottom, 6)
            .subeConLaBarraDeEstado(false)
        }
        .scrollIndicators(.hidden)
        .scrollPosition($posicion, anchor: .center)
        .contentMargins(.leading, CGFloat(maquetacion.rellenoIzquierdo), for: .scrollContent)
        .contentMargins(.trailing, CGFloat(maquetacion.rellenoDerecho), for: .scrollContent)
        .padding(.leading, -CGFloat(maquetacion.rellenoIzquierdo))
        .padding(.trailing, -CGFloat(maquetacion.rellenoDerecho))
        .onChange(of: elegido, initial: true) { _, nuevo in centrar(nuevo) }
        .onChange(of: dias.isEmpty) { _, vacia in if !vacia { centrar(elegido) } }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.tiraDias)
    }

    /// La primera vez sin animación; después, suave (o al instante con movimiento reducido).
    private func centrar(_ fecha: String?) {
        guard let fecha, !dias.isEmpty else { return }
        if centrado && !reducido {
            withAnimation(Movimiento.estandar(false)) { posicion.scrollTo(id: fecha, anchor: .center) }
        } else {
            posicion.scrollTo(id: fecha, anchor: .center)
        }
        centrado = true
    }

    private func pastilla(_ dia: DiaTira) -> some View {
        PastillaDia(dia: dia, elegida: dia.fecha == elegido, esHoy: dia.fecha == hoy, pasado: dia.fecha < hoy) {
            elegir(dia.fecha)
        }
        .id(dia.fecha)
    }
}

/// Una pastilla: rótulo 11/760 +0,12 em, número 22/800/125, recuento 11/640/88 en celdas de 0,645 em.
private struct PastillaDia: View {
    let dia: DiaTira
    let elegida: Bool
    let esHoy: Bool
    let pasado: Bool
    let accion: () -> Void
    @Environment(\.movimientoReducido) private var reducido

    private var colorRotulo: Color {
        if esHoy { return Palco.accentInk }
        return elegida ? Palco.text : Palco.text2
    }

    var body: some View {
        Button(action: accion) {
            VStack(spacing: 3) {
                Text(dia.etiqueta.principal.uppercased(with: Locale(identifier: "es_ES")))
                    .estilo(EstiloTexto(tamano: 11, peso: 760, trackingEm: 0.12, altoLinea: 1))
                    .foregroundStyle(colorRotulo)
                Text(dia.etiqueta.numero)
                    .estilo(EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1))
                    .foregroundStyle(pasado || dia.cuenta == 0 ? Palco.text3 : Palco.text)
                Num("\(dia.cuenta)", estilo: EstiloTexto(tamano: 11, peso: 640, anchura: 88, altoLinea: 1.1))
                    .foregroundStyle(Palco.text3)
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .frame(minWidth: 58, minHeight: 74)
            .background { FondoElegida().opacity(elegida ? 1 : 0).animation(Movimiento.rapido(reducido), value: elegida) }
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(RoundedRectangle(cornerRadius: R.l, style: .circular))))
        .foregroundStyle(Palco.text)
        .accessibilityLabel(etiquetaAccesible)
        .accessibilityAddTraits(elegida ? [.isSelected] : [])
        .accessibilityIdentifier(IDUI.dia(dia.fecha))
    }

    /// «Hoy, jueves, 24 de septiembre: 5 partidos» (el prefijo solo en los relativos).
    private var etiquetaAccesible: String {
        let relativo = ["Hoy", "Mañana", "Ayer"].contains(dia.etiqueta.principal) ? "\(dia.etiqueta.principal), " : ""
        return "\(relativo)\(dia.etiqueta.larga): \(FormatoAgenda.partidos(dia.cuenta))"
    }
}

/// Fondo de la elegida: `--surface` + brillo arriba + filo `--line-soft` + `0 6 18 −10` negra al 45 %.
private struct FondoElegida: View {
    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        forma.fill(Palco.surface)
            .brilloSuperior(forma: forma)
            .bordeInterior(Palco.lineSoft, forma: forma)
            .sombra([CapaSombra(y: 6, desenfoque: 18, expansion: -10, color: Color.black.opacity(0.45))], forma: forma)
    }
}

/// Mientras carga: 58 × 74, radio 18, `--text-3` al 12 %, sin nada que pulsar ni leer.
private struct PastillaVacia: View {
    var body: some View {
        RoundedRectangle(cornerRadius: R.l, style: .circular)
            .fill(Palco.text3.opacity(0.12))
            .frame(width: 58, height: 74)
            .accessibilityHidden(true)
    }
}
