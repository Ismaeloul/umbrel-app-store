import SwiftUI

/// Galería «Sistema», bloques 2-6 de a1 §11: tema, color, tipografía, botones, chips y segmentado.
struct SeccionesSistemaA: View {
    let galeria: EstadoGaleria

    var body: some View {
        SeccionGaleria("Tema y transparencia") { BloqueTema(galeria: galeria) }
        SeccionGaleria("Color") { MuestrasColor() }
        SeccionGaleria("Tipografía y cifras") { BloqueTipografia() }
        SeccionGaleria("Botones") { BloqueBotones(galeria: galeria) }
        SeccionGaleria("Chips, pestañas y segmentado") { BloqueChips(galeria: galeria) }
    }
}

private struct BloqueTema: View {
    let galeria: EstadoGaleria

    private var opciones: [OpcionSegmento<EstadoGaleria.Tema>] {
        [
            OpcionSegmento(valor: .sistema, titulo: "Sistema", icono: .pantalla),
            OpcionSegmento(valor: .claro, titulo: "Claro", icono: .sol),
            OpcionSegmento(valor: .oscuro, titulo: "Oscuro", icono: .luna),
        ]
    }

    var body: some View {
        @Bindable var galeria = galeria
        VStack(alignment: .leading, spacing: S.s4) {
            Segmentado(opciones, seleccion: Binding(get: { galeria.tema }, set: { galeria.cambiarTema($0) }),
                       etiqueta: "Tema")
            FilaInterruptor("Reducir transparencia",
                            descripcion: "El cristal pasa a opaco (además de la opción del sistema).",
                            activo: $galeria.transparenciaReducida)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tarjeta()
    }
}

/// Las 17 muestras de color de la galería (rejilla `minmax(150, 1fr)`, separación 8).
private struct MuestrasColor: View {
    private static let muestras: [(token: String, nombre: String, color: Color)] = [
        ("--bg", "Fondo", Palco.bg), ("--bg-sunk", "Fondo hundido", Palco.bgSunk),
        ("--surface", "Superficie", Palco.surface), ("--surface-2", "Superficie elevada", Palco.surface2),
        ("--line", "Línea", Palco.line), ("--line-strong", "Borde de control", Palco.lineStrong),
        ("--text", "Texto", Palco.text), ("--text-2", "Texto secundario", Palco.text2),
        ("--text-3", "Texto terciario", Palco.text3), ("--accent", "Oro (relleno)", Palco.accent),
        ("--accent-ink", "Oro (texto)", Palco.accentInk), ("--accent-edge", "Oro (borde)", Palco.accentEdge),
        ("--live", "Directo", Palco.live), ("--ok", "Verificada", Palco.ok), ("--weak", "Floja", Palco.weak),
        ("--fail", "Sin señal", Palco.fail), ("--glass-solid", "Cristal opaco", Palco.glassSolid),
    ]

    private let columnas = [GridItem(.flexible(), spacing: S.s2), GridItem(.flexible(), spacing: S.s2)]

    var body: some View {
        LazyVGrid(columns: columnas, alignment: .leading, spacing: S.s2) {
            ForEach(MuestrasColor.muestras, id: \.token) { muestra in
                MuestraColor(token: muestra.token, nombre: muestra.nombre, color: muestra.color)
            }
        }
    }
}

private struct MuestraColor: View {
    let token: String
    let nombre: String
    let color: Color

    var body: some View {
        let chip = RoundedRectangle(cornerRadius: R.s, style: .circular)
        VStack(alignment: .leading, spacing: 4) {
            chip.fill(color).frame(height: 44).bordeInterior(Palco.lineSoft, forma: chip)
            Text(nombre).estilo(EstiloTexto(tamano: 13, peso: 650, altoLinea: 1.45)).foregroundStyle(Palco.text)
            Text(token).font(Martian.fuente(12)).altoDeLinea(1.45, tamano: 12).foregroundStyle(Palco.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel(.normal, radio: R.m, relleno: 10)
    }
}

private struct BloqueTipografia: View {
    private static let cuerpo17 = EstiloTexto(tamano: 17, peso: 450, altoLinea: 1.45)

    var body: some View {
        VStack(alignment: .leading, spacing: S.s4) {
            Text("Hoy, miércoles 23").estilo(.titularVista).foregroundStyle(Palco.text)
            marcador
            VStack(alignment: .leading, spacing: 0) {
                Text("Cifras con celda fija y cero sin barra:").estilo(BloqueTipografia.cuerpo17)
                cifras
            }
            parrafo
            Text("Hash b71e44d0…0c9f2a31 · 1,92 MB/s · 48 pares")
                .font(Martian.fuente(12))
                .altoDeLinea(1.45, tamano: 12)
        }
        .foregroundStyle(Palco.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tarjeta()
    }

    /// «2 – 1» a 64: `Num` + raya en `--text-3` a 700 (lh 1).
    private var marcador: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Num("2", tamano: 64)
            Text(" ").font(Mona.fuente(64, peso: 450))
            Text("–").font(Mona.fuente(64, peso: 700)).foregroundStyle(Palco.text3)
            Text(" ").font(Mona.fuente(64, peso: 450))
            Num("1", tamano: 64)
        }
    }

    private var cifras: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Num("21:00", tamano: 17)
            Text(" · ").estilo(BloqueTipografia.cuerpo17)
            Num("0-0", tamano: 17)
            Text(" · ").estilo(BloqueTipografia.cuerpo17)
            Num("90+4'", tamano: 17)
        }
    }

    private var parrafo: some View {
        let fuerte: Text = Text("Fuerte a 650.").font(Mona.fuente(15, peso: 650))
        let segundo: Text = Text("Secundario.").foregroundStyle(Palco.text2)
        let tercero: Text = Text("Terciario.").foregroundStyle(Palco.text3)
        return Text("Texto normal a 15 px con peso 450. \(fuerte) \(segundo) \(tercero)").estilo(.cuerpo)
    }
}

private struct BloqueBotones: View {
    let galeria: EstadoGaleria

    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            Flujo(horizontal: S.s2, vertical: S.s2) {
                BotonPalco("Ver partido", icono: .play) {}
                BotonPalco("Elegir fuente", variante: .quieto) {}
                BotonPalco("Rebuscar", icono: .refresh, variante: .fantasma) {}
                BotonPalco("Borrar", icono: .trash, variante: .peligro) {}
                BotonPalco(galeria.pulsado ? "En favoritos" : "Favorito", icono: .star, variante: .quieto,
                           pulsado: galeria.pulsado) { galeria.pulsado.toggle() }
                BotonPalco("Pegar hash", icono: .paste, variante: .quieto, tamano: .sm) {}
                BotonPalco("Guardando…", variante: .quieto, ocupado: true) {}
            }
            Flujo(horizontal: S.s2, vertical: S.s2) {
                BotonIcono(.refresh, etiqueta: "Actualizar") {}
                BotonIcono(.star, etiqueta: "Favorito", pulsado: galeria.pulsado, iconoPulsado: .starF) {
                    galeria.pulsado.toggle()
                }
                BotonIcono(.copy, etiqueta: "Copiar hash", variante: .quieto) {}
                BotonIcono(.panel, etiqueta: "Plegar el panel", variante: .cristal) {}
                BotonIcono(.trash, etiqueta: "Borrar", variante: .peligro) {}
            }
        }
    }
}

private struct BloqueChips: View {
    let galeria: EstadoGaleria

    var body: some View {
        @Bindable var galeria = galeria
        VStack(alignment: .leading, spacing: S.s3) {
            Flujo(horizontal: S.s2, vertical: S.s2) {
                Chip("Tu equipo", tono: .mio)
                Chip("M+ Liga de Campeones", icono: .tv, contorno: .solido)
                Chip("DAZN 2", icono: .tv, contorno: .discontinuo).accessibilityHint("Se buscará al reproducir")
                Chip("En directo", contador: 3, pulsado: galeria.pulsado) { galeria.pulsado.toggle() }
            }
            Segmentado([
                OpcionSegmento(valor: "para-ti", titulo: "Para ti", contador: 8),
                OpcionSegmento(valor: "todos", titulo: "Todos", contador: 9),
            ], seleccion: $galeria.filtro, etiqueta: "Filtro de la agenda")
            Segmentado([
                OpcionSegmento(valor: "favoritos", titulo: "Favoritos", contador: 8),
                OpcionSegmento(valor: "recientes", titulo: "Recientes", contador: 12),
                OpcionSegmento(valor: "listas", titulo: "Listas", contador: 0),
            ], seleccion: $galeria.pestana, bloque: true, etiqueta: "Biblioteca", pestanas: true)
            Text("Panel de «\(galeria.pestana)».")
                .estilo(.cuerpo)
                .foregroundStyle(Palco.text2)
                .padding(.vertical, S.s2)
                .padding(.horizontal, S.s1)
        }
    }
}
