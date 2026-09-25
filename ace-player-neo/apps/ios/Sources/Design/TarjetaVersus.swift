import SwiftUI

/* La tarjeta «versus» de Palco: fondo partido 50/50 con el color de cada
   club (unión en diagonal de 6°), los dos escudos grandes, el logo de la
   competición en una pastilla oscura en el centro, el chip de fecha y hora
   (o «● EN DIRECTO · 13'») arriba a la izquierda y la cápsula de señal abajo
   a la derecha. NUNCA lleva el marcador (anti-spoiler): eso va en el escenario. */

/// La mitad derecha de la tarjeta, con la unión inclinada 6° respecto a la vertical.
struct MitadDerecha: Shape {
    /// Inclinación de la unión, en grados.
    var grados: Double = 6

    func path(in rect: CGRect) -> Path {
        let desvio = tan(grados * .pi / 180) * rect.height / 2
        var camino = Path()
        camino.move(to: CGPoint(x: rect.midX + desvio, y: rect.minY))
        camino.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        camino.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        camino.addLine(to: CGPoint(x: rect.midX - desvio, y: rect.maxY))
        camino.closeSubpath()
        return camino
    }
}

/// El fondo de dos colores con una luz suave arriba y una sombra abajo.
struct FondoVersus: View {
    let eleccion: ColoresVersus.Eleccion

    var body: some View {
        ZStack {
            Rectangle().fill(eleccion.local.color)
            MitadDerecha().fill(eleccion.visitante.color)
            MitadDerecha().stroke(.white.opacity(0.18), lineWidth: 1)
            LinearGradient(
                colors: [.white.opacity(0.14), .clear, .black.opacity(0.28)], startPoint: .top, endPoint: .bottom
            )
            .blendMode(.overlay)
        }
    }
}

/// Pastilla oscura del centro con el logo de la competición (o su nombre).
struct PastillaCompeticion: View {
    @Environment(AppModel.self) private var app
    let partido: FootballMatch
    var compacta = false

    var body: some View {
        let alto: CGFloat = compacta ? 30 : 40
        let logo = app.urlImagen(partido.competitionBadge?.logo)
        // Con logo, la pastilla es casi un círculo (el logo cabe en su alto); sin
        // él, el nombre a su ancho natural con tope. Antes el marco era flexible y
        // se estiraba hasta 140 pt, encima de los escudos (capturas de la CI).
        ImagenCacheada(url: logo) {
            Text(nombreCorto)
                .font((compacta ? Font.caption2 : Font.caption).weight(.bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, compacta ? 8 : 10)
                .frame(maxWidth: compacta ? 96 : 140)
        }
        .frame(width: logo == nil ? nil : alto - 10, height: alto - 10)
        .fixedSize(horizontal: true, vertical: false)
        .padding(.vertical, 5)
        .padding(.horizontal, 5)
        .background {
            Capsule().fill(.black.opacity(0.55))
            Capsule().fill(.ultraThinMaterial).opacity(0.6)
            Capsule().strokeBorder(.white.opacity(0.14), lineWidth: 0.5)
        }
        .accessibilityHidden(true)
    }

    private var nombreCorto: String {
        let nombre = partido.competition.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !nombre.isEmpty else { return "Fútbol" }
        return nombre.count > 22 ? String(nombre.prefix(20)) + "…" : nombre
    }
}

/// La tarjeta 16:9 (radio 14).
struct TarjetaVersus: View {
    let partido: FootballMatch
    let marcador: LiveScore?
    /// Está en juego (por el marcador o por la hora).
    let enDirecto: Bool
    let capsula: CapsulaSenal?
    var tuEquipo = false
    /// Suena en este iPhone.
    var enPantalla = false
    /// Para las filas horizontales (220 pt).
    var compacta = false
    @Environment(\.colorScheme) private var esquema

    private var eleccion: ColoresVersus.Eleccion {
        ColoresVersus.elegir(
            local: partido.homeTeam?.colors, visitante: partido.awayTeam?.colors, nombreLocal: partido.home,
            nombreVisitante: partido.away.isEmpty ? partido.title : partido.away)
    }

    var body: some View {
        let tamanoEscudo: CGFloat = compacta ? 44 : 64
        let margen: CGFloat = compacta ? 8 : 12
        ZStack {
            FondoVersus(eleccion: eleccion)
            HStack(spacing: 0) {
                EscudoView(equipo: partido.equipoLocal, tamano: tamanoEscudo)
                    .frame(maxWidth: .infinity)
                if !partido.away.isEmpty {
                    EscudoView(equipo: partido.equipoVisitante, tamano: tamanoEscudo)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, tamanoEscudo * 0.2)
            PastillaCompeticion(partido: partido, compacta: compacta)
            VStack {
                HStack(alignment: .top) {
                    chipHora
                    Spacer(minLength: 4)
                    if tuEquipo {
                        Image(systemName: "star.fill")
                            .font(compacta ? .caption2 : .caption)
                            .foregroundStyle(Tinta.oro)
                            .padding(6)
                            .background(.black.opacity(0.45), in: Circle())
                            .accessibilityHidden(true)
                    }
                }
                Spacer(minLength: 4)
                HStack(alignment: .bottom) {
                    if enPantalla {
                        CapsulaPalco(texto: "En pantalla", tono: .oro, icono: "waveform", sobreImagen: true, compacta: compacta)
                    }
                    Spacer(minLength: 4)
                    if let capsula {
                        CapsulaSenalView(capsula: capsula, sobreImagen: true, compacta: compacta)
                    }
                }
            }
            .padding(margen)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous)
                .strokeBorder(
                    esquema == .dark ? Color.white.opacity(0.08) : Color.black.opacity(0.06), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(etiqueta)
    }

    private var chipHora: some View {
        let texto = FormatoAgenda.chipHora(partido, marcador: marcador, enDirecto: enDirecto)
        return CapsulaPalco(
            texto: texto, tono: enDirecto ? .directo : .neutro, punto: enDirecto, sobreImagen: true, compacta: compacta
        )
        .accessibilityLabel(enDirecto ? "En directo" : texto)
    }

    private var etiqueta: String {
        var partes = [FormatoAgenda.equipos(partido), partido.competition]
        if enDirecto {
            partes.append(marcador.flatMap(Marcador.minuto).map { "en directo, minuto \($0)" } ?? "en directo")
        } else if marcador?.state == "post" {
            partes.append("terminado")
        } else {
            partes.append("\(FormatoAgenda.etiqueta(dia: partido.date)) a las \(partido.time)")
        }
        if let capsula { partes.append("señal: \(capsula.texto)") }
        if tuEquipo { partes.append("tu equipo") }
        if enPantalla { partes.append("en pantalla") }
        return partes.joined(separator: ", ")
    }
}

/// Debajo de la tarjeta: «Local vs. Visitante» y la competición.
struct PieVersus: View {
    let partido: FootballMatch
    var compacta = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(titulo)
                .font(compacta ? .subheadline.weight(.bold) : .titular(.headline, peso: .bold))
                .foregroundStyle(Tinta.texto)
                .lineLimit(compacta ? 1 : 2)
                .minimumScaleFactor(0.85)
            Text(partido.competition.isEmpty ? "Fútbol" : partido.competition)
                .font(compacta ? .caption : .subheadline)
                .foregroundStyle(Tinta.texto2)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHidden(true)
    }

    private var titulo: String {
        partido.away.isEmpty ? partido.title : "\(partido.home) vs. \(partido.away)"
    }
}
