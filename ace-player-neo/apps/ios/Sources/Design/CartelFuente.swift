import SwiftUI

/* Carteles 16:9 de Palco sin miniatura: el de FUENTE (tesela con la marca
   del canal, nombre, calidad · proveedor y el anillo de estado; dorado el que
   está en pantalla) y el de CANAL (dorsal grande, nombre y la línea «ahora»).
   Solo la fuente activa tiene vídeo, y lo tiene en el escenario: ningún
   cartel lleva la capa de vídeo. */

// MARK: - Anillo de estado

/// Anillo alrededor de la tesela: forma + color según el estado. Verificada
/// verde lleno (se «dibuja» al verificarse), Floja ámbar 2/3, Sin señal rojo
/// con «!», Comprobando gris a trazos que giran, Pendiente gris punteado,
/// Reportada rojo; dorado si está en pantalla.
struct AnilloCalidad: View {
    let estado: EstadoSenal
    var reportada = false
    var activa = false
    var radio: CGFloat = 10
    var grosor: CGFloat = 2
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    @State private var dibujado: CGFloat = 1
    @State private var fase: CGFloat = 0

    private var color: Color {
        if activa { return Tinta.oro }
        if reportada { return Tinta.falloTinta }
        return estado.tinta
    }

    private var forma: RoundedRectangle { RoundedRectangle(cornerRadius: radio, style: .continuous) }

    var body: some View {
        ZStack {
            forma.strokeBorder(.white.opacity(0.08), lineWidth: grosor)
            switch estado {
            case .ok:
                forma
                    .trim(from: 0, to: dibujado)
                    .stroke(color, style: StrokeStyle(lineWidth: grosor, lineCap: .round))
            case .floja:
                forma
                    .trim(from: 0, to: 0.66)
                    .stroke(color, style: StrokeStyle(lineWidth: grosor, lineCap: .round))
            case .sinSenal:
                forma.stroke(color, lineWidth: grosor)
            case .comprobando:
                forma.stroke(color, style: StrokeStyle(lineWidth: grosor, dash: [6, 6], dashPhase: fase))
            case .pendiente:
                forma.stroke(color, style: StrokeStyle(lineWidth: grosor, dash: [2, 6]))
            }
            if estado == .sinSenal || reportada {
                VStack {
                    HStack {
                        Spacer()
                        Text("!")
                            .font(.caption2.weight(.black))
                            .foregroundStyle(.white)
                            .frame(width: 16, height: 16)
                            .background(Tinta.fallo, in: Circle())
                            .offset(x: 4, y: -4)
                    }
                    Spacer()
                }
            }
        }
        .padding(grosor / 2)
        .animation(sinMovimiento ? nil : .easeInOut(duration: 0.3), value: color)
        .onAppear { arrancarGiro() }
        .onChange(of: estado) { anterior, nuevo in
            if nuevo == .ok, anterior != .ok, !sinMovimiento {
                dibujado = 0
                withAnimation(.easeOut(duration: 0.7)) { dibujado = 1 }
            }
            arrancarGiro()
        }
        .accessibilityHidden(true)
    }

    private func arrancarGiro() {
        guard estado == .comprobando, !sinMovimiento else { return }
        fase = 0
        withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { fase = 12 }
    }
}

// MARK: - Cartel de fuente

/// Un cartel de fuente: tesela con la marca del canal, nombre, «1080p · Elcano» y anillo.
struct CartelFuente: View {
    let entrada: EntradaFuente
    let efectivo: Efectivo
    let activa: Bool
    var ancho: CGFloat = 160
    /// Espacio del rótulo «En pantalla» (se desliza de un cartel a otro).
    let espacio: Namespace.ID

    var body: some View {
        let senal = ReglasFuentes.senal(efectivo, entrada)
        let nombre = ReglasFuentes.parteCanal(entrada.titulo)
        let chips = ReglasFuentes.chipsCartel(entrada)
        VStack(alignment: .leading, spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Tinta.superficie2, Tinta.superficie], startPoint: .top, endPoint: .bottom))
                LogoCanal(titulo: nombre, tamano: ancho * 0.32)
                    .opacity(efectivo.estado == .failed || efectivo.reportada ? 0.45 : 1)
                if activa {
                    VStack {
                        Spacer()
                        HStack {
                            HStack(spacing: 4) {
                                Image(systemName: "waveform")
                                    .symbolEffect(.variableColor.iterative, options: .repeating)
                                Text("En pantalla")
                            }
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Tinta.sobreAcento)
                            .padding(.horizontal, 8)
                            .frame(height: 20)
                            .background(Tinta.oro, in: Capsule())
                            .matchedGeometryEffect(id: "en-pantalla", in: espacio)
                            Spacer()
                        }
                    }
                    .padding(8)
                }
                AnilloCalidad(estado: senal.estado, reportada: efectivo.reportada, activa: activa)
            }
            .frame(width: ancho, height: ancho * 9 / 16)

            Text(nombre)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Tinta.texto)
                .lineLimit(1)
            HStack(spacing: 6) {
                HStack(spacing: 4) {
                    Circle().fill(activa ? Tinta.oro : senal.estado.tinta).frame(width: 6, height: 6)
                    Text(senal.palabra)
                        .foregroundStyle(activa ? Tinta.acentoTinta : senal.estado.tinta)
                }
                if !chips.isEmpty {
                    Text(chips)
                        .foregroundStyle(Tinta.texto3)
                        .lineLimit(1)
                }
            }
            .font(.caption.weight(.semibold))
        }
        .frame(width: ancho, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(ReglasFuentes.nombreVisible(entrada)). \(senal.palabra)\(activa ? ", en pantalla" : "")")
        .accessibilityAddTraits(activa ? [.isSelected, .isButton] : [.isButton])
        .accessibilityIdentifier("fuente-\(entrada.id.prefix(8))")
    }
}

// MARK: - Cartel de canal

/// Un canal como cartel (Canales › Emitiendo ahora): dorsal grande, nombre y
/// lo que emite ahora.
struct CartelCanal: View {
    let item: Item
    let antena: EnAntena?
    var favorito = false
    var enPantalla = false
    var ancho: CGFloat = 220
    @Environment(\.colorScheme) private var esquema

    var body: some View {
        let tono = ColorEquipo.tono(item.title)
        let base = Color(hue: tono, saturation: esquema == .dark ? 0.35 : 0.3, brightness: esquema == .dark ? 0.22 : 0.9)
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous)
                    .fill(LinearGradient(colors: [base, Tinta.superficie2], startPoint: .topLeading, endPoint: .bottomTrailing))
                LogoCanal(titulo: item.title, tamano: 52)
                    .padding(.leading, 14)
                VStack {
                    HStack {
                        Spacer()
                        if favorito {
                            Image(systemName: "star.fill")
                                .font(.caption2)
                                .foregroundStyle(Tinta.oro)
                                .padding(6)
                                .background(.black.opacity(0.45), in: Circle())
                                .accessibilityHidden(true)
                        }
                        if let antena {
                            CapsulaPalco(
                                texto: antena.enDirecto ? textoMinuto(antena) : "A las \(antena.partido.time)",
                                tono: antena.enDirecto ? .directo : .neutro, punto: antena.enDirecto, sobreImagen: true,
                                compacta: true)
                        }
                    }
                    Spacer()
                    if enPantalla {
                        HStack {
                            Spacer()
                            CapsulaPalco(texto: "En pantalla", tono: .oro, icono: "waveform", sobreImagen: true, compacta: true)
                        }
                    }
                }
                .padding(8)
            }
            .frame(width: ancho, height: ancho * 9 / 16)
            Text(item.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Tinta.texto)
                .lineLimit(1)
            Text(antena.map { FormatoAgenda.equipos($0.partido) } ?? (item.category.isEmpty ? "Canal" : item.category))
                .font(.caption)
                .foregroundStyle(Tinta.texto2)
                .lineLimit(1)
        }
        .frame(width: ancho, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(etiqueta)
        .accessibilityAddTraits(.isButton)
    }

    private func textoMinuto(_ antena: EnAntena) -> String {
        guard let marcador = antena.marcador, marcador.state == "in" else { return "En directo" }
        return Marcador.reloj(marcador)
    }

    private var etiqueta: String {
        var partes = [item.title]
        if let antena {
            partes.append(
                antena.enDirecto
                    ? "emitiendo \(FormatoAgenda.equipos(antena.partido))"
                    : "a las \(antena.partido.time), \(FormatoAgenda.equipos(antena.partido))")
        }
        if favorito { partes.append("favorito") }
        if enPantalla { partes.append("en pantalla") }
        return partes.joined(separator: ", ")
    }
}
