#if DEBUG
    import SwiftUI

    /// Bloque 7 del banco: cifras que ruedan y paleta (canario C9) y el pan horizontal que convive con el
    /// ScrollView y cede a los carriles (canario C3, `DeslizamientoHorizontal`).
    struct LabGestos: View {
        @State private var goles = 1
        @State private var destapado = false
        @State private var dx: CGFloat = 0
        @State private var soltado = "sin soltar"

        var body: some View {
            BloqueLab(7, "Gestos y cifras") {
                VStack(alignment: .leading, spacing: S.s4) {
                    marcador
                    tarjetaDeslizable
                    CarrilCarteles(Array(MuestrasGaleria.carteles.prefix(3)), anchoCelda: 200, etiqueta: "Carril de prueba") { cartel in
                        TarjetaVersus(cartel.datos, tamano: .sm) { EmptyView() }
                    }
                    .padding(.horizontal, -S.gutter)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }

        private var marcador: some View {
            HStack(alignment: .center, spacing: S.s4) {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Num("2", tamano: 48, animacion: .rueda)
                    Text(" – ").font(Mona.fuente(48, peso: 700)).foregroundStyle(Palco.text3)
                    Num(String(goles), tamano: 48, animacion: .rueda)
                }
                .foregroundStyle(Palco.text)
                VStack(alignment: .leading, spacing: S.s2) {
                    BotonPalco("Gol", variante: .quieto, tamano: .sm) { goles += 1 }
                    BotonPalco(destapado ? "Tapar" : "Destapar", variante: .quieto, tamano: .sm) { destapado.toggle() }
                }
                if destapado {
                    Num("90+4'", tamano: 32, animacion: .paleta).foregroundStyle(Palco.live)
                }
            }
        }

        private var tarjetaDeslizable: some View {
            VStack(alignment: .leading, spacing: 4) {
                Text("Desliza esta tarjeta a los lados").estilo(.cuerpo)
                Text(soltado).font(Martian.fuente(11)).foregroundStyle(Palco.text2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .tarjeta()
            .offset(x: dx)
            .gesture(DeslizamientoHorizontal(alMover: { dx = $0 }, alSoltar: { x, y, vx in
                soltado = "soltado dx=\(Int(x)) dy=\(Int(y)) vx=\(Int(vx))"
                withAnimation(Movimiento.estandar(false)) { dx = 0 }
            }))
        }
    }
#endif
