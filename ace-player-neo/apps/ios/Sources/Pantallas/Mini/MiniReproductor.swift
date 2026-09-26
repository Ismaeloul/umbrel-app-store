import SwiftUI

/* El mini «Sonando» (MiniPlayer.tsx, `.player-mini` de player.css; a4 §19, a2 §7): banda de cristal denso (radio
   18, relleno 9 6 9 9) con la IMAGEN VIVA de 96×54 (el ÚNICO `VistaVideo` del mini, hueco `.mini`), el rótulo con
   el ecualizador, el canal y la segunda línea (nota del marcador · fuente; nunca las cifras) y 📺 · ⏸/▶ · ■.
   Tocar vuelve al vídeo. Se arrastra en los dos ejes: arriba abre (háptica ligera); a un lado sale volando y
   detiene con «Reproducción detenida» + «Deshacer» (6 s), con háptica fuerte al cruzar los 72 pt. La posición
   (banda o tarjeta) la da la capa del armazón. */

struct MiniReproductor: View {
    @Environment(Reproductor.self) private var reproductor
    @Environment(GestorPiP.self) private var pip
    @Environment(Navegador.self) private var navegador
    @Environment(Haptica.self) private var haptica
    @Environment(Avisos.self) private var avisos
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido
    @State private var arrastre: CGSize = .zero
    @State private var saliendo: CGFloat = 0
    @State private var armado = false

    private var titulo: String { reproductor.canal?.titulo ?? "Ace Player Neo" }

    var body: some View {
        let d = GestosMini.arrastre(dx: Double(arrastre.width), dy: Double(arrastre.height))
        HStack(spacing: 12) {
            imagen
            InfoMini(titulo: titulo) { abrir() }
            BotonesMini()
        }
        .padding(.leading, 9)
        .padding(.trailing, 6)
        .padding(.vertical, 9)
        .frame(minHeight: Alturas.mini)
        .background { FondoMini() }
        .offset(x: CGFloat(d.x) + saliendo, y: CGFloat(d.y))
        .opacity(saliendo != 0 ? 0 : d.opacidad)
        .gesture(arrastrar)
        .onAppear { reponer() }
        .onChange(of: reproductor.canal?.id) { _, nuevo in
            // «Deshacer» (o un canal nuevo) con el mini aún montado: vuelve a su sitio.
            if nuevo != nil { reponer() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.mini)
    }

    /// La imagen viva: el mismo vídeo del escenario, 96×54, radio 10, fondo negro, borde 1 negro al 25 %.
    private var imagen: some View {
        let forma = RoundedRectangle(cornerRadius: R.s, style: .circular)
        return VistaVideo(superficie: pip.superficie, prioridad: .mini)
            .overlay { imagenDemo }
            .frame(width: 96, height: 54)
            .clipShape(forma)
            .bordeInterior(Color.black.opacity(0.25), forma: forma)
            .contentShape(forma)
            .onTapGesture { abrir() }
            .accessibilityHidden(true)
    }

    /// En la demo no hay vídeo: el campo de `DemoPicture` sin rótulo (M2), como el mini de la web.
    @ViewBuilder private var imagenDemo: some View {
        #if DEBUG
            if reproductor.demo && reproductor.arranco { ImagenDemo(titulo: nil, conRotulo: false) }
        #endif
    }

    /// Volver al vídeo: la ruta que se estaba viendo (el partido o el canal).
    private func abrir() {
        guard let canal = reproductor.canal else { return }
        let destino: Destino = canal.partido.map { .partido(id: $0.id) } ?? .canal(hash: canal.id)
        navegador.ir(destino, desde: .mini)
    }

    private var arrastrar: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { valor in
                arrastre = valor.translation
                let cruza = GestosMini.pasado(dx: Double(valor.translation.width), dy: Double(valor.translation.height))
                if cruza != armado {
                    armado = cruza
                    if cruza { haptica.disparar(.fuerte) }
                }
            }
            .onEnded { valor in soltar(valor) }
    }

    private func soltar(_ valor: DragGesture.Value) {
        armado = false
        let v = valor.velocity
        let t = valor.translation
        let ancho: Double = maquetacion.ancho
        switch GestosMini.soltar(dx: Double(t.width), dy: Double(t.height), vx: Double(v.width), vy: Double(v.height), ancho: ancho) {
        case .abrir:
            withAnimation(Movimiento.estandar(reducido)) { arrastre = .zero }
            haptica.disparar(.ligera)
            abrir()
        case .descartar:
            // A un lado lo detiene, como la web (MiniPlayer.tsx: `dismiss(direction === 'right' ? 1 : -1)`).
            descartar(t.width >= 0 ? 1 : -1)
        case .volver:
            withAnimation(Movimiento.estandar(reducido)) { arrastre = .zero }
        }
    }

    private func reponer() {
        saliendo = 0
        arrastre = .zero
        armado = false
    }

    /// Sale volando `translate(±110 %)` y a los 220 ms detiene y ofrece «Deshacer» durante 6 s.
    private func descartar(_ sentido: CGFloat) {
        let ancho: CGFloat = CGFloat(maquetacion.ancho)
        if !reducido {
            withAnimation(Movimiento.estandar(false)) {
                arrastre = .zero
                saliendo = sentido * ancho * 1.1
            }
        }
        let reproductor = self.reproductor
        let avisos = self.avisos
        let espera: Duration = reducido ? .zero : .milliseconds(220)
        Task {
            try? await Task.sleep(for: espera)
            guard reproductor.canal != nil else { return }
            reproductor.detener()
            let deshacer = AccionAviso(titulo: "Deshacer") { reproductor.deshacerDetencion() }
            avisos.avisar("Reproducción detenida", tono: .info, icono: .stop, accion: deshacer, duracion: 6)
        }
    }
}

/// Cristal denso del tema (radio 18, borde 1 `--glass-rim`, brillo arriba y `--shadow-2`).
private struct FondoMini: View {
    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        Color.clear
            .cristal(.denso, en: forma)
            .bordeInterior(Palco.glassRim, forma: forma)
            .brilloSuperior(forma: forma)
            .sombra(.mini, forma: forma)
    }
}
