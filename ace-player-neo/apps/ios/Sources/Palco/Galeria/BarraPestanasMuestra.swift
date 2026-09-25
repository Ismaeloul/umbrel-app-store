#if DEBUG
    import SwiftUI

    /// La barra de pestañas de la web (a2 §4) para el banco: 64 de alto, radio 24, cristal denso, relleno 7,
    /// cuatro celdas iguales, píldora oro lavado de 50 y radio 18 en la activa, icono 24 + rótulo 11/620/88.
    struct BarraPestanasMuestra: View {
        private let destinos: [(NombreIcono, String)] = [
            (.agenda, "Agenda"), (.biblioteca, "Canales"), (.buscar, "Buscar"), (.ajustes, "Ajustes"),
        ]

        var body: some View {
            let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
            GlassEffectContainer(spacing: 0) {
                HStack(spacing: 0) {
                    ForEach(destinos, id: \.1) { destino in
                        celda(destino.0, destino.1, activa: destino.1 == "Agenda")
                    }
                }
                .padding(7)
                .frame(height: Alturas.barra)
                .cristal(.denso, en: forma)
            }
            .brilloSuperior(forma: forma)
            .sombra(.barra, forma: forma)
        }

        private func celda(_ icono: NombreIcono, _ titulo: String, activa: Bool) -> some View {
            VStack(spacing: 2) {
                IconoPalco(icono, tamano: 24)
                Text(titulo).estilo(.pestanaBarra)
            }
            .foregroundStyle(activa ? Palco.accentInk : Palco.text2)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { if activa { RoundedRectangle(cornerRadius: 18, style: .circular).fill(Palco.accentWash) } }
        }
    }
#endif
