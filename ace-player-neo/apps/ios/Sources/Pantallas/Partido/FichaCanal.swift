import SwiftUI

/// La ficha del canal (pestaña «Canal», `ChannelDetails` de ChannelCenter.tsx; a4 §16): tarjeta de relleno 2 16,
/// radio 24, `--surface` y borde 1; filas de 44 con relleno 12 0 separadas por una línea: «Origen», «Fuentes del
/// mismo canal» («Solo esta» o el número) y «Content ID» / «Infohash» con el hash en mono 13 debajo. Sin la
/// chuleta de atajos (táctil).
struct FichaCanal: View {
    let hash: String
    let origen: String
    let hermanas: Int
    let ih: Bool

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
        VStack(spacing: 0) {
            fila("Origen") { Text(origen).estilo(estilo) }
            separador
            fila("Fuentes del mismo canal") {
                if hermanas > 0 { Num(String(hermanas), tamano: 15) } else { Text("Solo esta").estilo(estilo) }
            }
            separador
            VStack(alignment: .leading, spacing: 4) {
                Text(ih ? "Infohash" : "Content ID").estilo(estilo).foregroundStyle(Palco.text2)
                Text(hash).estilo(EstiloTexto(tamano: 13, peso: 400, anchura: 87.5, mono: true))
                    .foregroundStyle(Palco.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 2)
        .background(Palco.surface, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .accessibilityElement(children: .contain)
    }

    private var estilo: EstiloTexto { EstiloTexto(tamano: 15, peso: 450, altoLinea: 1.45) }

    private var separador: some View { Rectangle().fill(Palco.lineSoft).frame(height: 1) }

    private func fila<Valor: View>(_ termino: String, @ViewBuilder valor: () -> Valor) -> some View {
        HStack(spacing: 12) {
            Text(termino).estilo(estilo).foregroundStyle(Palco.text2)
            Spacer(minLength: 8)
            valor().foregroundStyle(Palco.text)
        }
        .padding(.vertical, 12)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}
