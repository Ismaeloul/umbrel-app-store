import SwiftUI

/// `.sis-icons`: rejilla `minmax(96, 1fr)` (3 columnas a 390), cada celda con el icono de 24 y su nombre.
struct RejillaIconos: View {
    private let columnas = [GridItem(.adaptive(minimum: 96), spacing: S.s2)]

    var body: some View {
        LazyVGrid(columns: columnas, spacing: S.s2) {
            ForEach(NombreIcono.allCases, id: \.self) { nombre in
                CeldaIcono(nombre: nombre)
            }
        }
    }
}

private struct CeldaIcono: View {
    let nombre: NombreIcono

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        VStack(spacing: 6) {
            IconoPalco(nombre, tamano: 24).foregroundStyle(Palco.text)
            Text(nombre.rawValue).font(Martian.fuente(11)).altoDeLineaMartian(1.45, tamano: 11).foregroundStyle(Palco.text2)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity)
        .background(Palco.surface, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
    }
}
