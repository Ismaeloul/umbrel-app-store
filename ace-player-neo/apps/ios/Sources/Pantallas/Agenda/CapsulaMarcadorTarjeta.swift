import SwiftUI

/* Las cápsulas de la agenda (M5; a3 §4.3, §7.2, §8.2, §8.3): la de señal (glifo + palabra, de cristal) y la
   cápsula «Marcador» (tapada → ojo; destapada → las cifras, que giran como una paleta al destapar y ruedan
   al cambiar: un gol). En la tarjeta es de cristal (28); en el héroe, sin cristal y de 44. */

/// `SignalCapsule`: cápsula del tono de la señal con el glifo del medidor y la palabra (a3 §7.2).
struct CapsulaSenal: View {
    let senal: SenalPartido
    let grande: Bool

    private var tinta: Color {
        switch TarjetasAgenda.tono(senal.estado) {
        case .ok: Palco.okInk
        case .weak: Palco.weakInk
        case .fail: Palco.failInk
        case .neutral: Palco.onVideo
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            MedidorSenal(senal.estado, tamano: .sm, ocultarPalabra: true, compacto: true)
            Text(SenalesPartido.palabra(senal)).estilo(grande ? .capsula : .capsulaSm).lineLimit(1)
        }
        .foregroundStyle(tinta)
        .padding(.horizontal, grande ? 10 : 8)
        .frame(height: grande ? 28 : 24)
        .background {
            Color.clear.cristal(.video, en: Capsule()).bordeInterior(Color.white.opacity(0.12), forma: Capsule())
        }
        .islaOscura()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SenalesPartido.palabra(senal))
        .accessibilityHint(senal.resumen)
    }
}

/// La cápsula «Marcador»: tapada / destapada, con la háptica ligera de la web.
struct CapsulaMarcador: View {
    enum Variante: Sendable { case tarjeta, heroe }

    let partido: FootballMatch
    let marcador: LiveScore
    let destapado: Bool
    let variante: Variante
    /// Tapada en tarjetas ≤ 280 de ancho: solo el ojo.
    let soloIcono: Bool
    @Environment(MarcadoresDestapados.self) private var destapados
    @Environment(Haptica.self) private var haptica
    @State private var girar = false

    private var titulo: String { ReglasAgenda.titulo(partido) }

    var body: some View {
        Button(action: alternar) { etiqueta }
            .buttonStyle(EstiloPulsar())
            .foregroundStyle(variante == .heroe ? Palco.text : Palco.onVideo)
            .contentShape(Rectangle().inset(by: soloIcono && !destapado ? -8 : -2))
            .accessibilityLabel(destapado
                ? "Tapar el marcador de \(titulo): \(marcador.home) a \(marcador.away)"
                : "Ver marcador de \(titulo)")
            .accessibilityHint(destapado ? "Tapar el marcador" : "Ver el marcador (tu emisión puede ir por detrás del directo)")
            .accessibilityIdentifier(IDUI.capsulaMarcador)
    }

    private func alternar() {
        haptica.disparar(.ligera)
        if destapado {
            girar = false
            destapados.tapar(partido.id)
        } else {
            girar = true
            destapados.destapar(partido.id)
            Task {
                try? await Task.sleep(for: .milliseconds(900))  // muelle héroe (800 ms) y la paleta ya ha girado
                girar = false
            }
        }
    }

    @ViewBuilder private var etiqueta: some View {
        if destapado {
            cifras.modifier(CajaMarcador(variante: variante, relleno: 10, separacion: 8))
        } else if soloIcono {
            IconoPalco(.eye, tamano: 16)
                .frame(width: 28, height: 28)
                .modifier(FondoMarcador(variante: variante))
        } else {
            HStack(spacing: 5) {
                IconoPalco(.eye, tamano: variante == .heroe ? 18 : 16).padding(.leading, -2)
                Text("Marcador").estilo(variante == .heroe ? EstiloTexto(tamano: 15, peso: 640, anchura: 88, altoLinea: 1) : .capsulaSm)
            }
            .modifier(CajaMarcador(variante: variante, relleno: variante == .heroe ? 16 : 9, separacion: 5))
        }
    }

    private var cifras: some View {
        let tamano: CGFloat = variante == .heroe ? 22 : 13
        let animacion: Num.Animacion = girar ? .paleta : .rueda
        return HStack(spacing: 0) {
            Num("\(marcador.home)", tamano: tamano, animacion: animacion)
            Text("–").estilo(EstiloTexto.cifras(Double(tamano))).opacity(0.6).padding(.horizontal, 1)
            Num("\(marcador.away)", tamano: tamano, animacion: animacion)
        }
    }
}

/// Caja de la cápsula con texto: alto 44 en el héroe (relleno 16/18), 28 en la tarjeta.
private struct CajaMarcador: ViewModifier {
    let variante: CapsulaMarcador.Variante
    let relleno: CGFloat
    let separacion: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(.leading, relleno)
            .padding(.trailing, variante == .heroe && relleno == 16 ? 18 : relleno)
            .frame(height: variante == .heroe ? 44 : 28)
            .modifier(FondoMarcador(variante: variante))
    }
}

/// Héroe: sin cristal, `--line-soft`. Tarjeta: cristal de vídeo con filo blanco al 12 %.
private struct FondoMarcador: ViewModifier {
    let variante: CapsulaMarcador.Variante

    func body(content: Content) -> some View {
        switch variante {
        case .heroe:
            content.background(Palco.lineSoft, in: Capsule())
        case .tarjeta:
            content
                .background {
                    Color.clear.cristal(.video, en: Capsule()).bordeInterior(Color.white.opacity(0.12), forma: Capsule())
                }
                .islaOscura()
        }
    }
}
