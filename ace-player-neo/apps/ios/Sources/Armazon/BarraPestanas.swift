import SwiftUI

/* La barra de pestañas de la web (b-arquitectura §3.5, M4; decisión 4 de Isma; a2 §4; app/Nav.tsx › TabBar,
   shell.css `.tabbar`). NO es la TabView del sistema: es la barra flotante de Palco hecha con Liquid Glass.

   - Marco: `Maquetacion.marcoBarraInferior` (12 + zonas a los lados, safeB + 10 abajo, alto 64), radio 24
     circular. Liquid Glass de verdad (`TipoCristal.barra`, prueba de Isma en su iPhone: «aquí manda el cristal
     sobre el calco de la web»): sin tinte ni velo en claro ni en oscuro, se transparenta y refracta lo que pasa
     por debajo (sin el velo inferior) y responde al toque. Con la transparencia reducida, la barra sólida de la
     web con su filo de luz, su borde y `--shadow-2`.
   - Relleno 6 dentro del borde de 1 → celdas de (ancho − 14) / 4, zona útil de 50.
   - Píldora `--accent-wash` de 50 de alto y radio 18 (24 − 6) que se desliza con el muelle estándar (reducido:
     150 ms `ease-out`). Opaca, sin cristal (nunca cristal anidado).
   - Cada destino: icono 24 + rótulo 11/620/88, separación 2, `--accent-ink` en la activa y, en las demás, el
     secundario del sistema sobre el vidrio (legible sobre claro y oscuro) o `--text-2` en la sólida; sin
     efecto al pulsar (la web no lleva `.press`).
   - Tocar otra pestaña vibra con «selección»; tocar la activa sube su vista (decisión 3), sin háptica.
   - Accesibilidad: navegación «Principal», la activa con el rasgo «seleccionado»; visor de contenido grande. */

struct BarraPestanas: View {
    @Environment(Navegador.self) private var navegador
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.cristalOpaco) private var opaco

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
            .cristal(.barra, en: forma)
        }
        .modifier(AcabadoBarra(opaco: opaco, forma: forma))
        .offset(x: CGFloat(marco.x), y: CGFloat(marco.y))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Principal")
        .accessibilityIdentifier(IDUI.barraPestanas)
    }

    /// La píldora de oro lavado bajo la pestaña activa (a2 §4.2): `translateX(i × celda)`, deslizándose con el
    /// muelle estándar de una pestaña a otra (reducido: 150 ms).
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
                DestinoBarra(pestana: pestana, activa: pestana == navegador.pestana && navegador.capa == nil, vibrante: !opaco) {
                    navegador.tocarPestana(pestana)
                }
                .frame(width: CGFloat(maquetacion.celdaBarra), height: 50)
            }
        }
    }
}

/// Con Liquid Glass el vidrio trae su propio filo, su brillo y su sombra; con la transparencia reducida (barra
/// sólida `--glass-solid`) vuelven los de la web: borde `--glass-rim`, filo de luz y `--shadow-2`.
private struct AcabadoBarra<Forma: Shape>: ViewModifier {
    let opaco: Bool
    let forma: Forma

    func body(content: Content) -> some View {
        if opaco {
            content
                .bordeInterior(Palco.glassRim, forma: forma)
                .brilloSuperior(forma: forma)
                .sombra(.barra, forma: forma)
        } else {
            content
        }
    }
}

/// Un destino de la barra: icono 24 y rótulo 11/620/88 centrados (24 + 2 + 16 = 42 en los 50 de la celda).
private struct DestinoBarra: View {
    let pestana: Pestana
    let activa: Bool
    /// Sobre el vidrio, la inactiva va con el estilo secundario del sistema (se lee sobre claro y sobre oscuro,
    /// pase lo que pase debajo); sobre la barra sólida, `--text-2` como la web.
    let vibrante: Bool
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
        .foregroundStyle(tinta)
        .accessibilityLabel(pestana.titulo)
        .accessibilityAddTraits(activa ? [.isSelected] : [])
        .accessibilityShowsLargeContentViewer()
        .accessibilityIdentifier(IDUI.pestana(pestana.rawValue))
    }

    private var tinta: AnyShapeStyle {
        if activa { return AnyShapeStyle(Palco.accentInk) }
        return vibrante ? AnyShapeStyle(HierarchicalShapeStyle.secondary) : AnyShapeStyle(Palco.text2)
    }
}
