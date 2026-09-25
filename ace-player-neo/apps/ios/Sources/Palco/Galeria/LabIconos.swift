#if DEBUG
    import SwiftUI

    /// Bloque 2 del banco: los 52 iconos a 20 y 24 (trazo) y la variante «relleno + trazo» del reproductor.
    struct LabIconos: View {
        private let columnas = [GridItem(.adaptive(minimum: 56), spacing: S.s2)]

        var body: some View {
            BloqueLab(2, "Iconos") {
                VStack(alignment: .leading, spacing: S.s4) {
                    LazyVGrid(columns: columnas, spacing: S.s2) {
                        ForEach(NombreIcono.allCases, id: \.self) { nombre in
                            CeldaIconoLab(nombre: nombre)
                        }
                    }
                    rellenos
                }
                .foregroundStyle(Palco.text)
                .tarjeta()
            }
        }

        /// a1 §10.1: pausa, reproducir, detener y `tv` rellenos a 24; reproducir a 32 («Toca para reproducir»).
        private var rellenos: some View {
            HStack(spacing: S.s4) {
                IconoPalco(.pause, tamano: 24, relleno: true)
                IconoPalco(.play, tamano: 24, relleno: true)
                IconoPalco(.stop, tamano: 24, relleno: true)
                IconoPalco(.tv, tamano: 24, relleno: true)
                IconoPalco(.play, tamano: 32, relleno: true)
                    .foregroundStyle(Palco.onAccent)
                    .frame(width: 52, height: 52)
                    .background(Palco.accent, in: Circle())
            }
        }
    }

    private struct CeldaIconoLab: View {
        let nombre: NombreIcono

        var body: some View {
            VStack(spacing: 4) {
                HStack(spacing: 6) {
                    IconoPalco(nombre, tamano: 20)
                    IconoPalco(nombre, tamano: 24)
                }
                Text(nombre.rawValue).font(Martian.fuente(9)).foregroundStyle(Palco.text2).lineLimit(1)
            }
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity)
            .panel(.normal, radio: R.s, relleno: 4)
        }
    }
#endif
