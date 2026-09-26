#if DEBUG
    import Foundation

    /* El tiempo real simulado (b-arquitectura §1.9, M2) para los flujos con `-AceNeoServidorSimulado`: un flujo
       `text/event-stream` como el del servidor (a7 §6.1: `retry: 3000`, `id`/`event`/`data`, latido `: ping`
       cada 15 s, reanuda con `Last-Event-ID`) que reparte lo que anota `EstadoDemo`: `state.changed` tras las
       mutaciones, `devices.changed` al canjear o revocar y `scan.progress` cuando el comprobador de muestra
       cambia de paso (con el SSE abierto la sesión de fuentes no sondea: a7 §10.3). */

    enum SSEDemo {
        /// Cada cuánto se mira si hay algo nuevo (el comprobador avanza cada 1 350 ms).
        static let vuelta = Duration.milliseconds(250)
        /// Latido del servidor (a7 §6.1).
        static let latido = 15.0

        /// Sin `Last-Event-ID`, una conexión nueva solo recibe lo que pase a partir de ahora (como el servidor).
        static func transmitir(_ envio: EnvioDemo, servidor: ServidorActivo, desde ultimo: Int?) -> Task<Void, Never> {
            Task {
                envio.cabecera(200, tipo: "text/event-stream")
                envio.datos(Data("retry: 3000\n\n".utf8))
                var enviado = ultimo ?? (servidor.estado.eventos(despuesDe: 0).last?.id ?? 0)
                var ultimoLatido = ContinuousClock.now
                while !Task.isCancelled {
                    let ahora = AgendaDemo.ms(servidor.reloj.ahora)
                    servidor.estado.revisarTrabajos(ahora: ahora)
                    for evento in servidor.estado.eventos(despuesDe: enviado) {
                        envio.datos(Data(evento.trama.utf8))
                        enviado = evento.id
                    }
                    if ContinuousClock.now - ultimoLatido >= .seconds(latido) {
                        envio.datos(Data(": ping\n\n".utf8))
                        ultimoLatido = ContinuousClock.now
                    }
                    try? await Task.sleep(for: vuelta)
                }
            }
        }
    }
#endif
