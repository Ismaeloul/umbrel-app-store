#if DEBUG
    import Foundation

    /* Resolución, comprobador, reportes y vínculos de muestra (a7 §13.10), port de features/sources/demo-data.ts:
       cada partido tiene su guion (demo-1 y demo-5 con de todo; demo-4 sin ninguna verificada; demo-12 todas
       con reintento; demo-2 varias coincidencias; demo-3 nada) y el comprobador avanza un paso cada 1 350 ms.
       Los trabajos viven en `EstadoDemo` (como el `Map` de la web). */

    enum FuentesDemo {
        /// `DEMO_STEP_MS`: un paso del comprobador (como la 0.6.59, index.html:3570).
        static let pasoMs = 1350.0

        enum Resultado: String, Sendable { case working, weak, failed, retry }

        struct Elemento: Sendable, Hashable {
            var proveedor: String
            var resultado: Resultado
            var lento: Int?
            var pares: Int?
            var entrada: Double?
            var canal: Double?
            var codec: String?
            var origen: String?
        }

        struct Plan: Sendable {
            var estado: String
            var elementos: [Elemento]
        }

        /// Un trabajo del comprobador (`DemoJob`).
        struct Trabajo: Sendable {
            var id: String
            var tipo: String
            var creado: Double
            var elementos: [(elemento: Elemento, hash: String)]
        }

        static func el(
            _ proveedor: String, _ resultado: Resultado, lento: Int? = nil, pares: Int? = nil, entrada: Double? = nil,
            canal: Double? = nil, codec: String? = nil, origen: String? = nil
        ) -> Elemento {
            Elemento(
                proveedor: proveedor, resultado: resultado, lento: lento, pares: pares, entrada: entrada, canal: canal,
                codec: codec, origen: origen)
        }

        /// `RICH`: calidades variadas para que los carteles enseñen «1080p», «1080p · HEVC», «720p» y «SD».
        static let rico: [Elemento] = [
            el("Elcano", .working, pares: 48, entrada: 6.2, canal: 4.8),
            el("Faro", .working, pares: 31, entrada: 5.1, canal: 4.8, codec: "hevc"),
            el("Norte", .weak, pares: 9, entrada: 2.1, canal: 2.6),
            el("Vega", .working, lento: 9, pares: 22, entrada: 4.9, canal: 1.4),
            el("Tarifa", .retry),
            el("Sur", .failed, lento: 14),
        ]

        /// `PLANS` y `DEFAULT_PLAN`.
        static func plan(_ partido: String?) -> Plan {
            switch partido {
            case "demo-1", "demo-5": return Plan(estado: "found", elementos: rico)
            case "demo-4":
                return Plan(
                    estado: "found",
                    elementos: [
                        el("Alba", .failed), el("Brisa", .failed), el("Cierzo", .weak, pares: 6, entrada: 1.8, canal: 4.2),
                        el("Duna", .failed), el("Estela", .failed),
                    ])
            case "demo-12":
                return Plan(
                    estado: "found", elementos: [el("Orión", .retry), el("Lira", .retry), el("Vela", .retry), el("Hidra", .retry)])
            case "demo-2":
                return Plan(
                    estado: "choices",
                    elementos: [el("Zapping HD", .working, origen: "acestream"), el("Zapping 2", .weak, origen: "m3u")])
            case "demo-3": return Plan(estado: "not_found", elementos: [])
            default:
                return Plan(
                    estado: "found",
                    elementos: [
                        el("Atlas", .working, pares: 27, entrada: 5.4, canal: 4.6),
                        el("Boreal", .weak, pares: 7, entrada: 2.4, canal: 4.6), el("Cénit", .failed),
                    ])
            }
        }

        /// `RESEARCH_EXTRA`: lo que añade «Rebuscar».
        static let rebusca: [Elemento] = [
            el("Poniente", .working, pares: 18, entrada: 5.6, canal: 4.8), el("Levante", .failed),
        ]

        /// `newJobId`: «de» + hex(ahora) + hex(contador), rellenado con «0» hasta 24.
        static func idTrabajo(ahora: Double, contador: Int) -> String {
            let base = "de" + String(Int64(ahora), radix: 16) + String(contador, radix: 16)
            let relleno = base.count < 24 ? base + String(repeating: "0", count: 24 - base.count) : base
            return String(relleno.prefix(24))
        }

        private static func candidata(_ item: (elemento: Elemento, hash: String), canal: String, indice: Int) -> JSON {
            let e = item.elemento
            let acestream = e.origen == "acestream"
            let disponibilidad: JSON = acestream ? .numero(0.91) : (e.resultado == .weak ? .numero(0.4) : .nulo)
            let lista: JSON = acestream ? .nulo : .texto("principal")
            var o = JSON.objeto([])
            o["id"] = .texto(item.hash)
            o["title"] = .texto("\(canal) --> \(e.proveedor)")
            o["alias"] = .nulo
            o["ih"] = .bool(acestream)
            o["source"] = .texto(e.origen ?? "m3u")
            o["score"] = .num(100 - indice)
            o["matchedChannel"] = .texto(canal)
            o["soloFamilia"] = .bool(false)
            o["familyFallbackAllowed"] = .bool(false)
            o["listaId"] = lista
            o["availability"] = disponibilidad
            o["bitrate"] = .nulo
            o["learned"] = .nulo
            o["reported"] = .nulo
            o["rejectedByLearning"] = .bool(false)
            o["quarantined"] = .bool(false)
            return o
        }

        static func referencia(_ trabajo: Trabajo) -> JSON {
            .obj([
                "id": .texto(trabajo.id), "statusUrl": .texto("/api/v1/football/scans/\(trabajo.id)"),
                "total": .num(trabajo.elementos.count), "initialCount": .num(min(3, trabajo.elementos.count)),
            ])
        }

        /// `demoResolve(query)`: la respuesta y, si hay resultado «found», el trabajo nuevo que hay que guardar.
        static func resolver(partido: String?, canales: [String], rebuscar: Bool, ahora: Double, contador: Int)
            -> (respuesta: JSON, trabajo: Trabajo?)
        {
            let canal = canales.first ?? "Canal"
            let plan = plan(partido)
            let elementos = (plan.elementos + (rebuscar ? rebusca : [])).map { e in
                (elemento: e, hash: HashesDemo.demoHash("\(partido ?? canal)|\(e.proveedor)"))
            }
            let candidatas = elementos.enumerated().map { candidata($1, canal: canal, indice: $0) }
            let estado = rebuscar ? "found" : plan.estado
            let fuentesMiradas: [JSON] = ["saved", "m3u", "favorites", "history", "acestream"]
            let ia: JSON = .obj(["enabled": .bool(false), "used": .bool(false), "model": .nulo, "catalogSize": 0, "error": .nulo])
            var base = JSON.objeto([])
            base["status"] = .texto(estado)
            base["channels"] = .lista(canales.map(JSON.texto))
            base["checked"] = .lista(fuentesMiradas)
            base["candidates"] = .lista(candidatas)
            base["engineAvailable"] = .bool(true)
            base["ai"] = ia
            base["program"] = .nulo
            base["research"] = .bool(rebuscar)
            base["preheat"] = .nulo
            base["scan"] = .nulo
            guard estado == "found" else {
                base["candidate"] = .nulo
                return (base, nil)
            }
            let trabajo = Trabajo(
                id: idTrabajo(ahora: ahora, contador: contador), tipo: rebuscar ? "research" : "interactive", creado: ahora,
                elementos: elementos)
            base["candidate"] = candidatas.first ?? .nulo
            base["scan"] = referencia(trabajo)
            return (base, trabajo)
        }

        /// `stepsOf`: cuándo empieza y acaba de comprobarse la fuente i.
        static func pasos(_ e: Elemento, indice: Int) -> (inicio: Int, fin: Int) {
            let inicio = indice / 2
            return (inicio, inicio + (e.lento ?? 2))
        }

        /// `probeOf`.
        static func sonda(_ item: (elemento: Elemento, hash: String), indice: Int, paso: Int, ahora: Double) -> JSON {
            let e = item.elemento
            let (inicio, fin) = pasos(e, indice: indice)
            let hecho = paso >= fin
            let comprobando = !hecho && paso >= inicio
            let final: Resultado = e.resultado == .retry ? .failed : e.resultado
            let estado = hecho ? final.rawValue : (comprobando ? "checking" : "queued")
            let viva = hecho && (final == .working || final == .weak)
            let reintento: JSON =
                hecho && e.resultado == .retry ? .texto(AgendaDemo.iso(ahora + 6 * 60_000)) : .nulo
            let motivo: String
            if !hecho {
                motivo = ""
            } else if final == .working {
                motivo = "playable_media"
            } else if final == .weak {
                motivo = "starved"
            } else {
                motivo = e.resultado == .retry ? "timeout" : "no_media"
            }
            let entrada = e.entrada ?? 3
            let canal = e.canal ?? 4
            let kbpsCanal = Int((canal * 1000).rounded())
            let kbpsEntrada = Int((entrada * 1000).rounded())
            let comprobado: JSON = hecho ? .texto(AgendaDemo.iso(ahora)) : .nulo
            let codec = viva ? (e.codec ?? "h264") : ""
            let audio: [JSON] = viva ? ["aac"] : []
            var o = JSON.objeto([])
            o["id"] = .texto(item.hash)
            o["state"] = .texto(estado)
            o["checkedAt"] = comprobado
            o["retryAt"] = reintento
            o["durationMs"] = .num(hecho ? 900 + indice * 630 : 0)
            o["bytes"] = .num(viva ? 180_000 : 0)
            o["peers"] = .num(viva ? (e.pares ?? 12) : 0)
            o["speedDown"] = .num(viva ? Int((entrada * 125).rounded()) : 0)
            o["rateKbps"] = viva ? JSON.num(kbpsCanal) : JSON.nulo
            o["intakeKbps"] = viva ? JSON.num(kbpsEntrada) : JSON.nulo
            o["streamKbps"] = .num(viva ? kbpsCanal : 0)
            o["reason"] = .texto(motivo)
            o["mediaValid"] = .bool(viva)
            o["browserCompatible"] = .bool(viva)
            o["videoCodec"] = .texto(codec)
            o["audioCodecs"] = .lista(audio)
            o["cached"] = .bool(false)
            o["attempts"] = .num(hecho ? 1 : 0)
            if hecho { o["playableOn"] = .obj(["web": .bool(viva), "ios": .bool(viva)]) }
            return o
        }

        /// `demoScan(id, now)`.
        static func comprobar(id: String, trabajo: Trabajo?, ahora: Double) -> JSON {
            guard let trabajo else {
                let creado = JSON.texto(AgendaDemo.iso(ahora))
                return .obj([
                    "id": .texto(id), "kind": "interactive", "status": "cancelled", "createdAt": creado, "updatedAt": creado,
                    "total": 0, "checked": 0, "playable": 0, "failed": 0, "waiting": 0, "retryAt": .nulo, "initialCount": 0,
                    "candidates": .lista([]),
                ])
            }
            let paso = Int(((ahora - trabajo.creado) / pasoMs).rounded(.down))
            let candidatas = trabajo.elementos.enumerated().map { sonda($1, indice: $0, paso: paso, ahora: ahora) }
            let estados = candidatas.map { $0["state"]?.texto ?? "" }
            let decididas = estados.filter { ["working", "weak", "failed"].contains($0) }.count
            let jugables = estados.filter { $0 == "working" || $0 == "weak" }.count
            let esperando = candidatas.filter { !($0["retryAt"]?.esNulo ?? true) }.count
            let todas = decididas == candidatas.count
            let estado = !todas ? "running" : (esperando > 0 && jugables == 0 ? "waiting" : "complete")
            let reintento = candidatas.compactMap { $0["retryAt"] }.first { !$0.esNulo } ?? .nulo
            let reintentoTrabajo: JSON = estado == "waiting" ? reintento : .nulo
            var o = JSON.objeto([])
            o["id"] = .texto(trabajo.id)
            o["kind"] = .texto(trabajo.tipo)
            o["status"] = .texto(estado)
            o["createdAt"] = .texto(AgendaDemo.iso(trabajo.creado))
            o["updatedAt"] = .texto(AgendaDemo.iso(ahora))
            o["total"] = .num(candidatas.count)
            o["checked"] = .num(decididas)
            o["playable"] = .num(jugables)
            o["failed"] = .num(decididas - jugables)
            o["waiting"] = .num(esperando)
            o["retryAt"] = reintentoTrabajo
            o["initialCount"] = .num(min(3, candidatas.count))
            o["candidates"] = .lista(candidatas)
            return o
        }

        /// `demoReport(body)`: el reporte y el trabajo nuevo (mismo proveedor y resultado si venía de uno).
        static func reportar(
            id: String, motivo: String?, canal: String?, partido: String?, previo: Elemento?, ahora: Double, contador: Int
        ) -> (respuesta: JSON, trabajo: Trabajo) {
            let elemento = Elemento(proveedor: previo?.proveedor ?? "Externa", resultado: previo?.resultado ?? .failed)
            let trabajo = Trabajo(
                id: idTrabajo(ahora: ahora, contador: contador), tipo: "report", creado: ahora,
                elementos: [(elemento: elemento, hash: id)])
            var reporte = JSON.objeto([])
            reporte["reportId"] = .texto("rep_demo_\(trabajo.id.suffix(6))")
            reporte["id"] = .texto(id)
            reporte["channel"] = .texto(canal ?? "")
            reporte["matchId"] = .texto(partido ?? "")
            reporte["reason"] = .texto(motivo ?? "not_starting")
            reporte["state"] = "checking"
            reporte["checkReason"] = ""
            reporte["reportedAt"] = .texto(AgendaDemo.iso(ahora))
            reporte["lastCheckedAt"] = .nulo
            reporte["quarantineUntil"] = .texto(AgendaDemo.iso(ahora + 30 * 60_000))
            return (.obj(["report": reporte, "scan": referencia(trabajo)]), trabajo)
        }

        /// `demoBind(body)`.
        static func vincular(canal: String, id: String, titulo: String?, ih: Bool?, ahora: Double) -> JSON {
            let clave = Canales.clave(canal)
            let tituloBase = (titulo?.isEmpty ?? true) ? canal : (titulo ?? canal)
            var vinculo = JSON.objeto([])
            vinculo["channel"] = .texto(prefijoUTF16(canal, 120))
            vinculo["channelKey"] = .texto(clave.isEmpty ? "canal" : clave)
            vinculo["id"] = .texto(id.lowercased())
            vinculo["title"] = .texto(prefijoUTF16(tituloBase, 120))
            vinculo["ih"] = .bool(ih == true)
            vinculo["updatedAt"] = .texto(AgendaDemo.iso(ahora))
            return .obj(["binding": vinculo, "channelBindings": .lista([vinculo])])
        }

        /// `texto.slice(0, n)` (unidades UTF-16).
        static func prefijoUTF16(_ texto: String, _ n: Int) -> String {
            let unidades = Array(texto.utf16.prefix(n))
            return String(decoding: unidades, as: UTF16.self)
        }
    }
#endif
