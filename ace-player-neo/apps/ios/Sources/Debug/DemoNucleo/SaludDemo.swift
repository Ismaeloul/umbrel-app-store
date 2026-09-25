#if DEBUG
    import Foundation

    /* Salud y registro de muestra (a7 §13.12), port de features/health/demo.ts: nueve fallos repartidos por
       causa con horas relativas a AHORA (el recuento de 24 h de /health sale de la misma lista). */

    enum SaludDemo {
        static let dazn = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
        static let laliga = "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567"
        /// `CAUSES` de health/model.ts, en su orden.
        static let causas = ["engine", "source", "network", "codec", "client", "state"]

        struct Muestra: Sendable {
            var minutos: Double
            var causa: String
            var codigo: String
            var mensaje: String
            var canal: String?
            var hash: String?
            var metricas: JSON?
        }

        static let muestras: [Muestra] = [
            Muestra(minutos: 4, causa: "source", codigo: "source_no_peers", mensaje: "La fuente no tiene pares.", canal: "DAZN 1", hash: dazn),
            Muestra(
                minutos: 11, causa: "client", codigo: "player_metrics", mensaje: "", canal: "DAZN 1", hash: dazn,
                metricas: .obj([
                    "timeToFirstFrameMs": 2300, "rebuffers": 2, "rebufferMs": 4100, "reconnects": 1, "liveLatencyS": 14,
                ])),
            Muestra(minutos: 26, causa: "source", codigo: "source_no_peers", mensaje: "La fuente no tiene pares.", canal: "DAZN 1", hash: dazn),
            Muestra(
                minutos: 48, causa: "codec", codigo: "unsupported_codec",
                mensaje: "El audio viene en AC-3 y este navegador no lo descodifica.", canal: "M+ LaLiga TV", hash: laliga),
            Muestra(minutos: 95, causa: "engine", codigo: "engine_auto_restart", mensaje: "Reinicio automático del motor: no respondía."),
            Muestra(
                minutos: 140, causa: "network", codigo: "http_503",
                mensaje: "Directorio «Deportes extra»: El servidor respondió con un error 503."),
            Muestra(
                minutos: 310, causa: "client", codigo: "autoplay_blocked",
                mensaje: "El navegador bloqueó la reproducción automática.", canal: "Teledeporte"),
            Muestra(
                minutos: 600, causa: "source", codigo: "source_stalled", mensaje: "La fuente se quedó sin datos durante 20 s.",
                canal: "M+ LaLiga TV", hash: laliga),
            Muestra(
                minutos: 26 * 60, causa: "engine", codigo: "engine_stalled",
                mensaje: "El motor responde pero lleva 30 s sin entregar datos."),
        ]

        static func iso(_ ms: Double) -> JSON { .texto(AgendaDemo.iso(ms)) }

        /// `demoEntries(now)`.
        static func entradas(ahora: Double) -> [JSON] {
            muestras.enumerated().map { indice, m in
                let numero = String(indice + 1)
                var o = JSON.objeto([])
                o["id"] = .texto("demo_" + String(repeating: "0", count: 4 - numero.count) + numero)
                o["at"] = iso(ahora - m.minutos * 60_000)
                o["cause"] = .texto(m.causa)
                o["code"] = .texto(m.codigo)
                o["message"] = .texto(m.mensaje)
                if let canal = m.canal { o["channel"] = .texto(canal) }
                if let hash = m.hash { o["hash"] = .texto(hash) }
                if let metricas = m.metricas { o["metrics"] = metricas }
                return o
            }
        }

        /// `counts24h`: por causa, las de las últimas 24 h.
        static func recuento(_ entradas: [JSON], ahora: Double) -> JSON {
            var cuentas = causas.map { JSON.Campo(clave: $0, valor: .numero(0)) }
            for entrada in entradas {
                guard let at = entrada["at"]?.texto.flatMap(FechaISO.parse), let causa = entrada["cause"]?.texto,
                    ahora - at.timeIntervalSince1970 * 1000 <= 86_400_000,
                    let indice = cuentas.firstIndex(where: { $0.clave == causa })
                else { continue }
                cuentas[indice].valor = .numero((cuentas[indice].valor.numero ?? 0) + 1)
            }
            return .objeto(cuentas)
        }

        /// `demoDiagnostics(query, now)`.
        static func diagnosticos(causa: String?, limite: Int?, ahora: Double) -> JSON {
            let todas = entradas(ahora: ahora)
            let casan = causa.map { c in todas.filter { $0["cause"]?.texto == c } } ?? todas
            return .obj([
                "entries": .lista(Array(casan.prefix(limite ?? 100))), "counts24h": recuento(todas, ahora: ahora),
                "total": .num(casan.count),
            ])
        }

        /// `demoHealth(now)`.
        static func salud(ahora: Double) -> JSON {
            let ahoraISO = iso(ahora)
            let autoReinicios: JSON = .obj(["lastHour": 0, "max": 3, "nextAllowedAt": .nulo, "exhausted": .bool(false)])
            var motor = JSON.objeto([])
            motor["status"] = "online"
            motor["online"] = .bool(true)
            motor["since"] = iso(ahora - 95 * 60_000)
            motor["checkedAt"] = ahoraISO
            motor["engineVersion"] = "3.2.3"
            motor["autoRestarts"] = autoReinicios
            var escaner = JSON.objeto([])
            escaner["status"] = "ready"
            escaner["busy"] = .bool(true)
            escaner["queue"] = 2
            escaner["activeJobs"] = 1
            escaner["cachedSources"] = 42
            escaner["leakedSessionsLastHour"] = 0
            var componentes = JSON.objeto([])
            componentes["backend"] = .obj(["status": "ready"])
            componentes["engine"] = motor
            componentes["scanner"] = escaner
            componentes["ai"] = .obj(["status": "disabled", "model": "embeddinggemma:300m-qat-q4_0"])
            componentes["agenda"] = .obj(["status": "ready", "generatedAt": ahoraISO, "matches": 38, "preheated": 2])
            componentes["directories"] = .obj(["status": "ready", "total": 2, "channels": 61])
            componentes["state"] = .obj(["status": "ready", "recoveredFrom": .nulo])
            componentes["playback"] = .obj(["sessions": 1, "viewers": 1, "remuxSessions": 0])
            componentes["events"] = .obj(["connections": 2])
            var o = JSON.objeto([])
            o["version"] = "0.7.0"
            o["checkedAt"] = ahoraISO
            o["uptimeSeconds"] = .num(3 * 3600 + 25 * 60)
            o["components"] = componentes
            o["reports"] = .obj(["total": 3, "quarantined": 1, "learningCount": 4])
            o["diagnostics"] = .obj(["counts24h": recuento(entradas(ahora: ahora), ahora: ahora)])
            o["warnings"] = .lista([])
            return o
        }
    }
#endif
