import SwiftUI

/* Barra del héroe (M5; a3 §4.3, §4.4): el botón oro (el texto según el orden exacto de la web), la cápsula
   «Marcador» (solo con marcador pintable) y dónde se emite. En horizontal (≥ 768) todo en una línea. */

/// El botón principal del héroe (`cta` de Hero.tsx).
struct AccionHeroe: Equatable {
    var texto: String
    var icono: NombreIcono
    var deshabilitado: Bool

    static func de(canales: [InfoCanal], viendo: Bool, enDirecto: Bool) -> AccionHeroe {
        if viendo { return AccionHeroe(texto: "Volver al vídeo", icono: .play, deshabilitado: false) }
        if canales.isEmpty { return AccionHeroe(texto: "Canal por confirmar", icono: .tv, deshabilitado: true) }
        if !canales.contains(where: \.enBiblioteca) { return AccionHeroe(texto: "Buscar canal", icono: .buscar, deshabilitado: false) }
        if enDirecto { return AccionHeroe(texto: "Ver ahora", icono: .play, deshabilitado: false) }
        return AccionHeroe(texto: "Ver el partido", icono: .play, deshabilitado: false)
    }
}

struct BarraHeroe: View {
    let partido: FootballMatch
    let accion: AccionHeroe
    let canales: [InfoCanal]
    let marcador: LiveScore?
    let destapado: Bool
    let abrir: () -> Void
    @Environment(\.maquetacion) private var maquetacion

    var body: some View {
        Group {
            if maquetacion.tipo == .movil {
                // `flex: 1 1 180px` y «dónde» en su propia línea (agenda.css, < 768).
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 12) { boton(estirado: true); capsula }
                    donde
                }
            } else {
                HStack(spacing: 12) { boton(estirado: false); capsula; donde }
            }
        }
        .padding(.horizontal, 2)
    }

    private func boton(estirado: Bool) -> some View {
        BotonOroHeroe(accion: accion, estirado: estirado, abrir: abrir)
    }

    @ViewBuilder private var capsula: some View {
        if let marcador = Marcadores.pintable(marcador) {
            CapsulaMarcador(partido: partido, marcador: marcador, destapado: destapado, variante: .heroe, soloIcono: false)
                .fixedSize()
        }
    }

    private var donde: some View {
        HStack(spacing: 6) {
            IconoPalco(.tv, tamano: 16)
            Text(canales.isEmpty ? "Canal por confirmar" : canales.map(\.nombre).joined(separator: " · "))
                .estilo(EstiloTexto(tamano: 13, peso: 560, altoLinea: 1.45))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(Palco.text2)
        .frame(maxWidth: maquetacion.tipo == .movil ? .infinity : nil, alignment: .leading)
    }
}

/// `.agenda-hero__cta.btn`: alto 52, relleno 0 30 0 26, 17/650, icono 20, oro con su brillo y sombra.
private struct BotonOroHeroe: View {
    let accion: AccionHeroe
    let estirado: Bool
    let abrir: () -> Void

    var body: some View {
        Button(action: abrir) {
            HStack(spacing: 8) {
                IconoPalco(accion.icono, tamano: 20)
                Text(accion.texto).estilo(EstiloTexto(tamano: 17, peso: 650, altoLinea: 1.1)).lineLimit(1)
            }
            .padding(.leading, 26)
            .padding(.trailing, 30)
            .frame(maxWidth: estirado ? .infinity : nil, minHeight: 52)
            .background(Palco.accent, in: Capsule())
            .brilloSuperior(Color.white.opacity(0.35), forma: Capsule())
            .sombra([CapaSombra(y: 2, desenfoque: 8, color: Color.black.opacity(0.18))], forma: Capsule())
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(Palco.onAccent)
        .disabled(accion.deshabilitado)
        .opacity(accion.deshabilitado ? 0.55 : 1)
        .accessibilityIdentifier(IDUI.botonVerAhora)
    }
}
