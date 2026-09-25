import SwiftUI

/// Los datos de un club que pinta Palco (los colores ya resueltos por quien llama: `paletteOf`, `teamLight`).
struct DatosEquipo: Hashable, Sendable {
    var nombre: String
    var siglas: String
    var primario: RGB
    var secundario: RGB?
    var escudo: URL?
    var halo: RGB?
}

/// `<TeamMark>` de la web: escudo o monograma (a1 §10.12; ui/TeamMark.css). Círculo del primario con aro
/// interior de 0,09·lado del secundario, borde exterior de 1 `--line-soft`, placa de siglas desde 40 y, si
/// está encendido (en directo), halo del color de club. El escudo del servidor tapa el monograma.
struct MarcaEquipo: View {
    enum Patron: Sendable { case liso, franjas }

    let equipo: DatosEquipo
    let tamano: CGFloat
    let encendido: Bool
    let patron: Patron
    @Environment(\.movimientoReducido) private var reducido

    init(_ equipo: DatosEquipo, tamano: CGFloat, encendido: Bool = true, patron: Patron = .liso) {
        self.equipo = equipo
        self.tamano = tamano
        self.encendido = encendido
        self.patron = patron
    }

    var body: some View {
        ZStack {
            HaloEquipo(color: (equipo.halo ?? equipo.primario).color, tamano: tamano)
                .opacity(encendido ? 1 : 0)
                .animation(reducido ? .easeOut(duration: 0.15) : .timingCurve(0.2, 0.7, 0.3, 1, duration: 0.52), value: encendido)
            ImagenServidor(equipo.escudo, tamano: CGSize(width: tamano, height: tamano)) {
                MonogramaEquipo(equipo: equipo, tamano: tamano, patron: patron)
            }
            .shadow(color: Color.black.opacity(equipo.escudo == nil ? 0 : 0.5), radius: 8, y: 8)  // --shadow-crest
        }
        .frame(width: tamano, height: tamano)
        .accessibilityHidden(true)
    }
}

/// `box-shadow: 0 0 (0,55·s) (0,08·s)` del color de club al 62 % (TeamMark.css `.team::after`).
private struct HaloEquipo: View {
    let color: Color
    let tamano: CGFloat

    var body: some View {
        Color.clear
            .frame(width: tamano, height: tamano)
            .sombra([CapaSombra(y: 0, desenfoque: tamano * 0.55, expansion: tamano * 0.08, color: color.opacity(0.62))],
                    forma: Circle())
    }
}

/// El monograma: círculo, aro, borde y placa de siglas (desde 40).
private struct MonogramaEquipo: View {
    let equipo: DatosEquipo
    let tamano: CGFloat
    let patron: MarcaEquipo.Patron

    /// Sin secundario: `oklch(0.93 0.03 tono)` del primario (a1 §2.5, «Monograma»).
    private var secundario: RGB {
        equipo.secundario ?? MezclaOKLab.aclarar(equipo.primario)
    }

    var body: some View {
        ZStack {
            fondo
            if tamano >= 40 { PlacaSiglas(siglas: equipo.siglas, tamano: tamano) }
        }
        .frame(width: tamano, height: tamano)
        .background(Circle().stroke(Palco.lineSoft, lineWidth: 2))  // `0 0 0 1px --line-soft` por fuera
    }

    @ViewBuilder private var fondo: some View {
        switch patron {
        case .liso:
            Circle().fill(equipo.primario.color)
                .overlay(Circle().strokeBorder(secundario.color, lineWidth: tamano * 0.09))
        case .franjas:
            FranjasEquipo(primario: equipo.primario.color, secundario: secundario.color, tamano: tamano)
                .clipShape(Circle())
        }
    }
}

/// `repeating-linear-gradient(90deg, primario 0 0,2·s, secundario 0,2·s 0,4·s)`.
private struct FranjasEquipo: View {
    let primario: Color
    let secundario: Color
    let tamano: CGFloat

    var body: some View {
        Canvas { contexto, caja in
            let franja = tamano * 0.2
            var x: CGFloat = 0
            var par = true
            while x < caja.width {
                contexto.fill(Path(CGRect(x: x, y: 0, width: franja, height: caja.height)),
                              with: .color(par ? primario : secundario))
                x += franja
                par.toggle()
            }
        }
    }
}

/// `.team__plate`: siglas wdth 75 · 820 · +0,02 em · `max(11, 0,24·s)` · lh 1, relleno 0,28/0,42/0,24 em,
/// radio 6, fondo `rgb(8 20 34 / .86)`, texto blanco.
private struct PlacaSiglas: View {
    let siglas: String
    let tamano: CGFloat

    var body: some View {
        let letra = max(11, tamano * 0.24)
        let estilo = EstiloTexto(tamano: Double(letra), peso: 820, anchura: 75, trackingEm: 0.02, altoLinea: 1)
        Text(siglas)
            .estilo(estilo)
            .foregroundStyle(Color.white)
            .fixedSize()
            .padding(.top, letra * 0.28)
            .padding(.bottom, letra * 0.24)
            .padding(.horizontal, letra * 0.42)
            .background(PalcoFijo.placaSiglas, in: RoundedRectangle(cornerRadius: 6, style: .circular))
    }
}
