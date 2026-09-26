import SwiftUI

/* Panel de partidos (M5; a3 §6): los bloques por competición (separación 16), la entrada al cambiar de día o
   de filtro (desde ±24 con el muelle estándar), la aparición escalonada de las 12 primeras tarjetas (36 ms,
   tope 10) y el gesto de deslizar a los lados para cambiar de día (resistencia 0,3× hasta ±60). */

struct PanelPartidos<Celda: View>: View {
    let grupos: [GrupoLiga]
    let direccion: DireccionDia?
    let celda: (FootballMatch, Int?) -> Celda
    @Environment(\.movimientoReducido) private var reducido
    @State private var entrando = true

    init(grupos: [GrupoLiga], direccion: DireccionDia?, @ViewBuilder celda: @escaping (FootballMatch, Int?) -> Celda) {
        self.grupos = grupos
        self.direccion = direccion
        self.celda = celda
    }

    /// El índice de cada partido a lo largo de todos los grupos (solo los 12 primeros escalonan).
    private var indices: [String: Int] {
        var mapa: [String: Int] = [:]
        var n = 0
        for grupo in grupos {
            for partido in grupo.partidos {
                mapa[partido.id] = n
                n += 1
            }
        }
        return mapa
    }

    var body: some View {
        let mapa = indices
        VStack(alignment: .leading, spacing: 16) {
            ForEach(grupos) { grupo in
                GrupoCompeticion(grupo: grupo, logo: logo(grupo)) { partido in
                    celda(partido, escalonado(mapa[partido.id]))
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Partidos")
        .task {
            try? await Task.sleep(for: .milliseconds(900))  // solo lo que se monta al entrar escalona
            entrando = false
        }
    }

    private func escalonado(_ indice: Int?) -> Int? {
        guard entrando, let indice, indice < 12 else { return nil }
        return indice
    }

    @MainActor
    private func logo(_ grupo: GrupoLiga) -> URL? {
        grupo.partidos.lazy.compactMap { RecursosServidor.imagen(TarjetasAgenda.logoCompeticion($0)) }.first
    }
}

/// `ace-aparece` escalonado: opacidad 0 → 1 y `translateY 8 → 0`, 520 ms estándar, retraso `min(i, 10) × 36 ms`.
struct AparicionEscalonada: ViewModifier {
    let indice: Int?
    @Environment(\.movimientoReducido) private var reducido
    @State private var visible: Bool

    init(indice: Int?) {
        self.indice = indice
        _visible = State(initialValue: indice == nil)
    }

    func body(content: Content) -> some View {
        content
            .opacity(visible ? 1 : 0)
            .offset(y: visible || reducido ? 0 : 8)
            .onAppear {
                guard !visible else { return }
                let retraso: Double = reducido ? 0 : Movimiento.escalonado(indice ?? 0)
                withAnimation(Movimiento.estandar(reducido).delay(retraso)) { visible = true }
            }
    }
}

/// Entrada de la lista entera al cambiar de día (±24) o de filtro (fundido).
extension AnyTransition {
    @MainActor
    static func entradaLista(_ direccion: DireccionDia?, reducido: Bool) -> AnyTransition {
        guard !reducido, let direccion else { return .opacity }
        let dx: CGFloat = direccion == .siguiente ? 24 : -24
        return .asymmetric(insertion: .offset(x: dx).combined(with: .opacity), removal: .identity)
    }
}
