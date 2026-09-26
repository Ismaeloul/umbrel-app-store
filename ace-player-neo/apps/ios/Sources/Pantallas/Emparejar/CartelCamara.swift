import SwiftUI

/* El cartel de la cámara (a2 §22.3): isla oscura siempre, fondo `--glass-video-solid` hasta la primera imagen
   (que entra en 320 ms), velo con ventana, marco de cuatro esquinas, velo superior y cabecera blanca
   «Emparejar» (solo en vertical), el bloque «sin cámara» o la cápsula de indicación a 16 del borde de abajo.
   En vertical va a sangre con las esquinas de abajo de 24; en horizontal es una tarjeta cuadrada con las
   cuatro de 24 (a2 §22.7). */

struct CartelCamara: View {
    /// Geometría del cartel (la calcula la pantalla con la ventana medida).
    struct Medidas: Equatable {
        var tamano: CGSize
        var lado: CGFloat  // de la ventana del marco: 232, o min(232, S − 96) en horizontal
        var centroY: CGFloat  // centro de la ventana (52 % de H en vertical)
        var arriba: CGFloat  // zona segura de arriba (cabecera y velo superior); 0 en horizontal
        var vertical: Bool
    }

    let modelo: ModeloEmparejar
    /// La cámara de la pantalla: la misma en vertical y en horizontal (al girar no se reinicia, a2 §22.7).
    let camaraQR: CamaraQR
    let medidas: Medidas
    let recomprobar: Int
    let activa: Bool
    let alAbrirAjustes: () -> Void
    let alEscribirCodigo: () -> Void
    @Environment(\.movimientoReducido) private var reducido
    @State private var marcoRojo = false
    @State private var escala: CGFloat = 1

    private var estado: EstadoCamara { modelo.estadoCamara }
    private var ventana: CGRect {
        CGRect(x: (medidas.tamano.width - medidas.lado) / 2, y: medidas.centroY - medidas.lado / 2,
               width: medidas.lado, height: medidas.lado)
    }
    private var forma: UnevenRoundedRectangle {
        let arriba: CGFloat = medidas.vertical ? 0 : 24
        return UnevenRoundedRectangle(topLeadingRadius: arriba, bottomLeadingRadius: 24, bottomTrailingRadius: 24,
                                      topTrailingRadius: arriba, style: .circular)
    }

    var body: some View {
        ZStack(alignment: .top) {
            Palco.glassVideoSolid
            camara
            if !estado.bloqueado { ventanaYMarco }
            if medidas.vertical { cabecera }
            abajo
        }
        .frame(width: medidas.tamano.width, height: medidas.tamano.height)
        .clipShape(forma)
        .sombra([CapaSombra(y: 20, desenfoque: 60, expansion: -20, color: Color.black.opacity(0.6))], forma: forma)
        .islaOscura()
        .task(id: estado) { await animarMarco() }
    }

    /// La imagen de la cámara con su nombre accesible (el valor es el texto de la cápsula).
    private var camara: some View {
        EscanerQR(
            camara: camaraQR, activo: activa && modelo.camaraLeyendo, ventana: ventana, recomprobar: recomprobar,
            releer: modelo.vecesReleer,
            alCambiar: { (nuevo: EstadoCaptura) in modelo.cambioCaptura(nuevo) },
            alPrimeraImagen: { modelo.primeraImagen() },
            alLeer: { (texto: String) -> Bool in modelo.leido(texto) }
        )
        .opacity(modelo.hayImagen && !estado.bloqueado ? 1 : 0)
        .animation(Movimiento.salida, value: modelo.hayImagen)
        .accessibilityElement()
        .accessibilityLabel("Cámara para leer el código QR")
        .accessibilityValue(ReglasEmparejar.capsula(estado)?.texto ?? "")
        .accessibilityIdentifier(IDUI.visorCamara)
    }

    private var ventanaYMarco: some View {
        VentanaEscaner(
            ventana: ventana, colorMarco: colorMarco, marcoVisible: ReglasEmparejar.marco(estado) != .oculto,
            opacidadVelo: estado == .ocupada ? 0.55 : 0.35, escala: escala)
    }

    private var colorMarco: Color {
        if marcoRojo { return Palco.fail }
        switch ReglasEmparejar.marco(estado) {
        case .oro, .rojo: return Palco.accent
        case .oroApagado: return Palco.accent.opacity(0.45)
        case .verde: return Palco.ok
        case .oculto: return Color.clear
        }
    }

    /// Velo superior (`linear-gradient(rgba(0,0,0,.55), transparent)`, alto safeT + 96) y «Emparejar».
    private var cabecera: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [Color.black.opacity(0.55), Color.clear], startPoint: .top, endPoint: .bottom)
                .frame(height: medidas.arriba + 96)
                .allowsHitTesting(false)
            CabeceraVista("Emparejar", sobreOscuro: true, ocultarMotor: true) { EmptyView() }
                .environment(\.modoDemo, false)
                .padding(.top, medidas.arriba)
                .padding(.horizontal, 16)
        }
    }

    @ViewBuilder private var abajo: some View {
        if let bloque = ReglasEmparejar.sinCamara(estado) {
            BloqueSinCamara(titulo: bloque.titulo, texto: bloque.texto, abrirAjustes: bloque.abrirAjustes,
                            alAbrirAjustes: alAbrirAjustes, alEscribirCodigo: alEscribirCodigo)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.top, medidas.vertical ? medidas.arriba + 40 : 0)
        } else if let capsula = ReglasEmparejar.capsula(estado) {
            CapsulaCamaraVista(capsula: capsula, anchoMaximo: min(medidas.tamano.width - 32, 560))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, 16)
                .accessibilityHidden(true)
        }
    }

    /// Marco rojo 600 ms con un QR ajeno (y vuelta a oro en 320 ms); al leer, 1 → 0,94 → 1 con el muelle héroe.
    private func animarMarco() async {
        switch estado {
        case .qrAjeno:
            marcoRojo = true
            try? await Task.sleep(for: ReglasEmparejar.marcoRojo)
            withAnimation(Movimiento.salida) { marcoRojo = false }
        case .emparejando:
            marcoRojo = false
            guard !reducido else { return }
            withAnimation(Movimiento.rapido(false)) { escala = 0.94 }
            try? await Task.sleep(for: .milliseconds(180))
            withAnimation(Movimiento.heroe) { escala = 1 }
        default:
            marcoRojo = false
            escala = 1
        }
    }
}
