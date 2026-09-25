#if DEBUG
    import Foundation

    /* El servidor de la demo (b-arquitectura §2.5.6 y §3.3, M2): un `URLProtocol` que responde con los
       MISMOS datos que `?demo=1` de la web (decisión 10). PROVISIONAL de I0 (fase 0.3b): delega en el
       `ServidorSimulado` rescatado de la 0.8.0 (otros datos, otro reloj) hasta que M2 escriba
       `DemoNucleo`, `SSEDemo` y la demo generada; entonces M2 borra `ServidorSimulado`. */

    struct OpcionesSimulado: Sendable {
        var sinEmparejar = false  // arranca en Emparejar
        var tiempoReal = false  // SSEDemo en vez de modo demo sin SSE
        var reloj: Date?  // ancla del reloj (T0 = 2026-09-24T19:00:00+02:00)
        var semilla: UInt64 = 1
    }

    enum ServidorDemo {
        static func entorno(opciones: OpcionesSimulado) -> Entorno {
            ServidorSimulado.entorno(emparejado: !opciones.sinEmparejar)
        }
    }
#endif
