import SwiftUI

/* Panel del vídeo mientras no hay imagen (`StageMessage` de PlayerSurface.tsx, `.player-msg` de player.css;
   a4 §8.1): «Buscando señal», «Conectando», «Reconectando», «Sin señal», «En otro dispositivo», «No se pudo
   abrir», con el pulso, el botón y los datos de reposo. Va sobre el vídeo: isla oscura. */

struct PanelMensajeVideo: View {
    let mensaje: MensajeEscenario
    let grande: Bool
    let boton: (titulo: String, icono: NombreIcono)?
    let datosReposo: Bool
    let alBoton: () -> Void

    var body: some View {
        VStack(spacing: grande ? 8 : 4) {
            marca
            Text(mensaje.titulo)
                .estilo(EstiloTexto(tamano: grande ? 22 : 15, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1))
                .multilineTextAlignment(.center)
            texto
            if datosReposo { DatosReposo().padding(.top, 4) }
            if let boton {
                BotonPalco(boton.titulo, icono: boton.icono, variante: .video, tamano: .sm, accion: alBoton)
                    .padding(.top, grande ? 8 : 2)
            }
        }
        .foregroundStyle(Palco.onVideo)
        .padding(.horizontal, grande ? 24 : 16)
        .padding(.top, grande ? 56 : 52)
        .padding(.bottom, grande ? 56 : (mensaje.tono == .error ? 16 : 56))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { FondoMensaje() }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(IDUI.panelMensajeVideo)
    }

    /// 38 caracteres a 13 pt (el «0» de Mona mide ≈ 0,55 em).
    private static let anchoTexto: CGFloat = 272

    /// Texto 13 (12 en el iPhone en vertical, cortado a 2 líneas), 1,25 de alto de línea, al 86 %.
    private var texto: some View {
        let tamano: Double = grande ? 13 : 12
        return Text(mensaje.texto)
            .estilo(EstiloTexto(tamano: tamano, peso: 450, altoLinea: 1.25))
            .opacity(0.86)
            .multilineTextAlignment(.center)
            .lineLimit(grande ? nil : 2)
            .frame(maxWidth: grande ? PanelMensajeVideo.anchoTexto : .infinity)
    }

    /// La marca: el pulso (ocupado), el aviso rojo (error) o la tele (reposo; en vertical, oculta).
    @ViewBuilder private var marca: some View {
        switch mensaje.tono {
        case .ocupado: MarcaMensaje(grande: grande) { PulsoMensaje() }
        case .error:
            MarcaMensaje(grande: grande) { IconoPalco(.aviso, tamano: grande ? 28 : 22).foregroundStyle(Palco.failInk) }
        case .reposo:
            if grande { MarcaMensaje(grande: true) { IconoPalco(.tv, tamano: 28) } }
        }
    }
}

/// Círculo de 48 con fondo blanco al 6 % y borde interior blanco al 14 % (vertical: 28 sin fondo ni borde).
private struct MarcaMensaje<Contenido: View>: View {
    let grande: Bool
    @ViewBuilder let contenido: () -> Contenido

    var body: some View {
        let lado: CGFloat = grande ? 48 : 28
        contenido()
            .frame(width: lado, height: lado)
            .background(Circle().fill(Color.white.opacity(grande ? 0.06 : 0)))
            .bordeInterior(Color.white.opacity(grande ? 0.14 : 0), forma: Circle())
            .accessibilityHidden(true)
    }
}

/// Anillo hueco de 22 (borde 2 blanco) que crece de 0,55 a 1,35 y se desvanece en 1,6 s; con movimiento reducido,
/// quieto y discontinuo (`.player-msg__pulse`).
private struct PulsoMensaje: View {
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        if reducido {
            Circle().strokeBorder(Color.white, style: StrokeStyle(lineWidth: 2, dash: [3, 3])).frame(width: 22, height: 22)
        } else {
            TimelineView(.animation) { contexto in
                let t: Double = contexto.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                let p: Double = Movimiento.curvaSalida(t)
                let escala: Double = 0.55 + 0.8 * p
                Circle()
                    .strokeBorder(Color.white, lineWidth: 2)
                    .frame(width: 22, height: 22)
                    .scaleEffect(CGFloat(escala))
                    .opacity(1 - p)
            }
        }
    }
}

/// `radial-gradient(60% 80% at 50% 0%, rgba(255,214,10,.08), transparent 70%)` sobre `#0F1218`.
private struct FondoMensaje: View {
    @State private var tamano: CGSize = .zero

    var body: some View {
        let rx: CGFloat = tamano.width * 0.6
        let ry: CGFloat = tamano.height * 0.8
        ZStack {
            Palco.glassVideoSolid
            Degradado.elipse(Palco.accent.opacity(0.08), radioX: rx, radioY: ry, hasta: 0.7, centro: .top)
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { tamano = $0 }
    }
}

/// Datos de reposo (`IdleFacts`): «Motor listo» / «Motor apagado», «Canales n» y «Hoy n partidos».
private struct DatosReposo: View {
    @Environment(DatosApp.self) private var datos
    @Environment(RelojCompartido.self) private var reloj

    private struct Dato: Identifiable {
        var id: String
        var texto: String
        var punto: Color?
    }

    private var datosVisibles: [Dato] {
        var lista: [Dato] = []
        switch datos.motor.datos?.status {
        case .some(.online): lista.append(Dato(id: "motor", texto: "Motor listo", punto: Palco.ok))
        case .some(.offline): lista.append(Dato(id: "motor", texto: "Motor apagado", punto: Palco.fail))
        default: if datos.motor.error != nil { lista.append(Dato(id: "motor", texto: "Motor apagado", punto: Palco.fail)) }
        }
        if let biblioteca = datos.biblioteca.datos {
            let ids = Set((biblioteca.web + biblioteca.favorites).map(\.id))
            lista.append(Dato(id: "canales", texto: "Canales \(ids.count)"))
        }
        if let agenda = datos.agenda.datos {
            let hoy = DatosTeatro.relojMadrid(reloj.ahora).fecha
            let n = agenda.days.first { $0.date == hoy }?.matches.count ?? 0
            lista.append(Dato(id: "hoy", texto: "Hoy \(n) \(n == 1 ? "partido" : "partidos")"))
        }
        return lista
    }

    var body: some View {
        Flujo(horizontal: 6, vertical: 6, alineacion: .center) {
            ForEach(datosVisibles) { dato in pastilla(dato) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Resumen")
    }

    private func pastilla(_ dato: Dato) -> some View {
        HStack(spacing: 6) {
            if let punto = dato.punto { Circle().fill(punto).frame(width: 7, height: 7) }
            Text(dato.texto).estilo(EstiloTexto(tamano: 12, peso: 600))
        }
        .foregroundStyle(Color.white.opacity(0.86))
        .padding(.horizontal, 10)
        .frame(height: 26)
        .background(Capsule().fill(Color.white.opacity(0.06)))
        .bordeInterior(Color.white.opacity(0.12), forma: Capsule())
    }
}
