#if DEBUG
    import Foundation
    import os

    /// Servidor simulado para las pruebas de interfaz (XCUITest). Solo existe
    /// en Debug: la IPA (Release) no lo lleva.
    ///
    /// Lo usa `ServidorDemo` (provisional de la fase 0.3b) con `-AceNeoDemo` o
    /// `-AceNeoServidorSimulado`. Responde como un Ace Player Neo con el código
    /// `482913`, una agenda de hoy, dos fuentes verificadas por partido y una
    /// biblioteca con un favorito, sin red, sin Llavero y sin tocar lo guardado de
    /// verdad. M2 lo borra cuando `ServidorDemo` sirva la demo de la web.
    enum ServidorSimulado {
        static let codigoValido = "482913"
        static let tokenSimulado = "dev_simulado.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

        /// - Parameter emparejado: arranca ya emparejada (token y dirección de casa). Desde la fase 0.3b lo
        ///   decide `ServidorDemo` (sin `-AceNeoSinEmparejar`); antes era `-AceNeoEmparejado`.
        static func entorno(emparejado: Bool) -> Entorno {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [ProtocoloSimulado.self]
            let suite = "es.ismaeloul.aceplayerneo.uitests"
            let configuracion = ServerConfigStore(suite: suite)
            configuracion.borrar()
            let tokens = MemoryTokenStore()
            if emparejado {
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

        /// Lo que cambia mientras dura la prueba (biblioteca, gustos y lo que suena).
        struct Estado: Sendable {
            var favoritos: [String] = [ServidorSimulado.favoritoInicial, ServidorSimulado.canalDaznLaLiga]
            var ligas: [String] = ["LaLiga"]
            var equipos: [String] = ["Real Madrid"]
            var nacionalidades: [String] = ["España"]
            var personalizada = true
            /// Canal que suena en este iPhone (entre `stream` y `release`).
            var sonando: String?
            var sonandoTitulo = ""
            /// Listas guardadas (Ajustes → Listas) y la activa.
            var listas: [ListaSimulada] = [
                ListaSimulada(id: "principal", nombre: "Lista de Isma", url: "https://example.com/lista.m3u"),
                ListaSimulada(id: "respaldo", nombre: "Respaldo", url: "https://example.com/respaldo.m3u"),
            ]
            var listaActiva = "principal"
        }

        struct ListaSimulada: Sendable {
            var id: String
            var nombre: String
            var url: String
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
                // Lo que vería la app por SSE: «Dónde se está reproduciendo» al
                // conectar (y cada 5 s, al reconectar) y el latido.
                let trama = "retry: 5000\nid: 1\nevent: playback.sessions\ndata: {\"sessions\":\(sesiones())}\n\n: ping\n\n"
                return (200, "text/event-stream", Data(trama.utf8))
            case ("GET", "playback"):
                return (200, json, Data(estadoReproduccion().utf8))
            case ("GET", "football/resolve"):
                return (200, json, Data(resolucion.utf8))
            case ("GET", _) where resto.hasPrefix("football/scans/"):
                return (200, json, Data(comprobacion.utf8))
            case ("GET", _) where resto.hasPrefix("football/teams/") || resto.hasPrefix("football/competitions/"):
                // Escudos y logos: un PNG pequeño generado en código (un círculo del color del club).
                return (200, "image/png", pngEscudo(resto))
            case ("GET", _) where resto.hasPrefix("channels/"):
                let partes = resto.split(separator: "/")
                let id = partes.count > 1 ? String(partes[1]) : ""
                let titulo =
                    peticion.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?
                    .queryItems?.first { $0.name == "title" }?.value ?? ""
                estado.withLock { estado in
                    estado.sonando = id
                    estado.sonandoTitulo = titulo
                }
                return (200, json, Data(concesion.utf8))
            case ("POST", _) where resto.hasSuffix("/heartbeat"):
                return (200, json, Data(latido.utf8))
            case ("POST", _) where resto.hasSuffix("/release"):
                estado.withLock { $0.sonando = nil }
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
            case ("POST", _) where resto.hasPrefix("directories/"), ("DELETE", _) where resto.hasPrefix("directories/"):
                mutarListas(metodo, resto, leerCuerpo(peticion))
                return (200, json, Data(directorio().utf8))
            case ("GET", "directories"):
                return (200, json, Data(directorio().utf8))
            case ("GET", "search"):
                return (200, json, Data(busqueda.utf8))
            case ("GET", "preferences"):
                return (200, json, Data(#"{"preferences":\#(preferencias())}"#.utf8))
            case ("PUT", "preferences"):
                guardarPreferencias(leerCuerpo(peticion))
                return (200, json, Data(#"{"preferences":\#(preferencias())}"#.utf8))
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

        // MARK: Escudos

        /// Un PNG de 48 × 48 con un círculo del color del club (por su id en la ruta).
        static func pngEscudo(_ ruta: String) -> Data {
            let partes = ruta.split(separator: "/").map(String.init)
            let id = partes.count > 2 ? partes[2].lowercased() : "x"
            let color: (UInt8, UInt8, UInt8)
            if id.contains("madrid") {
                color = (255, 255, 255)
            } else if id.contains("getafe") {
                color = (0, 89, 153)
            } else if id.contains("villarreal") {
                color = (255, 230, 103)
            } else if id.contains("sociedad") {
                color = (0, 103, 177)
            } else if partes.contains("competitions") {
                color = (255, 214, 10)
            } else {
                let h = id.utf8.reduce(UInt32(2_166_136_261)) { ($0 ^ UInt32($1)) &* 16_777_619 }
                color = (
                    UInt8(truncatingIfNeeded: h) | 0x40, UInt8(truncatingIfNeeded: h >> 8) | 0x40,
                    UInt8(truncatingIfNeeded: h >> 16) | 0x40
                )
            }
            return PNGSimulado.circulo(lado: 48, color: color)
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

        /// Un «DAZN LaLiga FHD» de la lista que también es favorito (emite a las 22:00 en la agenda).
        static let canalDaznLaLiga = "d2d2d2d2e5f60718293a4b5c6d7e8f9012345678"

        /// Texto JSON (con sus comillas y escapes).
        static func texto(_ valor: String) -> String {
            guard let datos = try? JSONEncoder().encode(valor) else { return "\"\"" }
            return String(decoding: datos, as: UTF8.self)
        }

        static func itemJSON(
            _ id: String, _ titulo: String, tipo: String, categoria: String = "", fecha: Date = .now, lista: Bool = false,
            ih: Bool = false
        ) -> String {
            #"{"id":"\#(id)","title":\#(texto(titulo)),"type":"\#(tipo)","category":\#(texto(categoria)),"date":"\#(FechaISO.texto(fecha))","fromWebSync":\#(lista),"ih":\#(ih)}"#
        }

        /// La lista activa: ocho canales en tres categorías (como la de Isma, agrupada en la app).
        static let canalesLista: [(String, String, String)] = [
            ("b2c3d4e5f60718293a4b5c6d7e8f901234567890", "M+ LaLiga", "Deportes"),
            ("d1d1d1d1e5f60718293a4b5c6d7e8f9012345678", "DAZN 1 FHD --> NEW ERA", "Deportes"),
            (canalDaznLaLiga, "DAZN LaLiga FHD", "Deportes"),
            ("e1e1e1e1e5f60718293a4b5c6d7e8f9012345678", "Eurosport 1 HD", "Deportes"),
            ("f1f1f1f1e5f60718293a4b5c6d7e8f9012345678", "M+ Liga de Campeones 1080p", "Deportes"),
            ("a1a1a1a1e5f60718293a4b5c6d7e8f9012345678", "La 1 HD", "Generalistas"),
            ("a3a3a3a3e5f60718293a4b5c6d7e8f9012345678", "Antena 3 HD", "Generalistas"),
            ("c1c1c1c1e5f60718293a4b5c6d7e8f9012345678", "Clan TVE", "Infantil"),
        ]

        static func biblioteca() -> String {
            let favoritos = estado.withLock { $0.favoritos }
            let items = favoritos.map { id -> String in
                if id == favoritoInicial { return itemJSON(id, "Canal Favorito", tipo: "fav") }
                if let deLista = canalesLista.first(where: { $0.0 == id }) {
                    return itemJSON(id, deLista.1, tipo: "fav", categoria: deLista.2, lista: true)
                }
                return itemJSON(id, "Canal " + String(id.prefix(4)), tipo: "fav")
            }
            let web = canalesLista.map { itemJSON($0.0, $0.1, tipo: "web", categoria: $0.2, lista: true) }
            let dia: TimeInterval = 86_400
            let recientes = [
                itemJSON("c3d4e5f60718293a4b5c6d7e8f9012345678901a", "Canal Reciente", tipo: "recent"),
                itemJSON(
                    "b0b0b0b0e5f60718293a4b5c6d7e8f9012345678", "BOING", tipo: "recent", fecha: .now.addingTimeInterval(-dia),
                    ih: true),
                itemJSON(
                    "a3a3a3a3e5f60718293a4b5c6d7e8f9012345678", "Antena 3 HD", tipo: "recent", categoria: "Generalistas",
                    fecha: .now.addingTimeInterval(-4 * dia)),
            ]
            return "{" + directorioCampos(web: web) + #","favorites":["# + items.joined(separator: ",") + "],"
                + #""history":["# + recientes.joined(separator: ",") + "]}"
        }

        /// Los campos de `DirectoryView` (sin llaves): canales de la activa, listas y la activa.
        static func directorioCampos(web: [String]? = nil) -> String {
            let (listas, activa) = estado.withLock { ($0.listas, $0.listaActiva) }
            let canales = web ?? canalesLista.map { itemJSON($0.0, $0.1, tipo: "web", categoria: $0.2, lista: true) }
            let sincronizada = FechaISO.texto(.now.addingTimeInterval(-3600))
            let fuentes = listas.map { lista -> String in
                let cuenta = lista.id == "principal" ? canalesLista.count : 3
                return #"{"id":"\#(lista.id)","name":\#(texto(lista.nombre)),"url":\#(texto(lista.url)),"type":"m3u","count":\#(cuenta),"syncedAt":"\#(sincronizada)","lastErrorAt":null,"lastError":null}"#
            }
            return #""web":["# + canales.joined(separator: ",") + #"],"webSyncedAt":"\#(sincronizada)","webSources":["#
                + fuentes.joined(separator: ",") + #"],"activeWebSourceId":"\#(activa)""#
        }

        static func directorio() -> String { "{" + directorioCampos() + "}" }

        /// Activar, borrar y guardar listas (Ajustes → Listas).
        private static func mutarListas(_ metodo: String, _ resto: String, _ cuerpo: Data) {
            let partes = resto.split(separator: "/").map(String.init)
            let entrada = try? JSONDecoder().decode(DirectorySyncBody.self, from: cuerpo)
            let nombre = entrada?.name
            let url = entrada?.url
            let nueva = entrada != nil && entrada?.sourceId == nil
            estado.withLock { estado in
                if metodo == "POST", partes.count == 3, partes[2] == "activate" {
                    estado.listaActiva = partes[1]
                } else if metodo == "DELETE", partes.count == 2, estado.listas.count > 1 {
                    estado.listas.removeAll { $0.id == partes[1] }
                    if estado.listaActiva == partes[1] { estado.listaActiva = estado.listas.first?.id ?? "principal" }
                } else if metodo == "POST", resto == "directories/sync", nueva, let url {
                    let id = "lista-\(estado.listas.count + 1)"
                    estado.listas.append(ListaSimulada(id: id, nombre: nombre ?? "Lista nueva", url: url))
                    estado.listaActiva = id
                }
            }
        }

        // MARK: Gustos

        static func preferencias() -> String {
            let (ligas, equipos, nacionalidades, hecho) = estado.withLock {
                ($0.ligas, $0.equipos, $0.nacionalidades, $0.personalizada)
            }
            let lista: ([String]) -> String = { "[" + $0.map(texto).joined(separator: ",") + "]" }
            return #"{"onboardingComplete":\#(hecho),"country":"Spain","leagues":\#(lista(ligas)),"teams":\#(lista(equipos)),"nationalities":\#(lista(nacionalidades))}"#
        }

        private static func guardarPreferencias(_ cuerpo: Data) {
            guard let entrada = try? JSONDecoder().decode(PreferencesInput.self, from: cuerpo) else { return }
            estado.withLock { estado in
                if let ligas = entrada.leagues { estado.ligas = ligas }
                if let equipos = entrada.teams { estado.equipos = equipos }
                if let nacionalidades = entrada.nationalities { estado.nacionalidades = nacionalidades }
                if let hecho = entrada.onboardingComplete { estado.personalizada = hecho }
            }
        }

        // MARK: Dónde se está reproduciendo

        /// Un ordenador que ve DAZN 1 y, si suena algo en este iPhone, su sesión.
        static func sesiones() -> String {
            let (sonando, titulo) = estado.withLock { ($0.sonando, $0.sonandoTitulo) }
            let ahora = FechaISO.texto(.now)
            let desde = FechaISO.texto(.now.addingTimeInterval(-25 * 60))
            var lista = [
                #"{"id":"s_salon","hash":"d1d1d1d1e5f60718293a4b5c6d7e8f9012345678","mode":"hls","openedAt":"\#(desde)","title":"DAZN 1 FHD","protocol":"hls","viewers":[{"client":"web","deviceId":"web_salon","lastBeatAt":"\#(ahora)","viewerId":"web_v1","deviceName":"Chrome · Windows","platform":"web","playing":true}]}"#
            ]
            if let sonando, !sonando.isEmpty {
                lista.insert(
                    #"{"id":"s_simulada","hash":"\#(sonando)","mode":"hls","openedAt":"\#(ahora)","title":\#(texto(titulo)),"protocol":"hls-fmp4","viewers":[{"client":"ios","deviceId":"dev_simulado","lastBeatAt":"\#(ahora)","deviceName":"iPhone de pruebas","platform":"ios","playing":true}]}"#,
                    at: 0)
            }
            return "[" + lista.joined(separator: ",") + "]"
        }

        static func estadoReproduccion() -> String {
            #"{"nowPlaying":null,"learningCount":0,"serverTime":1790188200000,"sessions":\#(sesiones())}"#
        }

        // MARK: Respuestas fijas

        static let ping = #"{"ok":true,"app":"ace-player-neo","version":"0.8.0","apiVersion":1,"serverTime":1790188200000}"#

        static let dispositivo =
            #"{"id":"dev_simulado","name":"iPhone","platform":"ios","createdAt":"2026-09-23T18:30:00.000Z","lastSeenAt":null,"revokedAt":null}"#

        static let emparejado =
            #"{"deviceId":"dev_simulado","token":"\#(tokenSimulado)","device":"#
            + dispositivo + "}"

        static let motor =
            #"{"status":"online","online":true,"since":null,"checkedAt":null,"engineVersion":"3.2.3","autoRestarts":{"lastHour":0,"max":3,"nextAllowedAt":null,"exhausted":false}}"#

        static func arranque() -> String {
            [
                #"{"version":"0.8.0","serverTime":1790188200000,"origin":"native","device":"#, dispositivo,
                #","preferences":"#, preferencias(), ",",
                #""library":"#, biblioteca(), ",",
                #""playback":"#, estadoReproduccion(), ",",
                #""engine":"#, motor, ",",
                #""settings":{"sameChannelPolicy":"share"},"features":{"scanner":true,"ai":false,"demoSchedule":false}}"#,
            ].joined()
        }

        static let agenda: String = [
            #"{"generatedAt":"2026-09-23T18:30:00.000Z","timezone":"Europe/Madrid","country":"Spain","source":"demo","attribution":"Datos de muestra","demo":true,"limited":false,"partial":false,"days":[{"date":"HOY","matches":["#,
            // Con escudos y colores (el módulo `teams` del backend): el escudo lo sirve `football/teams/<id>/crest`.
            ##"{"id":"sim-1","date":"HOY","time":"18:30","title":"Equipo Local - Equipo Visitante","home":"Equipo Local","away":"Equipo Visitante","competition":"LaLiga","country":"Spain","channels":[{"id":"m-laliga","name":"M+ LaLiga"}],"homeTeam":{"id":"133738","name":"Equipo Local","short":"LOC","crest":"/api/v1/football/teams/133738/crest?v=sim","colors":{"primary":"#1d3f9a","secondary":"#f2c94c"}},"awayTeam":{"id":"k-equipo-visitante","name":"Equipo Visitante","short":null,"crest":null,"colors":{"primary":"#a50044","secondary":null}},"competitionBadge":{"id":"4335","name":"Spanish La Liga","logo":"/api/v1/football/competitions/4335/logo?v=sim"}},"##,
            #"{"id":"sim-2","date":"HOY","time":"21:00","title":"Otro Local - Otro Visitante","home":"Otro Local","away":"Otro Visitante","competition":"Champions League","country":"Europe","channels":[{"id":"m-lc","name":"M+ Liga de Campeones"}]},"#,
            // Unos cuantos más hoy: la lista tiene que desplazarse, como con la agenda real.
            #"{"id":"sim-5","date":"HOY","time":"19:00","title":"Tercer Local - Tercer Visitante","home":"Tercer Local","away":"Tercer Visitante","competition":"LaLiga","country":"Spain","channels":[{"id":"m-laliga","name":"M+ LaLiga"}]},"#,
            #"{"id":"sim-6","date":"HOY","time":"20:00","title":"Cuarto Local - Cuarto Visitante","home":"Cuarto Local","away":"Cuarto Visitante","competition":"Premier League","country":"England","channels":[{"id":"dazn","name":"DAZN"}]},"#,
            #"{"id":"sim-7","date":"HOY","time":"22:00","title":"Quinto Local - Quinto Visitante","home":"Quinto Local","away":"Quinto Visitante","competition":"Amistoso","country":"Spain","channels":[{"id":"la1","name":"La 1 HD"}]},"#,
            // «Tu equipo» (sale en «Para ti» por el equipo aunque la copa no esté elegida)…
            ##"{"id":"sim-8","date":"HOY","time":"21:30","title":"Real Madrid - Getafe","home":"Real Madrid","away":"Getafe","competition":"Copa del Rey","country":"Spain","channels":[{"id":"vamos","name":"M+ Vamos"}],"homeTeam":{"id":"real-madrid","name":"Real Madrid","short":"RMA","crest":"/api/v1/football/teams/real-madrid/crest?v=sim","colors":{"primary":"#ffffff","secondary":"#febe10"}},"awayTeam":{"id":"getafe","name":"Getafe","short":"GET","crest":"/api/v1/football/teams/getafe/crest?v=sim","colors":{"primary":"#005999","secondary":null}}},"##,
            // …un LaLiga que da un canal de la biblioteca (favorito: «A las 22:00, …»)…
            ##"{"id":"sim-10","date":"HOY","time":"22:00","title":"Villarreal - Real Sociedad","home":"Villarreal","away":"Real Sociedad","competition":"LaLiga","country":"Spain","channels":[{"id":"dazn-laliga","name":"DAZN LaLiga"}],"homeTeam":{"id":"villarreal","name":"Villarreal","short":"VIL","crest":"/api/v1/football/teams/villarreal/crest?v=sim","colors":{"primary":"#ffe667","secondary":"#005187"}},"awayTeam":{"id":"real-sociedad","name":"Real Sociedad","short":"RSO","crest":"/api/v1/football/teams/real-sociedad/crest?v=sim","colors":{"primary":"#0067b1","secondary":"#ffffff"}}},"##,
            // …y las reservas argentinas que Isma veía primero: fuera de «Para ti».
            #"{"id":"sim-9","date":"HOY","time":"20:00","title":"Central Córdoba Reserva - Atlético Tucumán Reserva","home":"Central Córdoba Reserva","away":"Atlético Tucumán Reserva","competition":"Torneo Proyección","country":"Argentina","channels":[{"id":"lpf","name":"LPF Play"}]}"#,
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
    }

    /// PNG sin dependencias para los escudos simulados: RGBA de 8 bits con
    /// zlib «almacenado» (sin comprimir) y sus CRC.
    enum PNGSimulado {
        static func circulo(lado: Int, color: (UInt8, UInt8, UInt8)) -> Data {
            var crudo = Data()
            crudo.reserveCapacity(lado * (lado * 4 + 1))
            let centro = Double(lado - 1) / 2
            let radio = Double(lado) / 2 - 1
            for y in 0..<lado {
                crudo.append(0)  // filtro «ninguno» de la fila
                for x in 0..<lado {
                    let dx = Double(x) - centro
                    let dy = Double(y) - centro
                    let distancia = (dx * dx + dy * dy).squareRoot()
                    if distancia <= radio {
                        if distancia > radio - 3 {
                            crudo.append(contentsOf: [40, 40, 40, 255])
                        } else {
                            crudo.append(contentsOf: [color.0, color.1, color.2, 255])
                        }
                    } else {
                        crudo.append(contentsOf: [0, 0, 0, 0])
                    }
                }
            }
            var png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
            var ihdr = Data()
            ihdr.append(be32(UInt32(lado)))
            ihdr.append(be32(UInt32(lado)))
            ihdr.append(contentsOf: [8, 6, 0, 0, 0])
            png.append(trozo("IHDR", ihdr))
            png.append(trozo("IDAT", zlibAlmacenado(crudo)))
            png.append(trozo("IEND", Data()))
            return png
        }

        private static func be32(_ valor: UInt32) -> Data {
            Data([
                UInt8(truncatingIfNeeded: valor >> 24), UInt8(truncatingIfNeeded: valor >> 16),
                UInt8(truncatingIfNeeded: valor >> 8), UInt8(truncatingIfNeeded: valor),
            ])
        }

        private static func trozo(_ tipo: String, _ datos: Data) -> Data {
            var cuerpo = Data(tipo.utf8)
            cuerpo.append(datos)
            var salida = be32(UInt32(datos.count))
            salida.append(cuerpo)
            salida.append(be32(crc32(cuerpo)))
            return salida
        }

        private static func crc32(_ datos: Data) -> UInt32 {
            var c: UInt32 = 0xFFFF_FFFF
            for byte in datos {
                c ^= UInt32(byte)
                for _ in 0..<8 {
                    c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1
                }
            }
            return c ^ 0xFFFF_FFFF
        }

        /// zlib con bloques almacenados: cabecera, bloques de hasta 65535 bytes y Adler-32.
        private static func zlibAlmacenado(_ datos: Data) -> Data {
            var salida = Data([0x78, 0x01])
            let bytes = [UInt8](datos)
            var desplazamiento = 0
            repeat {
                let largo = min(65535, bytes.count - desplazamiento)
                let ultimo = desplazamiento + largo >= bytes.count
                salida.append(ultimo ? 1 : 0)
                salida.append(UInt8(truncatingIfNeeded: largo))
                salida.append(UInt8(truncatingIfNeeded: largo >> 8))
                let negado = ~UInt16(largo)
                salida.append(UInt8(truncatingIfNeeded: negado))
                salida.append(UInt8(truncatingIfNeeded: negado >> 8))
                salida.append(contentsOf: bytes[desplazamiento..<(desplazamiento + largo)])
                desplazamiento += largo
            } while desplazamiento < bytes.count
            var a: UInt32 = 1
            var b: UInt32 = 0
            for byte in bytes {
                a = (a + UInt32(byte)) % 65521
                b = (b + a) % 65521
            }
            salida.append(be32((b << 16) | a))
            return salida
        }
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
