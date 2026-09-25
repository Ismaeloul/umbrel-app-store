import SwiftUI

/* `useMatchSignal` de agenda/data.ts como vista (M5; a3 §7.2): lo que dijo el SSE (`SenalPartidos`, 20 min) o,
   dentro de la ventana del precalentado, la consulta `footballPreheat` del partido (cada 30 s sin tiempo real),
   solo con la vista a la vista. Pinta `contenido(senal)` con la señal decidida (nil = sin cápsula). */

struct ConSenal<Contenido: View>: View {
    let partido: FootballMatch
    let ahora: Date
    let terminado: Bool
    let contenido: (SenalPartido?) -> Contenido
    @Environment(DatosApp.self) private var datos
    @Environment(SenalPartidos.self) private var senales
    @Environment(TiempoReal.self) private var tiempoReal
    @Environment(\.vistaActiva) private var vistaActiva
    @State private var consulta: Consulta<PreheatResponse>?

    init(
        partido: FootballMatch, ahora: Date, terminado: Bool, @ViewBuilder contenido: @escaping (SenalPartido?) -> Contenido
    ) {
        self.partido = partido
        self.ahora = ahora
        self.terminado = terminado
        self.contenido = contenido
    }

    private var peticion: PeticionSenal {
        SenalesPartido.peticion(
            partido, ahora: ahora, terminado: terminado, comprobacion: senales.senal(partido: partido.id))
    }

    private var senal: SenalPartido? {
        switch peticion {
        case .ninguna: return nil
        case .fija(let senal): return senal
        case .precalentado:
            guard let consulta, consulta.datos != nil || consulta.error != nil else { return SenalesPartido.consultando }
            return SenalesPartido.desdePrecalentado(consulta.datos?.preheat)
        }
    }

    var body: some View {
        contenido(senal)
            .task(id: claveSondeo) { await sondear() }
    }

    private var claveSondeo: String {
        "\(partido.id)|\(peticion == .precalentado)|\(vistaActiva)|\(tiempoReal.abierto)"
    }

    /// Pide el precalentado dentro de la ventana; sin SSE, cada 30 s (data.ts `refetchInterval`).
    private func sondear() async {
        guard vistaActiva, peticion == .precalentado else { return }
        let consulta = datos.precalentado(partido: partido.id)
        self.consulta = consulta
        await consulta.asegurar(tiempoRealAbierto: tiempoReal.abierto)
        guard !tiempoReal.abierto else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(SenalesPartido.sondeoSinTiempoReal))
            guard !Task.isCancelled else { return }
            await consulta.refrescar()
        }
    }
}
