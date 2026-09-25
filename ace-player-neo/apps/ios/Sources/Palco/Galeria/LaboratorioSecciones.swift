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

    /// Bloque 4: hoja nativa con detent medido (UIKit y el canario C6 de SwiftUI), menú contextual con vista
    /// previa (canario C7) y `Menu` con `.menuOrder(.fixed)` e iconos de Palco (C14).
    struct LabHojasYMenus: View {
        let galeria: EstadoGaleria
        @State private var centro = SondaCentroHojas()

        var body: some View {
            BloqueLab(4, "Hoja y menús") {
                VStack(alignment: .leading, spacing: S.s3) {
                    BotonPalco("Hoja medida (UIKit)", icono: .plus, variante: .quieto) { HojaMuestra.abrir() }
                    BotonPalco("Hoja .height(medido) (C6)", icono: .plus, variante: .quieto) { centro.actual = .pegar }
                    BotonPalco("Hoja grande (C6)", icono: .panel, variante: .quieto) { centro.actual = .gustos }
                    ZonaMenuContextual()
                    HStack(spacing: S.s2) {
                        Text("Menú «Más opciones»").estilo(.cuerpo).foregroundStyle(Palco.text2)
                        MenuMuestra(galeria: galeria)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .tarjeta()
                .sondaHojas(centro)
            }
        }
    }

    /// Bloque 5: la barra de estado sobre un héroe con el tema de la ventana a mano, y una lista larga para
    /// «tocar la barra de estado sube» (a2 §24, §27.5: el ScrollView del banco es el único activo).
    struct LabBarraEstado: View {
        let galeria: EstadoGaleria
        private let filas = Array(1...24)

        var body: some View {
            BloqueLab(5, "Barra de estado") {
                VStack(alignment: .leading, spacing: S.s3) {
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
                    VStack(spacing: 0) {
                        ForEach(filas, id: \.self) { n in
                            FilaListaLarga(numero: n)
                        }
                    }
                    .tarjeta(radio: R.l, relleno: 0)
                }
            }
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

    /// Bloque 6: cada tipo de háptica por el pulso central, también con una hoja abierta y en horizontal.
    struct LabHaptica: View {
        @Environment(Haptica.self) private var haptica

        var body: some View {
            BloqueLab(6, "Háptica") {
                VStack(alignment: .leading, spacing: S.s3) {
                    BotonesHaptica()
                    BotonPalco("Abrir una hoja y vibrar desde ella", icono: .plus, variante: .quieto) {
                        let haptica = self.haptica
                        PresentadorHoja.presentar {
                            ContenidoHoja(titulo: "Háptica con hoja", alCerrar: { PresentadorHoja.cerrar() }) {
                                BotonesHaptica().environment(haptica)
                            }
                            .background(Palco.glassSolid)
                        }
                    }
                    Text("Gira el iPhone a horizontal y vuelve a probar (el pulso sale del único .sensoryFeedback de la raíz).")
                        .estilo(.subtituloVista)
                        .foregroundStyle(Palco.text2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .tarjeta()
            }
        }
    }

    private struct BotonesHaptica: View {
        @Environment(Haptica.self) private var haptica

        var body: some View {
            Flujo(horizontal: S.s2, vertical: S.s2) {
                ForEach(TipoHaptico.allCases, id: \.self) { tipo in
                    BotonPalco(tipo.rawValue, variante: .quieto, tamano: .sm) { haptica.disparar(tipo) }
                }
            }
        }
    }
#endif
