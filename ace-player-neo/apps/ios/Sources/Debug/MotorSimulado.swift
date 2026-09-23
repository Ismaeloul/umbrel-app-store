#if DEBUG
    import AVFoundation
    import Foundation

    /// Motor de vídeo simulado para las pruebas de interfaz: «reproduce» sin
    /// red ni vídeo (listo a los 0,3 s, primer fotograma a los 0,6 s y el
    /// cabezal avanzando en tiempo real). Solo existe en Debug.
    @MainActor
    final class MotorSimulado: MotorVideo {
        var alEvento: ((EventoMotor) -> Void)?
        private(set) var estadoTiempo: EstadoTiempo = .pausado
        var probableSinCortes: Bool { cargado }
        private(set) var tiempoActual: Double = 0
        var ventana: VentanaDirecto? {
            cargado ? VentanaDirecto(inicio: max(0, borde - 60), fin: borde) : nil
        }
        var colchonPorDelante: Double { cargado ? 4 : 0 }
        var avPlayer: AVPlayer? { nil }

        private var cargado = false
        private var borde: Double = 0
        private var reloj: Task<Void, Never>?
        private var primerFotogramaAvisado = false

        init() {}

        func cargar(url: URL, perfil: IosPlaybackProfile) {
            vaciar()
            cargado = true
            borde = 120
            tiempoActual = borde - perfil.liveEdgeOffsetS
            reloj = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(300))
                guard let self, !Task.isCancelled else { return }
                self.alEvento?(.listo)
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                    self.avanzar(0.25)
                }
            }
        }

        private func avanzar(_ segundos: Double) {
            borde += segundos
            guard estadoTiempo == .reproduciendo else { return }
            tiempoActual += segundos
            if !primerFotogramaAvisado, tiempoActual > 0 {
                primerFotogramaAvisado = true
                alEvento?(.primerFotograma)
            }
        }

        func aplicar(perfil: IosPlaybackProfile) {}

        func reproducir() {
            guard cargado, estadoTiempo != .reproduciendo else { return }
            estadoTiempo = .reproduciendo
            alEvento?(.estado(.reproduciendo))
        }

        func pausar() {
            guard estadoTiempo != .pausado else { return }
            estadoTiempo = .pausado
            alEvento?(.estado(.pausado))
        }

        func saltar(a segundos: Double) async -> Bool {
            tiempoActual = min(segundos, borde)
            return true
        }

        func vaciar() {
            reloj?.cancel()
            reloj = nil
            cargado = false
            primerFotogramaAvisado = false
            estadoTiempo = .pausado
        }
    }
#endif
