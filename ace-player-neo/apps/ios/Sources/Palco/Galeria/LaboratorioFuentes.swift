#if DEBUG
    import SwiftUI

    /// Bloque 1 del banco: fuentes y alto de línea, cada pieza con su caja medida frente a la de Chrome con las
    /// fuentes del mismo build (scratch de la fase 0.4, c0-laboratorio.md). Anchos y altos en pt.
    struct LabFuentes: View {
        var body: some View {
            BloqueLab(1, "Fuentes") {
                VStack(alignment: .leading, spacing: S.s4) {
                    titulares
                    parrafos
                    cifras
                    piezas
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .tarjeta()
            }
        }

        private var titulares: some View {
            VStack(alignment: .leading, spacing: S.s3) {
                Medido(web: 128.02, 33) { Text("Agenda").estilo(.titularVista) }
                Medido(web: 187.75, 48.39) { Text("Agenda").estilo(.titularVistaAncha) }
                Medido(web: 276.28, 33) { Text("Hoy, miércoles 23").estilo(.titularVista) }
                Medido(web: 249.97, 27.5) { Text("Reproducir otro hash").estilo(.tituloHoja) }
                Medido(web: 164.38, 24.64) { Text("Tipografía y cifras").estilo(.tituloSeccion) }
            }
        }

        private var parrafos: some View {
            VStack(alignment: .leading, spacing: S.s3) {
                Medido(web: 260, 65.25) {
                    Text("Texto normal a 15 px con peso 450 en tres líneas para medir el alto de línea de la web.")
                        .estilo(.cuerpo)
                        .frame(width: 260, alignment: .leading)
                        .background(GuiaRenglones(alto: 21.75, lineas: 3))
                }
                Medido(web: 262, 37.5) {
                    Text("Modo demo: sin backend, canales de muestra cargados")
                        .estilo(.toast)
                        .frame(width: 262, alignment: .leading)
                        .background(GuiaRenglones(alto: 18.75, lineas: 2))
                }
            }
        }

        private var cifras: some View {
            VStack(alignment: .leading, spacing: S.s3) {
                Medido(web: 135.95, 64) { Num("90+4'", tamano: 64) }
                Medido(web: 31.36, 64) { Num("2", tamano: 64) }
                Medido(web: 36.45, 17) { Num("21:00", tamano: 17) }
                Medido(web: 75, 13) { Text("En directo · 13'").estilo(.capsula) }
                Medido(web: 265.2, 17.39) {
                    Text("Hash b71e44d0…0c9f2a31 · 1,92 MB/s").font(Martian.fuente(12)).altoDeLinea(1.45, tamano: 12)
                }
            }
        }

        /// Primitivas con su caja de la galería web (medidas del mismo build, 390 claro).
        private var piezas: some View {
            VStack(alignment: .leading, spacing: S.s3) {
                Medido(web: 108, 28) { Capsula("En directo · 13'", tono: .directo, punto: true) }
                Medido(web: 90.22, 28) { Capsula("VIE 21:00", icono: .clock) }
                Medido(web: 94.31, 28) { Capsula("Tu equipo", tono: .oro, icono: .starF) }
                Medido(web: 77.81, 24) { Capsula("Señal lista", tono: .ok, tamano: .sm, punto: true, cristal: .video) }
                Medido(web: 145.81, 44) { BotonPalco("Ver partido", icono: .play) {} }
                Medido(web: 127.39, 44) { BotonPalco("Elegir fuente", variante: .quieto) {} }
                Medido(web: 125.73, 36) { BotonPalco("Pegar hash", icono: .paste, variante: .quieto, tamano: .sm) {} }
                Medido(web: 158.03, 28) { Chip("M+ Liga de Campeones", icono: .tv, contorno: .solido) }
                Medido(web: 80.83, 28) { Chip("DAZN 2", icono: .tv, contorno: .discontinuo) }
                Medido(web: 81.44, 32) { Chip("En directo", contador: 3) {} }
            }
        }
    }

    /// Rayas finas en el borde de cada renglón de CSS (alto de línea de la web), para verlo a ojo.
    private struct GuiaRenglones: View {
        let alto: CGFloat
        let lineas: Int

        var body: some View {
            Canvas { contexto, tamano in
                for i in 0...lineas {
                    let y = CGFloat(i) * alto
                    contexto.fill(Path(CGRect(x: 0, y: y, width: tamano.width, height: 0.5)), with: .color(Palco.accentEdge.opacity(0.6)))
                }
            }
        }
    }

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
