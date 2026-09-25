#if DEBUG
    import SwiftUI

    /// Bloque 3 del banco: cristal (barra de pestañas con píldora, cápsula y botón de vídeo) sobre el héroe de
    /// muestra y sobre `--bg`, con `cristalOpaco` a los dos valores (a1 §6; b-arquitectura §4.1.4 punto 3).
    struct LabCristal: View {
        var body: some View {
            BloqueLab(3, "Cristal") {
                VStack(alignment: .leading, spacing: S.s3) {
                    PruebaCristal(sobreHeroe: true, opaco: false)
                    PruebaCristal(sobreHeroe: true, opaco: true)
                    PruebaCristal(sobreHeroe: false, opaco: false)
                    PruebaCristal(sobreHeroe: false, opaco: true)
                    BloqueCristal()
                }
            }
        }
    }

    private struct PruebaCristal: View {
        let sobreHeroe: Bool
        let opaco: Bool

        var body: some View {
            VStack(alignment: .leading, spacing: S.s3) {
                Text("\(sobreHeroe ? "Sobre el héroe" : "Sobre --bg") · \(opaco ? "opaco" : "cristal")")
                    .font(Martian.fuente(11))
                    .foregroundStyle(sobreHeroe ? Palco.onVideo : Palco.text2)
                HStack(spacing: S.s2) {
                    Capsula("En directo · 72'", tono: .directo, tamano: .sm, punto: true, cristal: .video)
                    Capsula("Señal lista", tono: .ok, tamano: .sm, punto: true, cristal: .video)
                    BotonIcono(.pip, etiqueta: "Imagen en imagen", variante: .video) {}
                        .cristal(.videoBoton, en: Circle())
                }
                BarraPestanasMuestra()
            }
            .padding(S.s3)
            .background { if sobreHeroe { FondoRetransmision() } else { Palco.bg } }
            .clipShape(RoundedRectangle(cornerRadius: R.l, style: .circular))
            .environment(\.cristalOpaco, opaco)
        }
    }
#endif
