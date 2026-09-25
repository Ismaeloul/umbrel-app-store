#if DEBUG
    import AVFoundation
    import Foundation

    /// Motor de vídeo simulado para la demo y las pruebas de interfaz (el «motor» demo de la web,
    /// player/engines/demo.ts): sin red ni vídeo, a los 1,8 s «hay señal» (DEMO_SIGNAL_MS) y el cabezal avanza en
    /// tiempo real; si la URL trae `falla=1` (canal de muestra con «caíd» en el título) falla a los 1,8 s con «La
    /// señal de muestra no responde; buscando una alternativa». Las estadísticas inventadas cada 1,5 s las pone el
    /// reproductor. Solo existe en Debug.
    @MainActor
    final class MotorSimulado: MotorVideo {
        /// DEMO_SIGNAL_MS (player/constants.ts).
        static let senalTras: Duration = .milliseconds(1800)

        var alEvento: ((EventoMotor) -> Void)?
        private(set) var estadoTiempo: EstadoTiempo = .pausado
        var probableSinCortes: Bool { listo }
        private(set) var tiempoActual: Double = 0
        var ventana: VentanaDirecto? {
            listo ? VentanaDirecto(inicio: max(0, borde - 60), fin: borde) : nil
        }
        var colchonPorDelante: Double { listo ? 4 : 0 }
        var avPlayer: AVPlayer? { nil }
        private(set) var silenciado = false

        private var cargado = false
        private var listo = false
        private var borde: Double = 0
        private var reloj: Task<Void, Never>?
        private var primerFotogramaAvisado = false

        init() {}

        func cargar(url: URL, perfil: IosPlaybackProfile) {
            vaciar()
            cargado = true
            borde = 120
            tiempoActual = borde - perfil.liveEdgeOffsetS
            let falla = url.absoluteString.contains("falla=1")
            reloj = Task { [weak self] in
                try? await Task.sleep(for: Self.senalTras)
                guard let self, !Task.isCancelled else { return }
                if falla {
                    self.alEvento?(.fallo(TextosReproductor.demoNoResponde))
                    return
                }
                self.listo = true
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
            if !primerFotogramaAvisado {
                primerFotogramaAvisado = true
                alEvento?(.primerFotograma)
            }
        }

        func aplicar(perfil: IosPlaybackProfile) {}

        func reproducir() {
            guard listo, estadoTiempo != .reproduciendo else { return }
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
            listo = false
            primerFotogramaAvisado = false
            estadoTiempo = .pausado
        }

        func silenciar(_ silencio: Bool) { silenciado = silencio }
    }
#endif
