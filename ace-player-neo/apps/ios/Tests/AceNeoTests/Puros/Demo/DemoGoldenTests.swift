import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* La demo de la app responde lo mismo que la demo de la web (b-arquitectura §3.3, decisión 10): cada guion
   de Vectores/demo/demo-<guion>.json (generar-demo.ts, ejecutando la demo real de la web con el reloj en
   T0 = 2026-09-24T19:00:00+02:00) se repite paso a paso contra `RutasDemo` con el mismo reloj, y cada
   respuesta tiene que dar el mismo JSON. La única diferencia admitida es la del arranque (a7 §13.2: la app
   entra por /native con el iPhone emparejado y el `playback` de §13.7). */

#if DEBUG
    struct DemoGoldenTests {
        static let guiones = [
            "footballSchedule", "scores", "footballPreheat", "footballResolve", "footballScan-demo-1",
            "footballScan-demo-4", "footballScan-demo-12", "footballScan-demo-6", "footballScan-cancelado", "sourcesReport",
            "footballBind", "search", "health", "diagnosticsList", "pairingCreate", "library", "preferences", "devices",
            "base",
        ]

        @Test(arguments: guiones)
        func mismoJSONQueLaWeb(_ guion: String) throws {
            let lote = try JSON.leer(Vectores.datos("demo-\(guion)"))
            let t0 = try #require(lote["t0"]?.texto.flatMap(FechaISO.parse))
            let pasos = try #require(lote["pasos"]?.lista)
            #expect(!pasos.isEmpty)
            let estado = EstadoDemo(modo: ModoDemo(demo: false), ahora: t0)
            for (n, paso) in pasos.enumerated() {
                let ruta = try #require(paso["ruta"]?.texto.flatMap(RutaID.init(rawValue:)))
                let ahora = t0.addingTimeInterval((paso["t"]?.numero ?? 0) / 1000)
                let respuesta = RutasDemo.responder(peticion(ruta, paso), estado: estado, ahora: ahora)
                let donde = "\(guion) paso \(n) (\(ruta.rawValue))"
                if let error = paso["error"] {
                    #expect(respuesta.estado == Int(error["status"]?.numero ?? 0), "\(donde): estado HTTP")
                    #expect(respuesta.json?["error"]?["code"] == error["code"], "\(donde): código de error")
                    continue
                }
                #expect((200..<300).contains(respuesta.estado), "\(donde): estado \(respuesta.estado)")
                var esperado = paso["respuesta"] ?? .nulo
                if ruta == .bootstrap { esperado = Self.arranqueNativo(esperado) }
                let obtenido = respuesta.json ?? .nulo
                let diferencia = Self.diferencia(obtenido, esperado)
                #expect(diferencia == nil, "\(donde): \(diferencia ?? "")")
            }
        }

        /// La petición de la app para un paso del guion.
        private func peticion(_ ruta: RutaID, _ paso: JSON) -> PeticionDemo {
            var camino = ruta.ruta
            if case .objeto(let parametros)? = paso["params"] {
                for p in parametros { camino = camino.replacingOccurrences(of: ":\(p.clave)", with: p.valor.texto ?? "") }
            }
            let consulta = (paso["query"]?.lista ?? []).compactMap { par -> (nombre: String, valor: String)? in
                guard let l = par.lista, l.count == 2, let k = l[0].texto, let v = l[1].texto else { return nil }
                return (k, v)
            }
            let cuerpo = paso["cuerpo"].flatMap { $0.esNulo ? nil : $0.datos }
            return PeticionDemo(metodo: ruta.metodo.rawValue, ruta: "/native" + camino, consulta: consulta, cuerpo: cuerpo)
        }

        /// La primera diferencia entre dos JSON («ruta: app … / web …»), o `nil` si son iguales en datos.
        static func diferencia(_ app: JSON, _ web: JSON, ruta: String = "$") -> String? {
            if app.igualEnDatos(web) { return nil }
            switch (app, web) {
            case (.objeto, .objeto):
                for clave in Set(app.claves + web.claves).sorted() {
                    guard let a = app[clave], let w = web[clave] else {
                        return "\(ruta).\(clave): app \(app[clave]?.cadena ?? "—") / web \(web[clave]?.cadena ?? "—")"
                    }
                    if let d = diferencia(a, w, ruta: "\(ruta).\(clave)") { return d }
                }
            case (.lista(let a), .lista(let w)) where a.count == w.count:
                for (i, par) in zip(a, w).enumerated() {
                    if let d = diferencia(par.0, par.1, ruta: "\(ruta)[\(i)]") { return d }
                }
            default:
                break
            }
            return "\(ruta): app \(String(app.cadena.prefix(200))) / web \(String(web.cadena.prefix(200)))"
        }

        /// a7 §13.2: el arranque de la web demo con lo que cambia en la entrada nativa.
        static func arranqueNativo(_ web: JSON) -> JSON {
            var app = web
            app["origin"] = "native"
            app["device"] = SemillasDemo.fixture("bootstrap")["device"]
            app["playback"] = SemillasDemo.fixture("playbackStatus")
            return app
        }

        @Test func esperasComoLaWeb() {
            let estado = EstadoDemo(ahora: Date(timeIntervalSince1970: 1_790_269_200))
            func espera(_ metodo: String, _ ruta: String) -> Double {
                RutasDemo.responder(PeticionDemo(metodo: metodo, ruta: ruta), estado: estado, ahora: Date(timeIntervalSince1970: 1_790_269_200))
                    .espera
            }
            #expect(espera("GET", "/native/api/v1/bootstrap") == 0.12)
            #expect(espera("GET", "/native/api/v1/library") == 0.12)
            #expect(espera("GET", "/native/api/v1/football") == 0)
            #expect(espera("GET", "/native/api/v1/scores") == 0)
            #expect(espera("GET", "/native/api/v1/search") == 0.26)
            #expect(espera("GET", "/native/api/v1/health") == 0)
        }
    }
#endif
