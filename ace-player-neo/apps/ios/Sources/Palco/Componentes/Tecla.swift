import SwiftUI

/// `<Kbd>` de la web (a1 §10.22; ui/Field.css `.kbd`): mínimo 26×26, relleno 0 7, radio 7, `--surface`,
/// borde interior `--line` y base de 2 abajo, Martian Mono 12 · 560 · wdth 87,5 · lh 1.
struct Tecla: View {
    let texto: String

    init(_ texto: String) {
        self.texto = texto
    }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: 7, style: .circular)
        Text(texto)
            .font(Martian.fuente(12, peso: 560))
            .foregroundStyle(Palco.text)
            .padding(.horizontal, 7)
            .frame(minWidth: 26, minHeight: 26)
            .background(Palco.surface, in: forma)
            .bordeInterior(Palco.line, forma: forma)
            .overlay(forma.subtracting(forma.offset(y: -2)).fill(Palco.line))  // `inset 0 −2px 0 --line`
    }
}
