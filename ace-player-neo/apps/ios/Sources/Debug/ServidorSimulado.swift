#if DEBUG
    import Foundation
    import os

    /// Servidor simulado para las pruebas de interfaz (XCUITest). Solo existe
    /// en Debug: la IPA (Release) no lo lleva.
    ///
    /// Se activa lanzando la app con `-AceNeoServidorSimulado`. Responde como
    /// un Ace Player Neo con el código `482913`, una agenda de hoy, dos fuentes
    /// verificadas por partido y una biblioteca con un favorito, sin red, sin
    /// Llavero y sin tocar lo guardado de verdad. Con `-AceNeoEmparejado`
    /// arranca ya emparejada.
    enum ServidorSimulado {
        static let codigoValido = "482913"
        static let tokenSimulado = "dev_simulado.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

        static func entorno() -> Entorno {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [ProtocoloSimulado.self]
            let suite = "es.ismaeloul.aceplayerneo.uitests"
            let configuracion = ServerConfigStore(suite: suite)
            configuracion.borrar()
            let tokens = MemoryTokenStore()
            if ProcessInfo.processInfo.arguments.contains("-AceNeoEmparejado") {
                configuracion.guardar(ServerConfig(lan: URL(string: "http://umbrel.local:7792")))
                try? tokens.guardarToken(tokenSimulado)
            }
            estado.withLock { $0 = Estado() }
            let cache = FileManager.default.temporaryDirectory
                .appendingPathComponent("AceNeoUITests-\(UUID().uuidString)", isDirectory: true)
            return Entorno(
                session: URLSession(configuration: config), tokens: tokens,
                configuracion: configuracion, cache: DiskCache(directorio: cache))
        }

        /// Lo que cambia mientras dura la prueba (la biblioteca).
        struct Estado: Sendable {
            var favoritos: [String] = [ServidorSimulado.favoritoInicial]
        }

        static let estado = OSAllocatedUnfairLock(initialState: Estado())

        /// Hoy en Madrid, `YYYY-MM-DD`.
        static var hoy: String { dia(0) }

        /// Hoy más `masDias` en Madrid, `YYYY-MM-DD`.
        static func dia(_ masDias: Int) -> String {
            var calendario = Calendar(identifier: .gregorian)
            calendario.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
            let fecha = calendario.date(byAdding: .day, value: masDias, to: .now) ?? .now
            let c = calendario.dateComponents([.year, .month, .day], from: fecha)
            return String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
        }

        static func respuesta(a peticion: URLRequest) -> (Int, String, Data) {
            let ruta = peticion.url?.path() ?? ""
            let json = "application/json"
            let prefijo = "/native/api/v1/"
            guard ruta.hasPrefix(prefijo) else {
                return (404, json, Data(error("not_found", "Esa dirección no existe.").utf8))
            }
            let resto = String(ruta.dropFirst(prefijo.count))
            let metodo = peticion.httpMethod ?? "GET"
            switch (metodo, resto) {
            case ("GET", "ping"):
                return (200, json, Data(ping.utf8))
            case ("POST", "pairing/claim"):
                let cuerpo = leerCuerpo(peticion)
                let codigo = (try? JSONDecoder().decode(PairingClaimBody.self, from: cuerpo))?.code
                guard codigo == codigoValido else {
                    return (401, json, Data(error("pairing_invalid", "El código no es correcto.").utf8))
                }
                return (201, json, Data(emparejado.utf8))
            case ("GET", "bootstrap"):
                return (200, json, Data(arranque().utf8))
            case ("GET", "football"):
                let dias = agenda.replacingOccurrences(of: "HOY", with: hoy)
                    .replacingOccurrences(of: "MANANA", with: dia(1))
                    .replacingOccurrences(of: "PASADO", with: dia(2))
                return (200, json, Data(dias.utf8))
            case ("GET", "scores"):
                return (200, json, Data(marcadores.utf8))
            case ("GET", "events"):
                return (200, "text/event-stream", Data(": ping\n\n".utf8))
            case ("GET", "football/resolve"):
                return (200, json, Data(resolucion.utf8))
            case ("GET", _) where resto.hasPrefix("football/scans/"):
                return (200, json, Data(comprobacion.utf8))
            case ("GET", _) where resto.hasPrefix("channels/"):
                return (200, json, Data(concesion.utf8))
            case ("POST", _) where resto.hasSuffix("/heartbeat"):
                return (200, json, Data(latido.utf8))
            case ("POST", _) where resto.hasSuffix("/release"):
                return (200, json, Data(#"{"released":true,"sessionClosed":true}"#.utf8))
            case ("POST", "sources/outcome"):
                return (200, json, Data("{}".utf8))
            case ("POST", "diagnostics"):
                return (201, json, Data(#"{"accepted":true,"id":"diag-simulado"}"#.utf8))
            case ("GET", "library"):
                return (200, json, Data(biblioteca().utf8))
            case ("POST", "library"):
                mutarBiblioteca(leerCuerpo(peticion))
                return (200, json, Data(biblioteca().utf8))
            case ("GET", "search"):
                return (200, json, Data(busqueda.utf8))
            case ("GET", "preferences"):
                return (200, json, Data(preferencias.utf8))
            case ("PUT", "preferences"):
                return (200, json, Data(preferencias.utf8))
            case ("GET", "engine/status"):
                return (200, json, Data(motor.utf8))
            case ("POST", "engine/restart"):
                return (202, json, Data(#"{"restarted":true}"#.utf8))
            default:
                return (404, json, Data(error("not_found", "Esa dirección no existe.").utf8))
            }
        }

        static func leerCuerpo(_ peticion: URLRequest) -> Data {
            if let cuerpo = peticion.httpBody { return cuerpo }
            guard let flujo = peticion.httpBodyStream else { return Data() }
            flujo.open()
            defer { flujo.close() }
            var datos = Data()
            var bufer = [UInt8](repeating: 0, count: 4096)
            while flujo.hasBytesAvailable {
                let leidos = flujo.read(&bufer, maxLength: bufer.count)
                if leidos <= 0 { break }
                datos.append(bufer, count: leidos)
            }
            return datos
        }

        static func error(_ codigo: String, _ mensaje: String) -> String {
            #"{"error":{"code":"\#(codigo)","message":"\#(mensaje)","requestId":"req-simulado"}}"#
        }

        // MARK: Biblioteca en memoria

        static let favoritoInicial = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"

        private static func mutarBiblioteca(_ cuerpo: Data) {
            guard let objeto = try? JSONSerialization.jsonObject(with: cuerpo) as? [String: Any],
                let accion = objeto["action"] as? String
            else { return }
            // Solo textos dentro del candado (el cierre es @Sendable).
            let coleccion = objeto["collection"] as? String
            let id = objeto["id"] as? String
            let idNuevo = (objeto["item"] as? [String: Any])?["id"] as? String
            estado.withLock { estado in
                switch accion {
                case "delete":
                    if coleccion == "favorites", let id { estado.favoritos.removeAll { $0 == id } }
                case "favorite-upsert":
                    if let idNuevo, !estado.favoritos.contains(idNuevo) { estado.favoritos.insert(idNuevo, at: 0) }
                default:
                    break
                }
            }
        }

        static func biblioteca() -> String {
            let favoritos = estado.withLock { $0.favoritos }
            let items = favoritos.map { id -> String in
                let titulo = id == favoritoInicial ? "Canal Favorito" : "Canal " + String(id.prefix(4))
                return #"{"id":"\#(id)","title":"\#(titulo)","type":"fav","category":"","date":"2026-09-23T18:30:00.000Z","fromWebSync":false,"ih":false}"#
            }
            return [
                #"{"web":[{"id":"b2c3d4e5f60718293a4b5c6d7e8f901234567890","title":"M+ LaLiga","type":"web","category":"Deportes","date":"2026-09-23T18:30:00.000Z","fromWebSync":true,"ih":false}],"#,
                #""webSyncedAt":"2026-09-23T18:30:00.000Z","webSources":[{"id":"principal","name":"Principal","url":"https://example.com/lista.m3u","type":"m3u","count":1,"syncedAt":"2026-09-23T18:30:00.000Z","lastErrorAt":null,"lastError":null}],"#,
                #""activeWebSourceId":"principal","favorites":["#, items.joined(separator: ","), "],",
                #""history":[{"id":"c3d4e5f60718293a4b5c6d7e8f9012345678901a","title":"Canal Reciente","type":"recent","category":"","date":"2026-09-23T18:30:00.000Z","fromWebSync":false,"ih":false}]}"#,
            ].joined()
        }

        // MARK: Respuestas fijas

        static let ping = #"{"ok":true,"app":"ace-player-neo","version":"0.7.0","apiVersion":1,"serverTime":1790188200000}"#

        static let dispositivo =
            #"{"id":"dev_simulado","name":"iPhone","platform":"ios","createdAt":"2026-09-23T18:30:00.000Z","lastSeenAt":null,"revokedAt":null}"#

        static let emparejado =
            #"{"deviceId":"dev_simulado","token":"\#(tokenSimulado)","device":"#
            + dispositivo + "}"

        static let motor =
            #"{"status":"online","online":true,"since":null,"checkedAt":null,"engineVersion":"3.2.3","autoRestarts":{"lastHour":0,"max":3,"nextAllowedAt":null,"exhausted":false}}"#

        static func arranque() -> String {
            [
                #"{"version":"0.7.0","serverTime":1790188200000,"origin":"native","device":"#, dispositivo,
                #","preferences":{"onboardingComplete":true,"country":"Spain","leagues":[],"teams":[],"nationalities":[]},"#,
                #""library":"#, biblioteca(), ",",
                #""playback":{"nowPlaying":null,"learningCount":0,"serverTime":1790188200000,"sessions":[]},"#,
                #""engine":"#, motor, ",",
                #""settings":{"sameChannelPolicy":"share"},"features":{"scanner":true,"ai":false,"demoSchedule":false}}"#,
            ].joined()
        }

        static let agenda: String = [
            #"{"generatedAt":"2026-09-23T18:30:00.000Z","timezone":"Europe/Madrid","country":"Spain","source":"demo","attribution":"Datos de muestra","demo":true,"limited":false,"partial":false,"days":[{"date":"HOY","matches":["#,
            #"{"id":"sim-1","date":"HOY","time":"18:30","title":"Equipo Local - Equipo Visitante","home":"Equipo Local","away":"Equipo Visitante","competition":"LaLiga","country":"Spain","channels":[{"id":"m-laliga","name":"M+ LaLiga"}]},"#,
            #"{"id":"sim-2","date":"HOY","time":"21:00","title":"Otro Local - Otro Visitante","home":"Otro Local","away":"Otro Visitante","competition":"Champions League","country":"Europe","channels":[{"id":"m-lc","name":"M+ Liga de Campeones"}]},"#,
            // Unos cuantos más hoy: la lista tiene que desplazarse, como con la agenda real.
            #"{"id":"sim-5","date":"HOY","time":"19:00","title":"Tercer Local - Tercer Visitante","home":"Tercer Local","away":"Tercer Visitante","competition":"LaLiga","country":"Spain","channels":[{"id":"m-laliga","name":"M+ LaLiga"}]},"#,
            #"{"id":"sim-6","date":"HOY","time":"20:00","title":"Cuarto Local - Cuarto Visitante","home":"Cuarto Local","away":"Cuarto Visitante","competition":"Premier League","country":"England","channels":[{"id":"dazn","name":"DAZN"}]},"#,
            #"{"id":"sim-7","date":"HOY","time":"22:00","title":"Quinto Local - Quinto Visitante","home":"Quinto Local","away":"Quinto Visitante","competition":"Amistoso","country":"Spain","channels":[{"id":"la1","name":"La 1 HD"}]}"#,
            "]},",
            // Más días (como la agenda real): la tira de días tiene varios.
            #"{"date":"MANANA","matches":[{"id":"sim-3","date":"MANANA","time":"20:00","title":"Local Mañana - Visitante Mañana","home":"Local Mañana","away":"Visitante Mañana","competition":"LaLiga","country":"Spain","channels":[{"id":"m-laliga","name":"M+ LaLiga"}]}]},"#,
            #"{"date":"PASADO","matches":[{"id":"sim-4","date":"PASADO","time":"21:00","title":"Local Pasado - Visitante Pasado","home":"Local Pasado","away":"Visitante Pasado","competition":"Premier League","country":"England","channels":[{"id":"dazn","name":"DAZN"}]}]}"#,
            "]}",
        ].joined()

        static let marcadores =
            #"{"available":true,"generatedAt":"2026-09-23T18:30:00.000Z","source":"espn","attribution":"ESPN","leagues":1,"scores":{"sim-1":{"home":1,"away":0,"state":"in","clock":"54'","detail":"2ª parte","confidence":0.92}}}"#

        private static func candidato(_ id: String, _ titulo: String, puntos: Int) -> String {
            #"{"id":"\#(id)","title":"\#(titulo)","alias":null,"ih":false,"source":"m3u","score":\#(puntos),"matchedChannel":"M+ LaLiga","soloFamilia":false,"familyFallbackAllowed":false,"listaId":"principal","availability":null,"bitrate":null,"learned":null,"reported":null,"rejectedByLearning":false,"quarantined":false}"#
        }

        static let fuenteA = "b2c3d4e5f60718293a4b5c6d7e8f901234567890"
        static let fuenteB = "c3d4e5f60718293a4b5c6d7e8f9012345678901a"

        static var resolucion: String {
            let a = candidato(fuenteA, "M+ LaLiga FHD --> Elcano", puntos: 100)
            let b = candidato(fuenteB, "M+ LaLiga HD --> Nueva Era", puntos: 90)
            return [
                #"{"status":"found","channels":["M+ LaLiga"],"checked":["m3u"],"candidate":"#, a,
                #","candidates":["#, a, ",", b,
                #"],"engineAvailable":true,"ai":{"enabled":false,"used":false,"model":null,"catalogSize":0,"error":null},"program":null,"research":false,"preheat":null,"#,
                #""scan":{"id":"0123456789abcdef01234567","statusUrl":"/api/v1/football/scans/0123456789abcdef01234567","total":2,"initialCount":2}}"#,
            ].joined()
        }

        private static func sonda(_ id: String, _ estado: String) -> String {
            #"{"id":"\#(id)","state":"\#(estado)","checkedAt":"2026-09-23T18:30:00.000Z","retryAt":null,"durationMs":9000,"bytes":262144,"peers":12,"speedDown":850,"rateKbps":4200,"intakeKbps":4400,"streamKbps":4000,"reason":"playable_media","mediaValid":true,"browserCompatible":true,"videoCodec":"h264","audioCodecs":["aac"],"cached":false,"attempts":1,"playableOn":{"web":true,"ios":true}}"#
        }

        static var comprobacion: String {
            [
                #"{"id":"0123456789abcdef01234567","kind":"interactive","status":"complete","createdAt":"2026-09-23T18:30:00.000Z","updatedAt":"2026-09-23T18:30:00.000Z","total":2,"checked":2,"playable":2,"failed":0,"waiting":0,"retryAt":null,"initialCount":2,"candidates":["#,
                sonda(fuenteA, "working"), ",", sonda(fuenteB, "weak"), "]}",
            ].joined()
        }

        static let concesion =
            #"{"session":{"id":"s_simulada","heartbeatMs":15000,"expiresAfterMs":45000},"url":"/native/api/v1/video/s_simulada/index.m3u8?t=simulado","protocol":"hls-fmp4","remux":true,"codec":{"video":"h264","audio":"aac","source":"ffprobe"},"latency":{"mode":"balanced","initialBufferS":6,"rebuildS":8,"liveSync":null,"ios":{"preferredForwardBufferDuration":8,"liveEdgeOffsetS":8}},"stats":{"via":"sse"},"handoff":false}"#

        static let latido =
            #"{"session":{"id":"s_simulada","heartbeatMs":15000,"expiresAfterMs":45000},"url":"/native/api/v1/video/s_simulada/index.m3u8?t=otro","protocol":"hls-fmp4","viewers":1}"#

        static let busqueda =
            #"{"query":"dazn","results":[{"id":"d4e5f60718293a4b5c6d7e8f9012345678901a2b","title":"DAZN 1 HD","category":"Deportes","availability":0.9,"bitrate":450000,"ih":true}]}"#

        static let preferencias =
            #"{"preferences":{"onboardingComplete":true,"country":"Spain","leagues":["LaLiga"],"teams":["Real Madrid"],"nationalities":["España"]}}"#
    }

    /// `URLProtocol` que contesta con `ServidorSimulado` sin salir a la red.
    final class ProtocoloSimulado: URLProtocol {
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            // La agenda llega con algo de retraso, como por la red de verdad: la
            // pantalla se pinta antes (carga) y la lista después.
            if request.url?.path().hasSuffix("/football") == true { Thread.sleep(forTimeInterval: 0.6) }
            let (estado, tipo, datos) = ServidorSimulado.respuesta(a: request)
            guard let url = request.url,
                let respuesta = HTTPURLResponse(
                    url: url, statusCode: estado, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": tipo])
            else {
                client?.urlProtocol(self, didFailWithError: URLError(.badURL))
                return
            }
            client?.urlProtocol(self, didReceive: respuesta, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: datos)
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }
#endif
