import SwiftUI

/* La barra de pestañas de la web (b-arquitectura §3.5, M4; decisión 4 de Isma; a2 §4; app/Nav.tsx › TabBar,
   shell.css `.tabbar`). NO es la TabView del sistema: es la barra flotante de Palco hecha con Liquid Glass.

   - Marco: `Maquetacion.marcoBarraInferior` (12 + zonas a los lados, safeB + 10 abajo, alto 64), radio 24
     circular, cristal denso (`glass--dense`) con el filo de luz y la sombra `--shadow-2`.
   - Relleno 6 dentro del borde de 1 → celdas de (ancho − 14) / 4, zona útil de 50.
   - Píldora `--accent-wash` de 50 de alto y radio 18 (24 − 6) que se desliza con el muelle estándar (reducido:
     150 ms `ease-out`). Opaca, sin cristal (nunca cristal anidado).
   - Cada destino: icono 24 + rótulo 11/620/88, separación 2, color `--text-2` o `--accent-ink` en la activa; sin
     efecto al pulsar (la web no lleva `.press`).
   - Tocar otra pestaña vibra con «selección»; tocar la activa sube su vista (decisión 3), sin háptica.
   - Accesibilidad: navegación «Principal», la activa con el rasgo «seleccionado»; visor de contenido grande. */

struct BarraPestanas: View {
    @Environment(Navegador.self) private var navegador
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        let marco: Marco = maquetacion.marcoBarraInferior
        let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
        GlassEffectContainer(spacing: 0) {
            ZStack(alignment: .leading) {
                pildora
                destinos
            }
            .padding(7)  // 1 de borde + 6 de relleno (a2 §4.1)
            .frame(width: CGFloat(marco.ancho), height: Alturas.barra)
            .cristal(.denso, en: forma)
        }
        .bordeInterior(Palco.glassRim, forma: forma)  // a2 §4.1: borde 1 px `--glass-rim`
        .brilloSuperior(forma: forma)
        .sombra(.barra, forma: forma)
        .offset(x: CGFloat(marco.x), y: CGFloat(marco.y))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Principal")
        .accessibilityIdentifier(IDUI.barraPestanas)
    }

    /// La píldora de oro lavado bajo la pestaña activa (a2 §4.2): `translateX(i × celda)`.
    private var pildora: some View {
        let celda = CGFloat(maquetacion.celdaBarra)
        let indice = CGFloat(navegador.pestana.indice)
        let dentro: Bool = navegador.capa == nil || navegador.capa?.pestana != nil
        return RoundedRectangle(cornerRadius: 18, style: .circular)
            .fill(Palco.accentWash)
            .frame(width: celda, height: 50)
            .offset(x: indice * celda)
            .opacity(dentro ? 1 : 0)  // fuera de los cuatro destinos (galería) queda a opacidad 0, sin transición
            .animation(Movimiento.estandar(reducido), value: navegador.pestana)
            .allowsHitTesting(false)
    }

    private var destinos: some View {
        HStack(spacing: 0) {
            ForEach(Pestana.allCases) { pestana in
                DestinoBarra(pestana: pestana, activa: pestana == navegador.pestana && navegador.capa == nil) {
                    navegador.tocarPestana(pestana)
                }
                .frame(width: CGFloat(maquetacion.celdaBarra), height: 50)
            }
        }
    }
}

/// Un destino de la barra: icono 24 y rótulo 11/620/88 centrados (24 + 2 + 16 = 42 en los 50 de la celda).
private struct DestinoBarra: View {
    let pestana: Pestana
    let activa: Bool
    let accion: () -> Void

    var body: some View {
        Button(action: accion) {
            VStack(spacing: 2) {
                IconoPalco(pestana.icono, tamano: 24)
                Text(pestana.titulo).estilo(.pestanaBarra).lineLimit(1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(EstiloPlano())
        .foregroundStyle(activa ? Palco.accentInk : Palco.text2)
        .accessibilityLabel(pestana.titulo)
        .accessibilityAddTraits(activa ? [.isSelected] : [])
        .accessibilityShowsLargeContentViewer()
        .accessibilityIdentifier(IDUI.pestana(pestana.rawValue))
    }
}
