import SwiftUI

/* Tarjeta de partido de la agenda (M5; a3 §6.4, §6.5; MatchRow.tsx): la tarjeta versus 240 × 150, la línea de
   progreso en directo, y la línea de estado, canales y acción. Toda la tarjeta es UN botón («Ver canal
   para…»); la cápsula «Marcador» va por encima, aparte. Menú contextual nativo con las opciones de `menuFor`
   (las mismas como acciones de VoiceOver). */

struct TarjetaPartido: View {
    let partido: FootballMatch
    let foto: FotoAgenda
    let canales: [InfoCanal]
    let opciones: [AccionMenu]
    let origenVuelo: Bool
    let abrir: () -> Void
    @Environment(MarcadoresDestapados.self) private var destapados

    private var marcador: LiveScore? { foto.marcadores[partido.id] }
    private var estado: EstadoPartido? { ReglasAgenda.estado(partido, reloj: foto.reloj, marcador: marcador) }
    private var directo: Bool { estado?.fase == .directo }
    private var pintable: LiveScore? { Marcadores.pintable(marcador) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .bottomTrailing) {
                Button(action: abrir) { tarjeta }
                    .buttonStyle(EstiloTarjeta())
                    .accessibilityLabel(OpcionesPartido.etiquetaTarjeta(partido, canales: canales))
                    .accessibilityIdentifier(IDUI.tarjetaPartido(partido.id))
                    .menuContextual(opciones)
                if let pintable {
                    CapsulaMarcador(
                        partido: partido, marcador: pintable, destapado: destapados.destapado(partido.id),
                        variante: .tarjeta, soloIcono: true
                    )
                    .padding(12)
                }
            }
            if directo {
                BarraProgreso(
                    valor: Marcadores.progreso(partido, ahora: foto.ahora, marcador: marcador), fina: true, tono: .directo,
                    muescas: [0.5], etiqueta: "Progreso del partido"
                )
                .padding(.horizontal, 4)
            }
            LineaTarjeta(estado: estado, canales: canales)
        }
        .accessibilityElement(children: .contain)
    }

    private var tarjeta: some View {
        ConSenal(partido: partido, ahora: foto.ahora, terminado: estado?.fase == .terminado) { senal in
            VersusAgenda(
                DatosTarjetaAgenda.de(
                    partido, reloj: foto.reloj, marcador: marcador, mio: ParaTi.destacado(partido, foto.gustos),
                    enPantalla: false),
                tamano: .fila, reservaNombres: pintable == nil ? 0 : 60, origenVuelo: origenVuelo
            ) {
                if let senal { CapsulaSenal(senal: senal, grande: false).layoutPriority(-1) }
            }
        }
        .sombra(directo ? sombraDirecto : [], forma: RoundedRectangle(cornerRadius: R.m, style: .circular))
    }

    /// En directo: `0 12 26 −16` con la luz del club local al 80 % (a3 §6.4.1).
    private var sombraDirecto: [CapaSombra] {
        let luz = TarjetasAgenda.lado(partido, local: true).luz
        return [CapaSombra(y: 12, desenfoque: 26, expansion: -16, color: luz.color.opacity(0.8))]
    }
}

/// Pulsada, la tarjeta baja 1 pt con el muelle rápido (con movimiento reducido, nada).
private struct EstiloTarjeta: ButtonStyle {
    @Environment(\.movimientoReducido) private var reducido

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .offset(y: configuration.isPressed && !reducido ? 1 : 0)
            .animation(Movimiento.rapido(reducido), value: configuration.isPressed)
    }
}

/// `.agenda-row__meta`: estado · canales (hasta 2, subrayados; « +n») · acción; 12 pt `--text-2`.
private struct LineaTarjeta: View {
    let estado: EstadoPartido?
    let canales: [InfoCanal]

    private var disponible: Bool { canales.contains(where: \.enBiblioteca) }

    struct CanalConIndice {
        let indice: Int
        let canal: InfoCanal
    }

    /// Hasta 2 rótulos (MatchRow.tsx `channels.slice(0, 2)`).
    private var primeros: [CanalConIndice] {
        Array(canales.prefix(2)).enumerated().map { CanalConIndice(indice: $0.offset, canal: $0.element) }
    }

    var body: some View {
        HStack(spacing: 8) {
            if let estado { nota(estado) }
            if canales.isEmpty {
                Text("Canal por confirmar").estilo(.pista).foregroundStyle(Palco.text3).lineLimit(1)
            } else {
                listaCanales
            }
            Spacer(minLength: 0)
            if !canales.isEmpty {
                IconoPalco(disponible ? .play : .buscar, tamano: 16)
                    .foregroundStyle(Palco.accentInk)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 2)
        .frame(height: 22)  // line-height: 22px de la línea de canales
        .accessibilityHidden(true)
    }

    private func nota(_ estado: EstadoPartido) -> some View {
        HStack(spacing: 2) {
            if estado.fase == .directo { PuntoDirecto().padding(.leading, -4) }
            Text(ReglasAgenda.unidadesJuntas(estado.texto))
                .estilo(EstiloTexto(tamano: 12, peso: 680, anchura: 88, altoLinea: 1.45))
                .contentTransition(.numericText())
                .animation(Movimiento.estandar(false), value: estado.texto)
        }
        .foregroundStyle(colorNota(estado.fase))
        .fixedSize()
    }

    private func colorNota(_ fase: FasePartido) -> Color {
        switch fase {
        case .directo, .pronto: Palco.liveInk
        case .terminado: Palco.text3
        case .proximo: Palco.text2
        }
    }

    private var listaCanales: some View {
        HStack(spacing: 0) {
            IconoPalco(.tv, tamano: 16).foregroundStyle(Palco.text3).padding(.trailing, 5).offset(y: 1.5)
            ForEach(primeros, id: \.indice) { (par: CanalConIndice) in
                if par.indice > 0 { Text(" · ").estilo(.pista).foregroundStyle(Palco.text3) }
                RotuloCanal(canal: par.canal)
            }
            if canales.count > 2 {
                Text(" +\(canales.count - 2)").estilo(.pista).foregroundStyle(Palco.text3)
            }
        }
        .lineLimit(1)
        .truncationMode(.tail)
    }
}

/// Un canal: 640, subrayado de 1 pt `--line-strong` a 4 pt (continuo si está en tu biblioteca; discontinuo si
/// se buscará al reproducir).
private struct RotuloCanal: View {
    let canal: InfoCanal

    var body: some View {
        Text(canal.nombre)
            .estilo(EstiloTexto(tamano: 12, peso: 640, altoLinea: 1.45))
            .foregroundStyle(canal.enBiblioteca ? Palco.text : Palco.text2)
            .lineLimit(1)
            .overlay(alignment: .bottom) {
                Subrayado(discontinuo: !canal.enBiblioteca)
                    .stroke(Palco.lineStrong, style: StrokeStyle(lineWidth: 1, dash: canal.enBiblioteca ? [] : [2, 2]))
                    .frame(height: 1)
                    .offset(y: 1)
            }
    }
}

private struct Subrayado: Shape {
    let discontinuo: Bool

    func path(in rect: CGRect) -> Path {
        var camino = Path()
        camino.move(to: CGPoint(x: rect.minX, y: rect.midY))
        camino.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return camino
    }
}
