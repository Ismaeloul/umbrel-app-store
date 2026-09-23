#if DEBUG
    import Foundation

    /// Servidor simulado para las pruebas de interfaz (XCUITest). Solo existe
    /// en Debug: la IPA (Release) no lo lleva.
    ///
    /// Se activa lanzando la app con `-AceNeoServidorSimulado`. Responde como
    /// un Ace Player Neo con el código `482913` y una agenda de hoy, sin red,
    /// sin Llavero y sin tocar lo guardado de verdad.
    enum ServidorSimulado {
        static let codigoValido = "482913"

        static func entorno() -> Entorno {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [ProtocoloSimulado.self]
            let suite = "es.ismaeloul.aceplayerneo.uitests"
            let configuracion = ServerConfigStore(suite: suite)
            configuracion.borrar()
            let cache = FileManager.default.temporaryDirectory
                .appendingPathComponent("AceNeoUITests-\(UUID().uuidString)", isDirectory: true)
            return Entorno(
                session: URLSession(configuration: config), tokens: MemoryTokenStore(),
                configuracion: configuracion, cache: DiskCache(directorio: cache))
        }

        /// Hoy en Madrid, `YYYY-MM-DD`.
        static var hoy: String {
            var calendario = Calendar(identifier: .gregorian)
            calendario.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
            let c = calendario.dateComponents([.year, .month, .day], from: .now)
            return String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
        }

        static func respuesta(a peticion: URLRequest) -> (Int, String, Data) {
            let ruta = peticion.url?.path() ?? ""
            let json = "application/json"
            switch ruta {
            case "/native/api/v1/ping":
                return (200, json, Data(ping.utf8))
            case "/native/api/v1/pairing/claim":
                let cuerpo = leerCuerpo(peticion)
                let codigo = (try? JSONDecoder().decode(PairingClaimBody.self, from: cuerpo))?.code
                guard codigo == codigoValido else {
                    return (401, json, Data(error("pairing_invalid", "El código no es correcto.").utf8))
                }
                return (201, json, Data(emparejado.utf8))
            case "/native/api/v1/bootstrap":
                return (200, json, Data(arranque.utf8))
            case "/native/api/v1/football":
                return (200, json, Data(agenda.replacingOccurrences(of: "HOY", with: hoy).utf8))
            case "/native/api/v1/events":
                return (200, "text/event-stream", Data(": ping\n\n".utf8))
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

        static let ping = #"{"ok":true,"app":"ace-player-neo","version":"0.7.0","apiVersion":1,"serverTime":1790188200000}"#

        static let dispositivo =
            #"{"id":"dev_simulado","name":"iPhone","platform":"ios","createdAt":"2026-09-23T18:30:00.000Z","lastSeenAt":null,"revokedAt":null}"#

        static let emparejado =
            #"{"deviceId":"dev_simulado","token":"dev_simulado.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","device":"#
            + dispositivo + "}"

        static let arranque: String = [
            #"{"version":"0.7.0","serverTime":1790188200000,"origin":"native","device":"#, dispositivo,
            #","preferences":{"onboardingComplete":true,"country":"Spain","leagues":[],"teams":[],"nationalities":[]},"#,
            #""library":{"web":[],"webSyncedAt":null,"webSources":[],"activeWebSourceId":"","favorites":[],"history":[]},"#,
            #""playback":{"nowPlaying":null,"learningCount":0,"serverTime":1790188200000,"sessions":[]},"#,
            #""engine":{"status":"online","online":true,"since":null,"checkedAt":null,"engineVersion":"3.2.3","autoRestarts":{"lastHour":0,"max":3,"nextAllowedAt":null,"exhausted":false}},"#,
            #""settings":{"sameChannelPolicy":"share"},"features":{"scanner":true,"ai":false,"demoSchedule":false}}"#,
        ].joined()

        static let agenda: String = [
            #"{"generatedAt":"2026-09-23T18:30:00.000Z","timezone":"Europe/Madrid","country":"Spain","source":"demo","attribution":"Datos de muestra","demo":true,"limited":false,"partial":false,"days":[{"date":"HOY","matches":["#,
            #"{"id":"sim-1","date":"HOY","time":"18:30","title":"Equipo Local - Equipo Visitante","home":"Equipo Local","away":"Equipo Visitante","competition":"LaLiga","country":"Spain","channels":[{"id":"m-laliga","name":"M+ LaLiga"}]},"#,
            #"{"id":"sim-2","date":"HOY","time":"21:00","title":"Otro Local - Otro Visitante","home":"Otro Local","away":"Otro Visitante","competition":"Champions League","country":"Europe","channels":[{"id":"m-lc","name":"M+ Liga de Campeones"}]}"#,
            "]}]}",
        ].joined()
    }

    /// `URLProtocol` que contesta con `ServidorSimulado` sin salir a la red.
    final class ProtocoloSimulado: URLProtocol {
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
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
