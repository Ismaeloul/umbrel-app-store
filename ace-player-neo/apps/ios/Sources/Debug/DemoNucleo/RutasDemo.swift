#if DEBUG
    import Foundation

    /* El enrutador de la demo (a7 §13; b-arquitectura §1.9, M2): `responder(petición, estado, ahora)` →
       estado HTTP, cuerpo y espera, con los MISMOS datos que `?demo=1` de la web (api/demo/index.ts y los
       manejadores de agenda/demo.ts, sources/demo.ts, search/demo.ts, health/demo.ts, devices/demo.ts y
       directories/model.ts). Esperas: 120 ms en lo que sale del ejemplo base, 0 en lo que tiene manejador
       propio y 260 ms en la búsqueda. Diferencias de la app, todas de a7 §13.2-§13.7: el arranque es el de la
       entrada nativa (origen `native`, el iPhone emparejado y el `playback` de §13.7), canjear el código 482913
       da el token de los ejemplos, y con `-AceNeoDemo` el visor iPhone de «Dónde» no es este iPhone. */

    /// Una petición a /native/api/v1 ya leída (sin URLSession: esto es puro y se prueba en Linux).
    struct PeticionDemo: Sendable {
        var metodo: String
        /// Ruta sin la entrada: `/api/v1/football/preheat/demo-1` (con o sin `/native` delante).
        var ruta: String
        var consulta: [(nombre: String, valor: String)] = []
        var cuerpo: Data?

        func valor(_ nombre: String) -> String? { consulta.first { $0.nombre == nombre }?.valor }
        func valores(_ nombre: String) -> [String] { consulta.filter { $0.nombre == nombre }.map(\.valor) }
    }

    struct RespuestaDemo: Sendable {
        var estado: Int
        var cuerpo: Data
        /// Segundos que tarda (0, 0,12 o 0,26).
        var espera: Double
        var tipo = "application/json"
        /// El JSON de la respuesta (para las pruebas).
        var json: JSON?
    }

    enum RutasDemo {
        static let esperaBase = 0.12
        static let esperaBusqueda = 0.26
        /// El `deviceId` del visor iPhone de «Dónde» con `-AceNeoDemo` (en la web no es el propio; a7 §13.7).
        static let visorAjeno = "dev_iphone_isma"

        // MARK: Rutas

        /// La ruta de la tabla (`RutaID`) y sus parámetros `:x`.
        static func casar(_ metodo: String, _ ruta: String) -> (id: RutaID, parametros: [String: String])? {
            var camino = ruta
            if camino.hasPrefix("/native") { camino.removeFirst("/native".count) }
            let trozos = camino.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
            for id in RutaID.allCases where id.metodo.rawValue == metodo.uppercased() {
                let patron = id.ruta.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
                guard patron.count == trozos.count else { continue }
                var parametros: [String: String] = [:]
                var casa = true
                for (p, t) in zip(patron, trozos) {
                    if p.hasPrefix(":") {
                        parametros[String(p.dropFirst())] = t.removingPercentEncoding ?? t
                    } else if p != t {
                        casa = false
                        break
                    }
                }
                if casa { return (id, parametros) }
            }
            return nil
        }

        // MARK: Respuestas

        static func ok(_ json: JSON, espera: Double = 0, estado: Int = 200) -> RespuestaDemo {
            RespuestaDemo(estado: estado, cuerpo: json.datos, espera: espera, json: json)
        }

        /// `{"error": {code, message, requestId}}` con el mensaje del catálogo (o el del cliente web).
        static func error(_ codigo: String, estado: Int, espera: Double = 0) -> RespuestaDemo {
            let mensaje =
                codigo == "demo_unsupported"
                ? "Esto no se puede hacer en el modo demo." : (ErrorCatalog.entries[codigo]?.message ?? "Algo ha fallado.")
            let json = JSON.obj([
                "error": .obj(["code": .texto(codigo), "message": .texto(mensaje), "requestId": "req_demo"])
            ])
            return RespuestaDemo(estado: estado, cuerpo: json.datos, espera: espera, json: json)
        }

        /// `itemFrom`: un elemento de la biblioteca que añade la demo.
        static func elementoBiblioteca(id: String, titulo: String?, categoria: String?, tipo: String, ahora: Double) -> JSON {
            var o = JSON.objeto([])
            o["id"] = .texto(id.lowercased())
            o["title"] = .texto(titulo ?? "Canal sin nombre")
            o["type"] = .texto(tipo)
            o["category"] = .texto(categoria ?? "Sin categoría")
            o["date"] = .texto(AgendaDemo.iso(ahora))
            o["fromWebSync"] = .bool(false)
            o["ih"] = .bool(false)
            return o
        }

        /// Rutas que la 0.8.0 cerraba a la app con 403 `origin_forbidden` (a9 §2).
        static let rutas081: Set<RutaID> = [.health, .settingsUpdate, .pairingCreate, .devicesList, .deviceRevoke]

        /// La respuesta de la demo a una petición.
        static func responder(_ peticion: PeticionDemo, estado: EstadoDemo, ahora: Date) -> RespuestaDemo {
            guard let casada = casar(peticion.metodo, peticion.ruta) else { return error("not_found", estado: 404) }
            let id = casada.id
            let parametros = casada.parametros
            if estado.modo.servidor080 && rutas081.contains(id) { return error("origin_forbidden", estado: 403) }
            let ms = AgendaDemo.ms(ahora)
            let cuerpo = (peticion.cuerpo.flatMap { try? JSON.leer($0) }) ?? .nulo
            switch id {
            case .footballSchedule:
                return ok(AgendaDemo.agenda(ancla: estado.ancla))
            case .scores:
                return ok(MarcadoresDemo.respuesta(ancla: estado.ancla, ahora: ahora))
            case .footballPreheat:
                return ok(.obj(["preheat": AgendaDemo.precalentado(parametros["matchId"] ?? "", ancla: estado.ancla)]))
            case .footballResolve, .footballScan, .footballBind, .sourcesReport:
                return fuentes(id, peticion, parametros, cuerpo, estado: estado, ms: ms)
            case .search:
                return ok(BuscadorDemo.buscar(peticion.valor("q") ?? ""), espera: esperaBusqueda)
            case .health:
                return ok(SaludDemo.salud(ahora: ms))
            case .diagnosticsList:
                let limite = peticion.valor("limit").flatMap { Int($0) }
                return ok(SaludDemo.diagnosticos(causa: peticion.valor("cause"), limite: limite, ahora: ms))
            case .pairingCreate:
                let azar = estado.con { $0.azar.siguiente() }
                return ok(DispositivosDemo.crearCodigo(azar: azar, ahora: ms, direcciones: [DispositivosDemo.direccion]))
            case .directoriesGet:
                let biblioteca = estado.con { $0.biblioteca }
                var vista = JSON.objeto([])
                for clave in ["web", "webSyncedAt", "webSources", "activeWebSourceId"] { vista[clave] = biblioteca[clave] ?? .nulo }
                return ok(vista, espera: esperaBase)
            case .directoriesSync, .directoriesActivate, .directoriesDelete:
                return error("demo_unsupported", estado: 409)
            default:
                return base(id, parametros, cuerpo, estado: estado, ms: ms)
            }
        }

        private static func fuentes(
            _ id: RutaID, _ peticion: PeticionDemo, _ parametros: [String: String], _ cuerpo: JSON, estado: EstadoDemo,
            ms: Double
        ) -> RespuestaDemo {
            switch id {
            case .footballResolve:
                let respuesta = estado.con { d -> JSON in
                    let (json, trabajo) = FuentesDemo.resolver(
                        partido: peticion.valor("match"), canales: peticion.valores("channel"),
                        rebuscar: peticion.valor("research") == "1", ahora: ms, contador: d.contadorTrabajos + 1)
                    if let trabajo {
                        d.contadorTrabajos += 1
                        d.trabajos[trabajo.id] = trabajo
                    }
                    return json
                }
                return ok(respuesta)
            case .footballScan:
                let id = parametros["id"] ?? ""
                let trabajo = estado.con { $0.trabajos[id] }
                return ok(FuentesDemo.comprobar(id: id, trabajo: trabajo, ahora: ms))
            case .footballBind:
                return ok(
                    FuentesDemo.vincular(
                        canal: cuerpo["channel"]?.texto ?? "", id: cuerpo["id"]?.texto ?? "", titulo: cuerpo["title"]?.texto,
                        ih: cuerpo["ih"]?.bool, ahora: ms))
            default:
                let hash = cuerpo["id"]?.texto ?? ""
                let respuesta = estado.con { d -> JSON in
                    let previo = d.trabajos.values.flatMap(\.elementos).first { $0.hash == hash }?.elemento
                    let (json, trabajo) = FuentesDemo.reportar(
                        id: hash, motivo: cuerpo["reason"]?.texto, canal: cuerpo["channel"]?.texto,
                        partido: cuerpo["matchId"]?.texto, previo: previo, ahora: ms, contador: d.contadorTrabajos + 1)
                    d.contadorTrabajos += 1
                    d.trabajos[trabajo.id] = trabajo
                    return json
                }
                return ok(respuesta)
            }
        }

        /// `handleDemo` sin manejador propio: el ejemplo base y el estado guardado, con 120 ms.
        private static func base(
            _ id: RutaID, _ parametros: [String: String], _ cuerpo: JSON, estado: EstadoDemo, ms: Double
        ) -> RespuestaDemo {
            switch id {
            case .bootstrap: return ok(arranque(estado: estado, ms: ms), espera: esperaBase)
            case .libraryGet: return ok(estado.con { $0.biblioteca }, espera: esperaBase)
            case .libraryMutate:
                let biblioteca = estado.con { d -> JSON in
                    d.biblioteca = mutarBiblioteca(d.biblioteca, cuerpo, ms: ms)
                    return d.biblioteca
                }
                estado.emitir("state.changed", cambio(["library"], ms: ms))
                return ok(biblioteca, espera: esperaBase)
            case .preferencesGet:
                return ok(.obj(["preferences": estado.con { $0.preferencias }]), espera: esperaBase)
            case .preferencesUpdate:
                let preferencias = estado.con { d -> JSON in
                    d.preferencias = d.preferencias.mezclado(con: cuerpo)
                    return d.preferencias
                }
                estado.emitir("state.changed", cambio(["preferences"], ms: ms))
                return ok(.obj(["preferences": preferencias]), espera: esperaBase)
            case .settingsGet:
                return ok(.obj(["settings": estado.con { $0.ajustes }, "source": "saved"]), espera: esperaBase)
            case .settingsUpdate:
                let ajustes = estado.con { d -> JSON in
                    d.ajustes = d.ajustes.mezclado(con: cuerpo)
                    return d.ajustes
                }
                estado.emitir("state.changed", cambio(["settings"], ms: ms))
                return ok(.obj(["settings": ajustes, "source": "saved"]), espera: esperaBase)
            case .devicesList:
                return ok(.obj(["devices": .lista(estado.con { $0.dispositivos })]), espera: esperaBase)
            case .deviceRevoke:
                return revocar(parametros["id"] ?? "", estado: estado, ms: ms)
            case .pairingClaim:
                guard cuerpo["code"]?.texto == DispositivosDemo.codigoValido else {
                    return error("pairing_invalid", estado: 401)
                }
                estado.emitir("devices.changed", .obj(["reason": "paired", "deviceId": "dev_iphone01"]))
                return ok(SemillasDemo.fixture("pairingClaim"), espera: esperaBase, estado: 201)
            case .playbackStatus:
                return ok(reproduccion(estado: estado), espera: esperaBase)
            case .events, .video, .footballTeamCrest, .footballCompetitionLogo:
                return error("not_found", estado: 404)
            default:
                guard SemillasDemo.tiene(id.rawValue) else { return error("not_found", estado: 404) }
                return ok(SemillasDemo.fixture(id.rawValue), espera: esperaBase)
            }
        }

        private static func cambio(_ ambitos: [String], ms: Double) -> JSON {
            .obj(["scopes": .lista(ambitos.map(JSON.texto)), "at": .texto(AgendaDemo.iso(ms))])
        }

        private static func revocar(_ id: String, estado: EstadoDemo, ms: Double) -> RespuestaDemo {
            let revocado = estado.con { d -> JSON? in
                guard let indice = d.dispositivos.firstIndex(where: { $0["id"]?.texto == id }) else { return nil }
                d.dispositivos[indice]["revokedAt"] = .texto(AgendaDemo.iso(ms))
                return d.dispositivos[indice]
            }
            guard let revocado else { return error("not_found", estado: 404) }
            estado.emitir("devices.changed", .obj(["reason": "revoked", "deviceId": .texto(id)]))
            return ok(.obj(["device": revocado]), espera: esperaBase)
        }

        /// `mutateLibrary` de api/demo/index.ts.
        static func mutarBiblioteca(_ actual: JSON, _ cuerpo: JSON, ms: Double) -> JSON {
            var biblioteca = actual
            func item(_ tipo: String) -> JSON {
                let entrada = cuerpo["item"] ?? .nulo
                return elementoBiblioteca(
                    id: entrada["id"]?.texto ?? "", titulo: entrada["title"]?.texto, categoria: entrada["category"]?.texto,
                    tipo: tipo, ahora: ms)
            }
            func coleccion(_ nombre: String?) -> String {
                nombre == "favorites" ? "favorites" : (nombre == "history" ? "history" : "web")
            }
            switch cuerpo["action"]?.texto {
            case "favorite-upsert":
                let nuevo = item("fav")
                let resto = (biblioteca["favorites"]?.lista ?? []).filter { $0["id"] != nuevo["id"] }
                biblioteca["favorites"] = .lista([nuevo] + resto)
            case "history-upsert":
                let nuevo = item("recent")
                let resto = (biblioteca["history"]?.lista ?? []).filter { $0["id"] != nuevo["id"] }
                biblioteca["history"] = .lista(Array(([nuevo] + resto).prefix(30)))
            case "rename":
                let clave = coleccion(cuerpo["collection"]?.texto)
                let id = (cuerpo["id"]?.texto ?? "").lowercased()
                let titulo = cuerpo["title"] ?? .nulo
                let lista = (biblioteca[clave]?.lista ?? []).map { elemento -> JSON in
                    guard elemento["id"]?.texto == id else { return elemento }
                    var cambiado = elemento
                    cambiado["title"] = titulo
                    return cambiado
                }
                biblioteca[clave] = .lista(lista)
            case "delete":
                let clave = coleccion(cuerpo["collection"]?.texto)
                let id = (cuerpo["id"]?.texto ?? "").lowercased()
                biblioteca[clave] = .lista((biblioteca[clave]?.lista ?? []).filter { $0["id"]?.texto != id })
            default:
                break
            }
            return biblioteca
        }

        /// `GET playback`: el ejemplo de §13.7. Con `-AceNeoDemo` el visor iPhone no es este iPhone (como en la web).
        static func reproduccion(estado: EstadoDemo) -> JSON {
            var playback = SemillasDemo.fixture("playbackStatus")
            guard estado.modo.demo, var sesiones = playback["sessions"]?.lista else { return playback }
            for (i, sesion) in sesiones.enumerated() {
                guard let visores = sesion["viewers"]?.lista else { continue }
                sesiones[i]["viewers"] = .lista(
                    visores.map { visor -> JSON in
                        guard visor["deviceId"]?.texto == "dev_iphone01" else { return visor }
                        var ajeno = visor
                        ajeno["deviceId"] = .texto(visorAjeno)
                        return ajeno
                    })
            }
            playback["sessions"] = .lista(sesiones)
            return playback
        }

        /// `GET bootstrap` de la entrada nativa (a7 §13.2): el ejemplo, el estado guardado y el `playback` de §13.7.
        static func arranque(estado: EstadoDemo, ms: Double) -> JSON {
            let guardado = estado.con { (biblioteca: $0.biblioteca, preferencias: $0.preferencias, ajustes: $0.ajustes) }
            var salida = SemillasDemo.fixture("bootstrap")
            salida["origin"] = "native"
            salida["serverTime"] = .numero(ms)
            salida["library"] = guardado.biblioteca
            salida["preferences"] = guardado.preferencias
            salida["settings"] = guardado.ajustes
            salida["playback"] = reproduccion(estado: estado)
            var funciones = salida["features"] ?? .objeto([])
            funciones["demoSchedule"] = .bool(true)
            salida["features"] = funciones
            return salida
        }
    }
#endif
