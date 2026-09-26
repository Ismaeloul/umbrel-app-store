import SwiftUI

/* El marcador grande de la pestaña «Partido» (`BigScore` de Scoreboard.tsx; a4 §14.1): los dos escudos de 72 con
   su nombre y, en medio, las cifras de 64 (destapado), las barras de censura con «Destapar el marcador» (tapado),
   la hora o «Programado»; debajo, el minuto con el punto o «Final» / «En 48 min». Con un gol visto destapado, el
   escudo del que marca crece a 1,14 (muelle héroe). */

struct MarcadorGrande: View {
    let partido: FootballMatch
    let marcador: LiveScore?
    let estado: EstadoTeatro?
    let base: URL?
    @Environment(MarcadoresDestapados.self) private var destapados
    @Environment(Haptica.self) private var haptica
    @State private var anterior: [Int]?
    @State private var golesLocal = 0
    @State private var golesVisitante = 0

    private var pintable: LiveScore? { DatosTeatro.pintable(marcador) }
    private var tapado: Bool { pintable != nil && !destapados.destapado(partido.id) }
    private var enDirecto: Bool { estado?.fase == .directo }
    private var terminado: Bool { estado?.fase == .terminado }

    var body: some View {
        let visto: [Int]? = tapado ? nil : pintable.map { [$0.home, $0.away] }
        HStack(alignment: .center, spacing: 8) {
            LadoMarcador(
                equipo: EquiposTeatro.equipo(partido, local: true, base: base), encendido: enDirecto, terminado: terminado,
                goles: golesLocal)
            centro.frame(minWidth: 92)
            if partido.away.isEmpty {
                Color.clear.frame(maxWidth: .infinity)
            } else {
                LadoMarcador(
                    equipo: EquiposTeatro.equipo(partido, local: false, base: base), encendido: enDirecto, terminado: terminado,
                    goles: golesVisitante)
            }
        }
        .onChange(of: visto, initial: true) { _, nuevo in gol(nuevo) }
    }

    /// Un gol visto destapado: el escudo del que marca crece a 1,14 (tapado no se celebra).
    private func gol(_ nuevo: [Int]?) {
        defer { anterior = nuevo }
        guard let nuevo, let antes = anterior, nuevo.count == 2, antes.count == 2 else { return }
        if nuevo[0] > antes[0] {
            golesLocal += 1
        } else if nuevo[1] > antes[1] {
            golesVisitante += 1
        }
    }

    private var centro: some View {
        VStack(spacing: 8) {
            medio
            debajo
        }
    }

    @ViewBuilder private var medio: some View {
        if tapado {
            VStack(spacing: 8) {
                HStack(spacing: 10) {
                    ForEach(0..<2, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 8, style: .circular).fill(Palco.text3.opacity(0.55)).frame(width: 30, height: 40)
                    }
                }
                .accessibilityHidden(true)
                BotonPalco("Destapar el marcador", variante: .quieto, tamano: .sm) {
                    haptica.disparar(.ligera)
                    destapados.destapar(partido.id)
                }
            }
        } else if let pintable {
            HStack(spacing: 6.4) {
                Num(String(pintable.home), tamano: 64, animacion: .rueda)
                Text("–").estilo(EstiloTexto(tamano: 64, peso: 500, anchura: 75, altoLinea: 0.9)).foregroundStyle(Palco.text3)
                Num(String(pintable.away), tamano: 64, animacion: .rueda)
            }
            .foregroundStyle(Palco.text)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(DatosTeatro.etiquetaMarcador(partido, pintable, terminado: terminado))
        } else if DatosTeatro.hora(partido.time) != nil {
            Num(partido.time, tamano: 44, etiqueta: "A las \(partido.time)").foregroundStyle(Palco.text)
        } else {
            Text(partido.time.isEmpty ? "Programado" : partido.time)
                .estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.45)).foregroundStyle(Palco.text2)
        }
    }

    @ViewBuilder private var debajo: some View {
        if enDirecto {
            MinutoEnVivo(marcador: marcador, tamano: 15).foregroundStyle(Palco.liveInk)
        } else {
            let texto = terminado ? "Final" : (estado.map { DatosTeatro.unidadesJuntas($0.texto) } ?? "Programado")
            Text(texto).estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.45)).foregroundStyle(Palco.text2)
        }
    }
}

/// Un lado: escudo de 72 (encendido en directo) y nombre 15/800/125 centrado (terminado: `--text-2`).
private struct LadoMarcador: View {
    let equipo: DatosEquipo
    let encendido: Bool
    let terminado: Bool
    let goles: Int
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        let quieto: Bool = reducido
        VStack(spacing: 8) {
            MarcaEquipo(equipo, tamano: 72, encendido: encendido)
                .shadow(color: .black.opacity(0.5), radius: 8, x: 0, y: 8)
                .keyframeAnimator(initialValue: 1.0, trigger: goles) { vista, escala in
                    vista.scaleEffect(quieto ? 1 : escala)
                } keyframes: { _ in
                    KeyframeTrack {
                        SpringKeyframe(1.14, duration: 0.28, spring: .init(duration: 0.55, bounce: 0.3))
                        SpringKeyframe(1.0, duration: 0.52, spring: .init(duration: 0.55, bounce: 0.3))
                    }
                }
            Text(equipo.nombre)
                .estilo(EstiloTexto(tamano: 15, peso: 800, anchura: 125, altoLinea: 1.2))
                .foregroundStyle(terminado ? Palco.text2 : Palco.text)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
