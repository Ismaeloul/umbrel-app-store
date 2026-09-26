import SwiftUI

/* Pestaña «Partido» (MatchPanel.tsx, BigScore de Scoreboard.tsx y WhereAired.tsx; a4 §14): la tarjeta del
   marcador grande sobre la luz de los dos clubes (con «Destapar el marcador» si está tapado) y la barra del
   partido, la competición con su pastilla y su día, y «Dónde se emite» con los canales (continuo si están en tu
   biblioteca, discontinuo si se buscarán al reproducir). Sin la chuleta de atajos (táctil). */

struct PanelPartido: View {
    let partido: FootballMatch
    let marcador: LiveScore?
    let ahora: Date
    @Environment(DatosApp.self) private var datos
    @State private var base: URL?

    private var estado: EstadoTeatro? { DatosTeatro.estado(partido, marcador: marcador, ahora: ahora) }
    private var hoy: String { DatosTeatro.relojMadrid(ahora).fecha }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TarjetaMarcador(partido: partido, marcador: marcador, estado: estado, ahora: ahora, base: base)
            competicion
            DondeSeEmite(partido: partido, canales: canales, pie: DatosTeatro.pieEmision(partido, hoy: hoy))
        }
        .modifier(BaseServidor(base: $base))
    }

    private var canales: [CanalEmision] {
        DatosTeatro.canales(partido, biblioteca: OtrasFuentes.todo(datos.biblioteca.datos))
    }

    private var competicion: some View {
        HStack(spacing: 12) {
            if !partido.competition.isEmpty {
                PastillaCompeticion(
                    nombre: partido.competition, logo: EquiposTeatro.url(partido.competitionBadge?.logo, base: base),
                    tamano: 28)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(partido.competition.isEmpty ? "Partido" : partido.competition)
                    .estilo(EstiloTexto(tamano: 15, peso: 800, anchura: 125, altoLinea: 1.25))
                    .foregroundStyle(Palco.text)
                Text(DatosTeatro.dia(partido.date, hoy: hoy).largo)
                    .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
            }
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
    }
}

/// La tarjeta: relleno 20 16, radio 24, `--surface`, borde `--line-soft` y `--shadow-1`, con la luz de los clubes
/// (dos radiales al 22 % en 12 %/40 % y 88 %/40 %; opacidad 0,8, 1 en directo, 0,4 terminado).
private struct TarjetaMarcador: View {
    let partido: FootballMatch
    let marcador: LiveScore?
    let estado: EstadoTeatro?
    let ahora: Date
    let base: URL?
    @State private var tamano: CGSize = .zero

    private var luz: Double { estado?.fase == .directo ? 1 : (estado?.fase == .terminado ? 0.4 : 0.8) }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
        VStack(spacing: 16) {
            MarcadorGrande(partido: partido, marcador: marcador, estado: estado, base: base)
            if estado?.fase == .directo || estado?.fase == .terminado { barra }
        }
        .padding(.vertical, 20)
        .padding(.horizontal, 16)
        .background { luces.opacity(luz) }
        .background(Palco.surface)
        .clipShape(forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .sombra(.s1, forma: forma)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { tamano = $0 }
    }

    private var luces: some View {
        let local = EquiposTeatro.equipo(partido, local: true, base: nil).primario.color
        let visitante = partido.away.isEmpty ? local : EquiposTeatro.equipo(partido, local: false, base: nil).primario.color
        let rx: CGFloat = tamano.width * 0.6
        let ry: CGFloat = tamano.height * 0.8
        return ZStack {
            Degradado.elipse(local.opacity(0.22), radioX: rx, radioY: ry, hasta: 0.72, centro: UnitPoint(x: 0.12, y: 0.4))
            Degradado.elipse(visitante.opacity(0.22), radioX: rx, radioY: ry, hasta: 0.72, centro: UnitPoint(x: 0.88, y: 0.4))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Barra de 6, relleno `--live`, muesca del descanso en 0,5; debajo «0'» · «Descanso» · «90'».
    private var barra: some View {
        let minuto = DatosTeatro.minuto(marcador)
        let etiqueta = estado?.fase == .terminado
            ? "Partido terminado" : (minuto.map { "Minuto \($0.minuto) de 90" } ?? "Partido en juego")
        let estilo = EstiloTexto(tamano: 12, peso: 650, altoLinea: 1.45)
        return VStack(spacing: 6) {
            BarraProgreso(
                valor: DatosTeatro.progreso(partido, marcador: marcador, ahora: ahora), tono: .directo, muescas: [0.5],
                etiqueta: etiqueta)
            HStack {
                Text("0'").estilo(estilo)
                Spacer()
                Text("Descanso").estilo(estilo)
                Spacer()
                Text("90'").estilo(estilo)
            }
            .foregroundStyle(Palco.text2)
            .accessibilityHidden(true)
        }
    }
}

/// «Dónde se emite»: tarjeta de relleno 16, radio 24; chips de 28 con la tele (continuo = en tu biblioteca,
/// discontinuo = se buscará al reproducir) o «Canal por confirmar»; pie con la competición, el día y la hora.
private struct DondeSeEmite: View {
    let partido: FootballMatch
    let canales: [CanalEmision]
    let pie: String

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
        VStack(alignment: .leading, spacing: 12) {
            Text("Dónde se emite")
                .estilo(EstiloTexto(tamano: 13, peso: 650, trackingEm: 0.14, altoLinea: 1.45, mayusculas: true))
                .foregroundStyle(Palco.text2)
                .accessibilityAddTraits(.isHeader)
            if canales.isEmpty {
                Text("Canal por confirmar").estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
            } else {
                Flujo(horizontal: 8, vertical: 8) {
                    ForEach(canales) { canal in
                        Chip(canal.nombre, icono: .tv, contorno: canal.enBiblioteca ? .solido : .discontinuo)
                            .accessibilityHint(canal.enBiblioteca ? "Disponible en tu biblioteca" : "Se buscará al reproducir")
                    }
                }
            }
            Text(pie).estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.25)).foregroundStyle(Palco.text2)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palco.surface, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
    }
}
