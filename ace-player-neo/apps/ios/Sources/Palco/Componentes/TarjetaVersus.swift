import SwiftUI

/// `<VersusCard>` de la web: tarjeta 16:9 con dos mitades de club (a1 §10.15; ui/VersusCard.css). Isla oscura
/// entera. SIN marcador (regla de la web). `senal` es la cápsula de señal de arriba a la derecha.
struct TarjetaVersus<Senal: View>: View {
    enum Tamano: Sendable { case sm, md, lg, xl }

    let datos: DatosVersus
    let tamano: Tamano
    let seleccionada: Bool
    let senal: Senal
    @Environment(\.maquetacion) private var maquetacion
    @State private var ancho: CGFloat = 0

    init(_ datos: DatosVersus, tamano: Tamano = .md, seleccionada: Bool = false, @ViewBuilder senal: () -> Senal) {
        self.datos = datos
        self.tamano = tamano
        self.seleccionada = seleccionada
        self.senal = senal()
    }

    private var medidas: MedidasVersus {
        let plano: TamanoVersus
        switch tamano {
        case .sm: plano = .sm
        case .md: plano = .md
        case .lg: plano = .lg
        case .xl: plano = .xl
        }
        return MedidasVersus(tamano: plano, movil: maquetacion.tipo == .movil)
    }

    var body: some View {
        let m = medidas
        let forma = RoundedRectangle(cornerRadius: m.radio, style: .circular)
        ZStack {
            FondoVersus(local: datos.mitadLocal, visitante: datos.mitadVisitante, terminado: datos.terminado)
            ColocarEnFraccion(x: 0.5, y: m.centroEscudos) {
                BloqueEscudos(datos, tamano: m.escudo).scaleEffect(m.escalaEscudos)
            }
            capas(m)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { ancho = $0 }
        .clipShape(forma)
        .overlay { if seleccionada { forma.strokeBorder(Palco.accent, lineWidth: 2) } }
        .background { if datos.enPantalla { forma.stroke(Palco.accent, lineWidth: 4) } }  // `0 0 0 2px --accent`
        .sombra(.s3, forma: forma)
        .foregroundStyle(Color.white)
        .islaOscura()
    }

    @ViewBuilder private func capas(_ m: MedidasVersus) -> some View {
        ArribaVersus(datos: datos, grande: m.grande, senal: senal)
            .padding(m.relleno)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        PieVersus(datos: datos, medidas: m, siglas: datos.enPantalla && ancho > 0 && ancho < 300)
            .padding(.trailing, datos.enPantalla ? ancho * 0.34 : 0)
            .padding(m.relleno)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        if datos.enPantalla {
            Capsula("En pantalla", tono: .oro, tamano: .sm, punto: true)
                .padding(m.relleno)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        }
    }
}

/// Los tamaños de la tarjeta, sin el genérico.
enum TamanoVersus: Sendable { case sm, md, lg, xl }

/// Medidas por tamaño (VersusCard.css; xl en vertical < 768: escudos al 80 %, centro al 38 %, nombres 17).
struct MedidasVersus: Sendable {
    let tamano: TamanoVersus
    let movil: Bool

    var relleno: CGFloat {
        switch tamano {
        case .sm: 10
        case .md, .lg: 12
        case .xl: 16
        }
    }
    var radio: CGFloat {
        switch tamano {
        case .sm: R.s
        case .md, .lg: R.m
        case .xl: R.xl
        }
    }
    var escudo: CGFloat {
        switch tamano {
        case .sm: 40
        case .md: 56
        case .lg: 64
        case .xl: 84
        }
    }
    var centroEscudos: CGFloat {
        switch tamano {
        case .sm: 0.40
        case .md, .lg: 0.42
        case .xl: movil ? 0.38 : 0.44
        }
    }
    var escalaEscudos: CGFloat { tamano == .xl && movil ? 0.8 : 1 }
    var nombres: Double {
        switch tamano {
        case .sm: 13
        case .md: 15
        case .lg: 17
        case .xl: movil ? 17 : 30
        }
    }
    var separacionPie: CGFloat { tamano == .xl ? 4 : 2 }
    var grande: Bool { tamano == .lg || tamano == .xl }
}

/// Coloca su único hijo centrado en (`x`, `y`) como fracción de la caja (`left: 50%; top: 42%;
/// transform: translate(-50%, -50%)`).
struct ColocarEnFraccion: Layout {
    var x: CGFloat
    var y: CGFloat

    init(x: CGFloat, y: CGFloat) {
        self.x = x
        self.y = y
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        proposal.replacingUnspecifiedDimensions()
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let punto = CGPoint(x: bounds.minX + bounds.width * x, y: bounds.minY + bounds.height * y)
        for vista in subviews {
            vista.place(at: punto, anchor: .center, proposal: .unspecified)
        }
    }
}

/// Las dos mitades con sus luces y el velo (VersusCard.css `.versus__half--*`, `.versus__veil`).
private struct FondoVersus: View {
    let local: RGB
    let visitante: RGB
    let terminado: Bool

    var body: some View {
        ZStack {
            HStack(spacing: 0) {
                MitadVersus(local: true, color: local)
                MitadVersus(local: false, color: visitante)
            }
            .opacity(terminado ? 0.72 : 1)
            VeloVersus()
        }
    }
}

/// Local: `radial(90% 100% at 0 0, #fff α.14 → 60 %) + linear(160°, h, mix(h 78 %, #0a0d12))`.
/// Visitante: `radial(90% 100% at 100% 100%, #fff α.10 → 60 %) + linear(160°, mix(a 88 %, #fff), a)`.
private struct MitadVersus: View {
    let local: Bool
    let color: RGB
    @State private var caja = CGSize(width: 1, height: 1)

    private var colores: [Color] {
        if local { return [color.color, MezclaOKLab.mezclar(color, PalcoFijo.tintaOscura, p: 0.78).color] }
        return [MezclaOKLab.mezclar(color, RGB(r: 1, g: 1, b: 1), p: 0.88).color, color.color]
    }

    var body: some View {
        ZStack {
            Degradado.lineal(160, colores, ancho: caja.width, alto: caja.height)
            Degradado.elipse(Color.white.opacity(local ? 0.14 : 0.1), radioX: 0.9 * caja.width,
                             radioY: caja.height, hasta: 0.6, centro: local ? .topLeading : .bottomTrailing)
        }
        .clipped()
        .onGeometryChange(for: CGSize.self) { $0.size } action: { caja = $0 }
    }
}

/// `linear(180°: .42 · .05 30 % · .05 45 % · .82)` + `radial(60% 55% at 50% 52%, .28 → 70 %)`.
private struct VeloVersus: View {
    @State private var caja = CGSize(width: 1, height: 1)

    private static let paradas: [Gradient.Stop] = [
        Gradient.Stop(color: Color.black.opacity(0.42), location: 0),
        Gradient.Stop(color: Color.black.opacity(0.05), location: 0.3),
        Gradient.Stop(color: Color.black.opacity(0.05), location: 0.45),
        Gradient.Stop(color: Color.black.opacity(0.82), location: 1),
    ]

    var body: some View {
        ZStack {
            LinearGradient(stops: VeloVersus.paradas, startPoint: .top, endPoint: .bottom)
            Degradado.elipse(Color.black.opacity(0.28), radioX: 0.6 * caja.width, radioY: 0.55 * caja.height,
                             hasta: 0.7, centro: UnitPoint(x: 0.5, y: 0.52))
        }
        .clipped()
        .onGeometryChange(for: CGSize.self) { $0.size } action: { caja = $0 }
    }
}

/// Arriba: cuándo (cápsula sm de cristal, MAYÚSCULAS con +0,06 em; directo con punto) · «Tu equipo» · señal.
private struct ArribaVersus<Senal: View>: View {
    let datos: DatosVersus
    let grande: Bool
    let senal: Senal

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Capsula(datos.cuando.uppercased(with: Locale(identifier: "es_ES")),
                        tono: datos.enDirecto ? .directo : .neutral, tamano: .sm, punto: datos.enDirecto,
                        cristal: .video)
                    .environment(\.trackingCapsulaEm, 0.06)
                if datos.tuEquipo { MarcaTuEquipo(grande: grande) }
            }
            Spacer(minLength: 0)
            senal
        }
    }
}

/// `.versus__mine`: alto 24, oro, estrella rellena de 16 y «Tu equipo» (solo visible en lg y xl).
private struct MarcaTuEquipo: View {
    let grande: Bool

    var body: some View {
        HStack(spacing: 5) {
            IconoPalco(.starF, tamano: 16)
            if grande {
                Text("Tu equipo").estilo(EstiloTexto(tamano: 11, peso: 700, trackingEm: 0.02, altoLinea: 1))
            }
        }
        .padding(.leading, grande ? 6 : 5)
        .padding(.trailing, grande ? 8 : 5)
        .frame(height: 24)
        .background(Palco.accent, in: Capsule())
        .foregroundStyle(Palco.onAccent)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Tu equipo")
    }
}

/// Abajo: «Local» / «vs. Visitante» (800 · wdth 125 · −0,015 em · lh 1,15) y la competición (solo xl).
private struct PieVersus: View {
    let datos: DatosVersus
    let medidas: MedidasVersus
    let siglas: Bool

    private var estiloNombre: EstiloTexto {
        EstiloTexto(tamano: medidas.nombres, peso: 800, anchura: 125, trackingEm: -0.015, altoLinea: 1.15)
    }

    private var estiloVs: EstiloTexto {
        EstiloTexto(tamano: max(11, medidas.nombres * 0.8), peso: 600)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: medidas.separacionPie) {
            VStack(alignment: .leading, spacing: 0) {
                nombre(datos.local)
                HStack(alignment: .firstTextBaseline, spacing: CGFloat(medidas.nombres * 0.3)) {
                    Text("vs.").estilo(estiloVs).foregroundStyle(Color.white.opacity(0.7))
                    nombre(datos.visitante)
                }
            }
            if medidas.tamano == .xl {
                Text(datos.competicion)
                    .estilo(EstiloTexto(tamano: 13, peso: 600, altoLinea: 1.45))
                    .foregroundStyle(Color.white.opacity(0.76))
                    .lineLimit(1)
            }
        }
        .shadow(color: Color.black.opacity(0.6), radius: 1.5, y: 1)  // text-shadow 0 1 3
    }

    private func nombre(_ equipo: DatosEquipo) -> some View {
        Text(siglas ? equipo.siglas : equipo.nombre)
            .estilo(estiloNombre)
            .lineLimit(1)
            .accessibilityLabel(equipo.nombre)
    }
}
