#if DEBUG
    import SwiftUI

    /// Bloque 5: la barra de estado de la ventana (canarios C2 y C13). «Barra clara» y «Inmersivo» publican en
    /// `EstadoVentana` como lo harán el teatro y la agenda; `HostingRaiz` lo vigila con `Observations` y pide al
    /// sistema el estilo, la barra oculta y el indicador de inicio. Debajo, un héroe y una lista larga para
    /// «tocar la barra de estado sube» (a2 §24, §27.5: el ScrollView del banco es el único activo).
    struct LabBarraEstado: View {
        @Environment(EstadoVentana.self) private var ventana
        private let filas = Array(1...24)

        var body: some View {
            BloqueLab(5, "Barra de estado") {
                VStack(alignment: .leading, spacing: S.s3) {
                    Flujo(horizontal: S.s2, vertical: S.s2) {
                        BotonPalco("Barra clara", variante: .quieto, tamano: .sm, pulsado: ventana.fondoOscuroArriba) {
                            ventana.fondoOscuroArriba.toggle()
                        }
                        BotonPalco("Inmersivo", variante: .quieto, tamano: .sm, pulsado: ventana.inmersivo) {
                            ventana.inmersivo.toggle()
                        }
                    }
                    heroe
                    VStack(spacing: 0) {
                        ForEach(filas, id: \.self) { n in
                            FilaListaLarga(numero: n)
                        }
                    }
                    .tarjeta(radio: R.l, relleno: 0)
                }
            }
        }

        private var heroe: some View {
            VStack(alignment: .leading, spacing: S.s2) {
                Text("Agenda").estilo(.titularVista).foregroundStyle(Palco.onVideo)
                Text("Sube arriba del todo y cambia el tema: la barra de estado debe leerse sobre el héroe.")
                    .estilo(.subtituloVista)
                    .foregroundStyle(Palco.onVideo2)
            }
            .padding(S.s4)
            .frame(maxWidth: .infinity, minHeight: 160, alignment: .bottomLeading)
            .background(FondoRetransmision())
            .clipShape(RoundedRectangle(cornerRadius: R.l, style: .circular))
            .islaOscura()
        }
    }

    private struct FilaListaLarga: View {
        let numero: Int

        var body: some View {
            HStack {
                Text("Fila \(numero) de la lista larga").estilo(.cuerpo).foregroundStyle(Palco.text)
                Spacer()
                IconoPalco(.chevR, tamano: 20).foregroundStyle(Palco.text3)
            }
            .padding(.horizontal, S.s4)
            .frame(minHeight: 52)
            .overlay(alignment: .top) { Rectangle().fill(Palco.lineSoft).frame(height: numero == 1 ? 0 : 1) }
        }
    }
#endif
