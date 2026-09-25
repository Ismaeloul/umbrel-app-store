import Foundation

/* Reparte los eventos del SSE (b-arquitectura §2.5.3, I0→M1; a7 §6.3-§6.4): aplica
   `EfectosEvento.de(_:)` (puro) a cada dueño y lleva el sondeo de respaldo (5 s reproducción, 20 s
   motor) mientras el tiempo real está en `.respaldo`.
   ESQUELETO de I0 (fase 0.3b): solo avisa a los oyentes; M1 aplica los efectos y el sondeo. */

@MainActor final class RepartidorEventos {
    private let datos: DatosApp
    private let tiempoReal: TiempoReal
    private let sesion: SesionApp
    private let reproductor: Reproductor
    private let fuentes: SesionFuentes
    private let senales: SenalPartidos
    private let avisos: Avisos
    private let cicloVida: CicloVida
    private var oyentes: [Int: (SSEEvent) -> Void] = [:]
    private var siguienteOyente = 1

    init(
        datos: DatosApp, tiempoReal: TiempoReal, sesion: SesionApp, reproductor: Reproductor, fuentes: SesionFuentes,
        senales: SenalPartidos, avisos: Avisos, cicloVida: CicloVida
    ) {
        self.datos = datos
        self.tiempoReal = tiempoReal
        self.sesion = sesion
        self.reproductor = reproductor
        self.fuentes = fuentes
        self.senales = senales
        self.avisos = avisos
        self.cicloVida = cicloVida
    }

    func arrancar() {}  // engancha tiempoReal.alEvento; sondeo 5 s (reproducción) y 20 s (motor) en .respaldo
    func parar() {}

    /// EfectosEvento.de(evento) → a cada dueño.
    func aplicar(_ evento: SSEEvent) {
        for oyente in oyentes.values { oyente(evento) }
    }

    func escuchar(_ oyente: @escaping (SSEEvent) -> Void) -> Int {
        let id = siguienteOyente
        siguienteOyente += 1
        oyentes[id] = oyente
        return id
    }

    func dejarDeEscuchar(_ id: Int) { oyentes[id] = nil }
}
