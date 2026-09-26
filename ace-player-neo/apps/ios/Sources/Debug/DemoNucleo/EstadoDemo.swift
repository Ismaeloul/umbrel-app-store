#if DEBUG
    import Foundation
    import Synchronization

    /* Lo que cambia mientras vive el proceso en la demo (a7 §13.1 punto 4; b-arquitectura §0.1: `final class`
       con `let` + `Mutex`, sin `@unchecked`): biblioteca, preferencias, ajustes y dispositivos (el
       `aceneo-demo-v2` de la web), los trabajos del comprobador y su contador (el `Map` de sources/demo-data.ts),
       el ancla de la agenda (fija por proceso), el azar sembrado y los eventos que el SSE simulado reparte. */

    /// Cómo se ha lanzado el servidor simulado.
    struct ModoDemo: Sendable, Hashable {
        /// `-AceNeoDemo` (como `?demo=1`): sin SSE, con las marcas de demo.
        var demo = true
        /// `-AceNeoServidor080`: 403 `origin_forbidden` en las cinco rutas de la 0.8.1 (a9 §2).
        var servidor080 = false
        /// `-AceNeoHistorialCapturas`: el historial que deja el recorrido de capturas (a7 §13.3).
        var historialCapturas = false
        /// `-AceNeoListaLarga`: 240 favoritos más, para medir el desplazamiento de Canales (UITest de rendimiento).
        var listaLarga = false
    }

    /// Un evento del tiempo real simulado (`id`, `event`, `data`).
    struct EventoDemo: Sendable, Hashable {
        var id: Int
        var tipo: String
        var datos: JSON

        /// La trama en el cable: `id: n\nevent: tipo\ndata: json\n\n`.
        var trama: String { "id: \(id)\nevent: \(tipo)\ndata: \(datos.cadena)\n\n" }
    }

    final class EstadoDemo: Sendable {
        struct Datos: Sendable {
            var biblioteca: JSON
            var preferencias: JSON
            var ajustes: JSON
            var dispositivos: [JSON]
            var trabajos: [String: FuentesDemo.Trabajo] = [:]
            var contadorTrabajos = 0
            var azar: AleatorioDemo
            var eventos: [EventoDemo] = []
            var siguienteEvento = 1
            /// Último `scan.progress` repartido por trabajo (para no repetirlo).
            var progresoRepartido: [String: String] = [:]
        }

        let modo: ModoDemo
        /// Ancla de la agenda de muestra: `floor(ahora / 5 min) × 5 min` al crear el estado (ms epoch).
        let ancla: Double
        private let datos: Mutex<Datos>

        init(modo: ModoDemo = ModoDemo(), ahora: Date, semilla: UInt64 = 1) {
            self.modo = modo
            ancla = AgendaDemo.ancla(ahora)
            var inicial = Datos(
                biblioteca: SemillasDemo.fixture("libraryGet"),
                preferencias: SemillasDemo.fixture("preferencesGet")["preferences"] ?? .nulo,
                ajustes: SemillasDemo.fixture("settingsGet")["settings"] ?? .nulo,
                dispositivos: SemillasDemo.fixture("devicesList")["devices"]?.lista ?? [],
                azar: AleatorioDemo(semilla: semilla))
            if modo.historialCapturas { EstadoDemo.precargarHistorial(&inicial, ahora: AgendaDemo.ms(ahora)) }
            if modo.listaLarga { EstadoDemo.precargarListaLarga(&inicial, ahora: AgendaDemo.ms(ahora)) }
            datos = Mutex(inicial)
        }

        /// Lee o cambia el estado bajo el candado (el cierre no debe tardar).
        func con<T: Sendable>(_ cuerpo: (inout Datos) -> T) -> T {
            datos.withLock { cuerpo(&$0) }
        }

        // MARK: Eventos del SSE simulado

        /// Anota un evento para el SSE simulado (se guardan los últimos 200, como el servidor).
        func emitir(_ tipo: String, _ datos: JSON) {
            con { d in
                d.eventos.append(EventoDemo(id: d.siguienteEvento, tipo: tipo, datos: datos))
                d.siguienteEvento += 1
                if d.eventos.count > 200 { d.eventos.removeFirst(d.eventos.count - 200) }
            }
        }

        /// Los eventos posteriores a `id`.
        func eventos(despuesDe id: Int) -> [EventoDemo] {
            con { d in d.eventos.filter { $0.id > id } }
        }

        /// `scan.progress` de los trabajos que han cambiado de paso (el comprobador de verdad los manda).
        func revisarTrabajos(ahora: Double) {
            let resumenes: [(id: String, datos: JSON, firma: String)] = con { d in
                var salida: [(id: String, datos: JSON, firma: String)] = []
                for (id, trabajo) in d.trabajos {
                    let job = FuentesDemo.comprobar(id: id, trabajo: trabajo, ahora: ahora)
                    let firma = ["status", "checked", "playable", "failed", "waiting"]
                        .map { job[$0]?.cadena ?? "" }.joined(separator: "|")
                    guard d.progresoRepartido[id] != firma else { continue }
                    d.progresoRepartido[id] = firma
                    var progreso = JSON.objeto([])
                    progreso["jobId"] = .texto(id)
                    progreso["kind"] = job["kind"] ?? "interactive"
                    for clave in ["status", "total", "checked", "playable", "failed", "waiting", "retryAt"] {
                        progreso[clave] = job[clave] ?? .nulo
                    }
                    progreso["matchId"] = .nulo
                    salida.append((id, progreso, firma))
                }
                return salida
            }
            for resumen in resumenes { emitir("scan.progress", resumen.datos) }
        }

        // MARK: Historial del recorrido de capturas

        /// HOY «DAZN 1» y «DAZN» (la fuente 1 del partido demo-1); ESTA SEMANA «Canal de prueba» (a7 §13.3).
        private static func precargarHistorial(_ d: inout Datos, ahora: Double) {
            let dazn1 = RutasDemo.elementoBiblioteca(
                id: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", titulo: "DAZN 1", categoria: nil, tipo: "recent", ahora: ahora)
            let dazn = RutasDemo.elementoBiblioteca(
                id: "0feeabf0888811b8dd55c807eef65f8d85fa4cce", titulo: "DAZN", categoria: nil, tipo: "recent",
                ahora: ahora - 1000)
            let previos = d.biblioteca["history"]?.lista ?? []
            d.biblioteca["history"] = .lista([dazn1, dazn] + previos)
        }

        /// 240 favoritos de más («Canal n --> NEW ERA», Deportes) detrás de los de la demo.
        private static func precargarListaLarga(_ d: inout Datos, ahora: Double) {
            var extra: [JSON] = []
            for n in 1...240 {
                let id = String(repeating: "0", count: 40 - String(n, radix: 16).count) + String(n, radix: 16)
                extra.append(RutasDemo.elementoBiblioteca(
                    id: id, titulo: "Canal \(n) --> NEW ERA", categoria: "Deportes", tipo: "fav", ahora: ahora - Double(n) * 1000))
            }
            let previos = d.biblioteca["favorites"]?.lista ?? []
            d.biblioteca["favorites"] = .lista(previos + extra)
        }
    }
#endif
