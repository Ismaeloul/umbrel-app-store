import SwiftUI

/* Tarjeta de primer uso (M5; a3 §11; FirstUseCard.tsx): siempre oscura, con la luz dorada, la estrella en su
   círculo, «Personaliza tu agenda» y «Ahora no» / «Personalizar». No bloquea nada. */

struct TarjetaPrimerUso: View {
    let ocupado: Bool
    let personalizar: () -> Void
    let ahoraNo: () -> Void

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 16) {
                marca
                textos
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                BotonPalco("Ahora no", variante: .fantasma, tamano: .sm, accion: ahoraNo).disabled(ocupado)
                BotonPalco("Personalizar", variante: .primario, tamano: .sm, accion: personalizar)
            }
        }
        .padding(20)
        .background { LuzDorada() }
        .background(Palco.glassVideoSolid)
        .clipShape(forma)
        .bordeInterior(Palco.accent.opacity(0.28), forma: forma)
        .sombra(.s2, forma: forma)
        .foregroundStyle(Color.white)
        .islaOscura()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Personaliza tu agenda")
        .accessibilityIdentifier(IDUI.tarjetaPrimerUso)
    }

    /// Círculo de 56, `rgba(255,214,10,.16)` con filo al 40 % y la estrella rellena de 28.
    private var marca: some View {
        IconoPalco(.starF, tamano: 28)
            .foregroundStyle(Palco.accent)
            .frame(width: 56, height: 56)
            .background(Palco.accent.opacity(0.16), in: Circle())
            .bordeInterior(Palco.accent.opacity(0.4), forma: Circle())
            .accessibilityHidden(true)
    }

    private var textos: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Personaliza tu agenda")
                .estilo(.tituloVacio)
                .accessibilityAddTraits(.isHeader)
            Text("Dinos tus ligas y equipos y la agenda pondrá primero lo tuyo. Mientras tanto ves todos los partidos.")
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// `.agenda-first__light`: `inset −40 % 30 % 10 % −20 %`, `radial(closest-side, oro al 26 % → transparente)`.
private struct LuzDorada: View {
    @State private var caja = CGSize(width: 1, height: 1)

    var body: some View {
        let ancho: CGFloat = caja.width * 1.1  // 100 % − 30 % + 20 %
        let alto: CGFloat = caja.height * 1.3  // 100 % + 40 % − 10 %
        let x: CGFloat = caja.width * -0.2
        let y: CGFloat = caja.height * -0.4
        Color.clear
            .onGeometryChange(for: CGSize.self) { $0.size } action: { caja = $0 }
            .overlay(alignment: .topLeading) {
                Degradado.elipse(Palco.accent.opacity(0.26), radioX: ancho / 2, radioY: alto / 2, hasta: 1, centro: .center)
                    .frame(width: ancho, height: alto)
                    .offset(x: x, y: y)
            }
            .allowsHitTesting(false)
    }
}
