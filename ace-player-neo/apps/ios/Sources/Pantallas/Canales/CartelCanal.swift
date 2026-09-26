import SwiftUI

/* Cartel de «Emitiendo ahora» (M5; a5 §3.3; ChannelPoster.tsx): 16:9, SIEMPRE oscuro, fondo con el tono del
   canal, la tesela de 52 al 40 %, arriba la estrella (si es favorito) y la cápsula «35' · En directo» (o
   «En pantalla» en oro si suena), abajo el nombre y el partido; debajo, si el marcador del que suena está
   tapado, «Ver marcador». Tocar: háptica ligera y reproduce. */

struct CartelCanal: View {
    let entrada: EntradaEmitiendo
    let enPantalla: Bool
    let favorito: Bool
    let tapado: Bool
    let reproducir: () -> Void
    @Environment(MarcadoresDestapados.self) private var destapados
    @Environment(Haptica.self) private var haptica

    private var titulo: String { entrada.item.title.isEmpty ? "Canal sin nombre" : entrada.item.title }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                haptica.disparar(.ligera)
                reproducir()
            } label: {
                cartel
            }
            .buttonStyle(EstiloPulsar(forma: AnyShape(RoundedRectangle(cornerRadius: R.m, style: .circular))))
            .foregroundStyle(Color.white)
            .accessibilityLabel(etiqueta)
            if tapado, Marcadores.pintable(entrada.directo.marcador) != nil {
                Capsula("Ver marcador", tamano: .sm, icono: .eye) {
                    haptica.disparar(.ligera)
                    destapados.destapar(entrada.directo.partido.id)
                }
                .accessibilityHint("Tu emisión va por detrás del directo")
            }
        }
    }

    private var etiqueta: String {
        let linea = LineaAntena.texto(CanalEnAntena(directo: entrada.directo, siguiente: nil, despues: []), tapado: tapado) ?? ""
        return "\(titulo), \(rotuloCapsula), \(linea)"
    }

    /// «35' · En directo», «Descanso · En directo», «En directo» (o «En pantalla» si suena aquí).
    private var rotuloCapsula: String {
        let estado = enPantalla ? "En pantalla" : "En directo"
        if IndiceAntena.descanso(entrada.directo.marcador) { return "Descanso · \(estado)" }
        if let minuto = IndiceAntena.minuto(entrada.directo.marcador) { return "\(minuto) · \(estado)" }
        return estado
    }

    private var cartel: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        return ZStack {
            FondoCartel(nombre: titulo).allowsHitTesting(false)
            ColocarEnFraccion(x: 0.5, y: 0.4) {
                MarcaCanal(nombre: titulo, forma: .tesela, tamano: 52).shadow(color: Color.black.opacity(0.5), radius: 8, y: 8)
            }
            arriba
            abajo
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(forma)
        .background { if enPantalla { forma.stroke(Palco.accent, lineWidth: 4) } }
        .sombra([CapaSombra(y: 10, desenfoque: 18, expansion: -12, color: Color.black.opacity(0.55))], forma: forma)
        .islaOscura()
    }

    private var arriba: some View {
        HStack(spacing: 6) {
            if favorito {
                IconoPalco(.starF, tamano: 16)
                    .foregroundStyle(Palco.onAccent)
                    .frame(width: 24, height: 24)
                    .background(Palco.accent, in: Circle())
                    .accessibilityHidden(true)
            }
            Spacer(minLength: 0)
            Capsula(rotuloCapsula, tono: enPantalla ? .oro : .directo, tamano: .sm, punto: !enPantalla, cristal: .video)
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var abajo: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(titulo)
                .estilo(EstiloTexto(tamano: 15, peso: 800, anchura: 125, trackingEm: -0.015, altoLinea: 1.15))
                .lineLimit(1)
            LineaAntena(antena: CanalEnAntena(directo: entrada.directo, siguiente: nil, despues: []), tapado: tapado)
                .foregroundStyle(Color.white.opacity(0.82))
        }
        .shadow(color: Color.black.opacity(0.6), radius: 1.5, y: 1)
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    }
}

/// Fondo: radial (85 % × 100 % en 18 % / 0 %) del tono claro (+0,16) sobre `linear(160°, #161b24 → #0a0d12)`
/// y el velo inferior (transparente hasta el 36 % → negro al 74 %).
private struct FondoCartel: View {
    let nombre: String
    @State private var caja = CGSize(width: 1, height: 1)

    private var tonoClaro: Color {
        let h = ColoresPartido.tono(nombre)
        let calido = h >= 40 && h <= 115
        let l: Double = calido ? 0.56 : 0.46
        let c: Double = calido ? 0.13 : 0.11
        return ColoresPartido.oklch(min(0.9, l + 0.16), c, h).color
    }

    private static let velo: [Gradient.Stop] = [
        Gradient.Stop(color: Color.black.opacity(0), location: 0.36),
        Gradient.Stop(color: Color.black.opacity(0.74), location: 1),
    ]

    var body: some View {
        ZStack {
            // #161b24 → #0a0d12: `--surface-2` oscuro (#171B23, a 1/255) y la tinta oscura de Palco.
            Degradado.lineal(160, [Palco.surface2, PalcoFijo.tintaOscura.color], ancho: caja.width, alto: caja.height)
            Degradado.elipse(tonoClaro, radioX: 0.85 * caja.width, radioY: caja.height, hasta: 0.62, centro: UnitPoint(x: 0.18, y: 0))
            LinearGradient(stops: FondoCartel.velo, startPoint: .top, endPoint: .bottom)
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { caja = $0 }
    }
}
