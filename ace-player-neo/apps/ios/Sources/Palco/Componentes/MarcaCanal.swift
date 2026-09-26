import SwiftUI

/// `<ChannelMark>` de la web: el dorsal de un canal (a1 §10.13; ui/ChannelMark.css). `redonda` = cuadrado de
/// radio 0,3·lado con la cifra enorme recortada abajo a la derecha; `tesela` = 16:9 (`tamano` es el ALTO) con
/// la sigla arriba a la izquierda. Tono sacado del nombre (`channelTone`). Decorativo. `sigla` cambia el texto de
/// arriba sin tocar el tono ni el dorsal (los carteles de fuente ponen ahí el proveedor, Isma 26-sep) y
/// `reservaDerecha` le deja sitio a lo que vaya encima a la derecha (el número de la fuente).
struct MarcaCanal: View {
    enum Forma: Sendable { case redonda, tesela }

    let nombre: String
    let forma: Forma
    let tamano: CGFloat
    let sigla: String?
    let reservaDerecha: CGFloat

    init(nombre: String, forma: Forma = .redonda, tamano: CGFloat = 40, sigla: String? = nil, reservaDerecha: CGFloat = 0) {
        self.nombre = nombre
        self.forma = forma
        self.tamano = tamano
        self.sigla = sigla
        self.reservaDerecha = reservaDerecha
    }

    private var tesela: Bool { forma == .tesela }
    private var ancho: CGFloat { tesela ? tamano * 16 / 9 : tamano }
    private var radio: CGFloat { tamano * (tesela ? 0.16 : 0.3) }
    private var dorsal: String { TonosMarca.dorsal(nombre) }

    var body: some View {
        let contorno = RoundedRectangle(cornerRadius: radio, style: .circular)
        ZStack(alignment: .bottomTrailing) {
            FondoMarcaCanal(nombre: nombre, tesela: tesela, ancho: ancho, alto: tamano)
            if tesela { siglaTesela }
            DorsalCanal(dorsal: dorsal, tamano: tamano, tesela: tesela)
        }
        .frame(width: ancho, height: tamano)
        .clipShape(contorno)
        .brilloSuperior(Color.white.opacity(0.22), forma: contorno)
        .bordeInterior(Color.black.opacity(0.12), forma: contorno)
        .accessibilityHidden(true)
    }

    /// `.dorsal__abbrev`: arriba 0,1·s, izquierda 0,12·s, `max(11, 0,17·s)` · 760 · wdth 88 · +0,08 em; lo que no
    /// cabe acaba en «…» (`text-overflow: ellipsis`).
    private var siglaTesela: some View {
        let s: CGFloat = tamano
        let letra: CGFloat = max(11, s * 0.17)
        let anchoMaximo: CGFloat = max(0, ancho - s * 0.24 - reservaDerecha)
        let arriba: CGFloat = s * 0.1
        let izquierda: CGFloat = s * 0.12
        let estilo = EstiloTexto(tamano: Double(letra), peso: 760, anchura: 88, trackingEm: 0.08)
        let texto: String = sigla ?? TonosMarca.sigla(nombre)
        return Text(texto)
            .estilo(estilo)
            .foregroundStyle(Color.white.opacity(0.9))
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: anchoMaximo, alignment: .leading)
            .padding(.top, arriba)
            .padding(.leading, izquierda)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// `linear-gradient(160deg, tone-hi, tone)` (redonda) o la luz radial + degradado a `#0a0d12` (tesela).
private struct FondoMarcaCanal: View {
    let nombre: String
    let tesela: Bool
    let ancho: CGFloat
    let alto: CGFloat

    var body: some View {
        let tono = TonosMarca.tonoCanal(nombre)
        let base = MezclaOKLab.oklch(tono.l, tono.c, tono.h)
        let claro = MezclaOKLab.oklch(tono.l + 0.12, tono.c, tono.h)
        if tesela {
            let oscuro = MezclaOKLab.mezclar(base, PalcoFijo.tintaOscura, p: 0.7)
            ZStack {
                Degradado.lineal(160, [base.color, oscuro.color], ancho: ancho, alto: alto)
                Degradado.elipse(claro.color, radioX: 0.8 * ancho, radioY: 0.9 * alto, hasta: 0.7, centro: .bottomTrailing)
            }
        } else {
            Degradado.lineal(160, [claro.color, base.color], ancho: ancho, alto: alto)
        }
    }
}

/// La cifra (o la letra) del dorsal, pegada abajo a la derecha y recortada por la forma.
private struct DorsalCanal: View {
    let dorsal: String
    let tamano: CGFloat
    let tesela: Bool

    private var letra: Bool { !dorsal.contains(where: { $0.isNumber }) }
    private var largo: Bool { dorsal.count > 1 }

    /// Tamaño, derecha y abajo (en em) de ChannelMark.css.
    private var medidas: (tamano: CGFloat, derecha: CGFloat, abajo: CGFloat) {
        if tesela {
            if largo { return (tamano * 0.6, 0.06, -0.1) }
            if letra { return (tamano * 0.78, 0.06, -0.04) }
            return (tamano * 0.86, 0.06, -0.16)
        }
        if largo { return (tamano * 0.64, 0.08, -0.12) }
        if letra { return (tamano * 0.84, 0.12, -0.02) }
        return (tamano * 0.92, 0.08, -0.2)
    }

    var body: some View {
        let m = medidas
        let estilo = EstiloTexto(tamano: Double(m.tamano), peso: 820, anchura: 75, trackingEm: -0.03)
        Text(dorsal)
            .estilo(estilo)
            .foregroundStyle(Color.white.opacity(tesela ? 0.92 : 0.94))
            .fixedSize()
            .padding(.trailing, m.derecha * m.tamano)
            .offset(y: -m.abajo * m.tamano)
    }
}

