#if DEBUG
    import Foundation

    /* Agenda de muestra de la demo (a7 §13.8), port de features/agenda/demo-data.ts: los 13 partidos
       demo-1…demo-13, los de HOY a minutos del ancla (redondeada a 5 min, fija por proceso: volver a pedir
       no mueve horas) y los de otros días a su hora de Madrid; escudos con siglas y colores de cada club
       (`crest: null`: el escudo generado) y competiciones sin logo. Lo vigila `DemoGoldenTests` con las
       respuestas de la web en T0, T0 + 5 min y T0 + 2 h. */

    enum AgendaDemo {
        static let minuto = 60_000.0

        /// `at`: minutos respecto al ancla (solo hoy) o «HH:MM» fijo.
        enum Hora: Sendable {
            case relativa(Int)
            case fija(String)
        }

        struct Muestra: Sendable {
            var id: String
            var dia: Int
            var hora: Hora
            var local: String
            var visitante: String
            var competicion: String
            var canales: [String]
            var goles: (local: [Int], visitante: [Int])?
            var precalentado: (estado: String, comprobadas: Int, jugables: Int, total: Int, candidatas: Int)?
        }

        /// `SAMPLES` (a7 §13.8).
        static let muestras: [Muestra] = [
            Muestra(
                id: "demo-1", dia: 0, hora: .relativa(-72), local: "FC Barcelona", visitante: "Juventus",
                competicion: "Amistoso", canales: ["DAZN"], goles: ([12, 64], [38]), precalentado: ("ready", 6, 3, 6, 6)),
            Muestra(
                id: "demo-2", dia: 0, hora: .relativa(40), local: "Barcelona SC", visitante: "Emelec", competicion: "Amistoso",
                canales: ["Zapping"], goles: nil, precalentado: ("discovered", 0, 0, 0, 2)),
            Muestra(
                id: "demo-3", dia: 0, hora: .relativa(150), local: "España", visitante: "Marruecos", competicion: "Amistoso",
                canales: ["La 1 HD"], goles: nil, precalentado: nil),
            Muestra(
                id: "demo-4", dia: 0, hora: .relativa(-52), local: "Real Sociedad", visitante: "Villarreal",
                competicion: "LaLiga", canales: ["DAZN LaLiga", "M+ LaLiga 2"], goles: ([], []),
                precalentado: ("scanning", 2, 0, 5, 5)),
            Muestra(
                id: "demo-5", dia: 0, hora: .relativa(25), local: "Real Madrid", visitante: "Manchester City",
                competicion: "Champions League", canales: ["M+ Liga de Campeones", "M+ Liga de Campeones 2"], goles: nil,
                precalentado: ("scanning", 3, 2, 6, 6)),
            Muestra(
                id: "demo-6", dia: 1, hora: .fija("19:00"), local: "Real Betis", visitante: "Athletic Club",
                competicion: "LaLiga", canales: ["GOL Play"], goles: nil, precalentado: nil),
            Muestra(
                id: "demo-7", dia: 1, hora: .fija("21:30"), local: "Barcelona", visitante: "Atlético de Madrid",
                competicion: "LaLiga", canales: ["DAZN LaLiga 2"], goles: nil, precalentado: nil),
            Muestra(
                id: "demo-8", dia: 2, hora: .fija("20:45"), local: "Inter", visitante: "AC Milan",
                competicion: "Champions League", canales: ["M+ Liga de Campeones"], goles: nil, precalentado: nil),
            Muestra(
                id: "demo-9", dia: 2, hora: .fija("21:00"), local: "España", visitante: "Portugal",
                competicion: "Nations League", canales: ["La 1 HD"], goles: nil, precalentado: nil),
            Muestra(
                id: "demo-10", dia: 3, hora: .fija("18:30"), local: "Arsenal", visitante: "Liverpool",
                competicion: "Premier League", canales: ["DAZN"], goles: nil, precalentado: nil),
            Muestra(
                id: "demo-11", dia: 3, hora: .fija("21:00"), local: "Sevilla", visitante: "Girona", competicion: "LaLiga",
                canales: ["Amazon Prime Video"], goles: nil, precalentado: nil),
            Muestra(
                id: "demo-12", dia: 0, hora: .relativa(-31), local: "Girona", visitante: "Sevilla", competicion: "LaLiga",
                canales: ["DAZN 1"], goles: ([21], [9]), precalentado: ("ready", 4, 0, 4, 4)),
            Muestra(
                id: "demo-13", dia: 0, hora: .relativa(-185), local: "Mallorca", visitante: "Espanyol",
                competicion: "LaLiga", canales: ["M+ LaLiga"], goles: ([77], []), precalentado: nil),
        ]

        /// `CLUBS`: siglas y colores (principal / secundario) de los clubes de la muestra.
        static let clubes: [String: (corto: String, primario: String, secundario: String?)] = [
            "Real Madrid": ("RMA", "#febe10", "#1a1a5e"), "FC Barcelona": ("BAR", "#a50044", "#004d98"),
            "Barcelona": ("BAR", "#a50044", "#004d98"), "Juventus": ("JUV", "#101010", "#ffffff"),
            "Inter": ("INT", "#010e80", "#101010"), "AC Milan": ("MIL", "#fb090b", "#101010"),
            "Manchester City": ("MCI", "#6cabdd", "#1c2c5b"), "Arsenal": ("ARS", "#ef0107", "#063672"),
            "Liverpool": ("LIV", "#c8102e", "#00b2a9"), "Atlético de Madrid": ("ATM", "#cb3524", "#272e61"),
            "Real Sociedad": ("RSO", "#0067b1", "#ffffff"), "Villarreal": ("VIL", "#ffe667", "#005187"),
            "Sevilla": ("SEV", "#d4021d", "#ffffff"), "Girona": ("GIR", "#cd2534", "#ffffff"),
            "Mallorca": ("MLL", "#e20613", "#1b1b1b"), "Espanyol": ("ESP", "#007fc8", "#ffffff"),
            "Real Betis": ("BET", "#00954c", "#ffffff"), "Athletic Club": ("ATH", "#ee2523", "#101010"),
            "España": ("ESP", "#aa151b", "#f1bf00"), "Marruecos": ("MAR", "#c1272d", "#006233"),
            "Portugal": ("POR", "#006600", "#ff0000"), "Barcelona SC": ("BSC", "#f9d616", "#101010"),
            "Emelec": ("EME", "#0033a0", "#9ea3a8"),
        ]

        /// `keyId`: «Atlético de Madrid» → «k-atletico-de-madrid».
        static func clave(_ prefijo: String, _ nombre: String) -> String {
            let plano = Texto.sinMarcas(nombre).lowercased()
            var slug = ""
            var hueco = false
            for escalar in plano.unicodeScalars {
                if ("a"..."z").contains(escalar) || ("0"..."9").contains(escalar) {
                    slug.unicodeScalars.append(escalar)
                    hueco = false
                } else if !hueco {
                    slug.append("-")
                    hueco = true
                }
            }
            while slug.hasPrefix("-") { slug.removeFirst() }
            while slug.hasSuffix("-") { slug.removeLast() }
            return "\(prefijo)-\(slug.isEmpty ? "x" : slug)"
        }

        /// `demoTeamBadge`.
        static func escudo(_ nombre: String) -> JSON? {
            guard let club = clubes[nombre] else { return nil }
            let canonico = nombre == "Barcelona" ? "FC Barcelona" : nombre
            let colores = JSON.obj(["primary": .texto(club.primario), "secondary": .txt(club.secundario)])
            var o = JSON.objeto([])
            o["id"] = .texto(clave("k", canonico))
            o["name"] = .texto(canonico)
            o["short"] = .texto(club.corto)
            o["crest"] = .nulo
            o["colors"] = colores
            return o
        }

        /// `demoCompetitionBadge`.
        static func competicion(_ nombre: String) -> JSON {
            .obj(["id": .texto(clave("k", nombre)), "name": .texto(nombre), "logo": .nulo])
        }

        /// El ancla: `floor(ahora / 5 min) × 5 min` (ms epoch).
        static func ancla(_ ahora: Date) -> Double {
            let ms = self.ms(ahora)
            return (ms / (5 * minuto)).rounded(.down) * 5 * minuto
        }

        static func fecha(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

        /// Milisegundos enteros de un instante (`Date.now()` de la web; al más cercano: 1,999999 ms es 2).
        static func ms(_ fecha: Date) -> Double { (fecha.timeIntervalSince1970 * 1000).rounded() }

        /// `new Date(ms).toISOString()` exacto (con aritmética entera: `2026-09-24T17:00:01.350Z`).
        static func iso(_ ms: Double) -> String {
            let total = Int64(ms.rounded(.down))
            let milis = Int(((total % 1000) + 1000) % 1000)
            let segundos = (total - Int64(milis)) / 1000
            let dias = Int(segundos >= 0 ? segundos / 86_400 : (segundos - 86_399) / 86_400)
            let resto = Int(segundos - Int64(dias) * 86_400)
            // Días desde 1970 → fecha civil (algoritmo de Howard Hinnant).
            let z = dias + 719_468
            let era = (z >= 0 ? z : z - 146_096) / 146_097
            let doe = z - era * 146_097
            let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
            let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
            let mp = (5 * doy + 2) / 153
            let dia = doy - (153 * mp + 2) / 5 + 1
            let mes = mp < 10 ? mp + 3 : mp - 9
            let ano = yoe + era * 400 + (mes <= 2 ? 1 : 0)
            func dos(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
            let ms3 = milis < 10 ? "00\(milis)" : (milis < 100 ? "0\(milis)" : "\(milis)")
            let hora = "\(dos(resto / 3600)):\(dos(resto % 3600 / 60)):\(dos(resto % 60))"
            return "\(ano)-\(dos(mes))-\(dos(dia))T\(hora).\(ms3)Z"
        }

        /// Epoch (ms) de «HH:MM» de Madrid en ese día (`madridEpoch`).
        static func epochMadrid(_ dia: String, _ hora: String) -> Double {
            let partes = hora.split(separator: ":").compactMap { Int($0) }
            let dias = dia.split(separator: "-").compactMap { Int($0) }
            var c = DateComponents()
            c.year = dias.first
            c.month = dias.count > 1 ? dias[1] : 1
            c.day = dias.count > 2 ? dias[2] : 1
            c.hour = partes.first ?? 0
            c.minute = partes.count > 1 ? partes[1] : 0
            let instante = FechasES.calendario(FechasES.madrid).date(from: c) ?? Date(timeIntervalSince1970: 0)
            return (instante.timeIntervalSince1970 * 1000).rounded()
        }

        struct Colocado: Sendable {
            var muestra: Muestra
            var inicio: Double
            var dia: String
            var hora: String
        }

        /// `place()`.
        static func colocar(ancla: Double) -> [Colocado] {
            let hoy = FechasES.diaISO(fecha(ancla), zona: FechasES.madrid)
            return muestras.map { muestra in
                switch muestra.hora {
                case .relativa(let minutos):
                    let inicio = ancla + Double(minutos) * minuto
                    let instante = fecha(inicio)
                    return Colocado(
                        muestra: muestra, inicio: inicio, dia: FechasES.diaISO(instante, zona: FechasES.madrid),
                        hora: FechasES.hora(instante, zona: FechasES.madrid))
                case .fija(let hora):
                    let dia = FechasES.sumarDias(hoy, muestra.dia)
                    return Colocado(muestra: muestra, inicio: epochMadrid(dia, hora), dia: dia, hora: hora)
                }
            }
        }

        /// `demoSchedule()`.
        static func agenda(ancla: Double) -> JSON {
            let colocados = colocar(ancla: ancla)
            let hoy = FechasES.diaISO(fecha(ancla), zona: FechasES.madrid)
            var dias = Set((0..<5).map { FechasES.sumarDias(hoy, $0) })
            for item in colocados { dias.insert(item.dia) }
            let listaDias: [JSON] = dias.sorted().map { dia in
                let partidos = colocados.filter { $0.dia == dia }.sorted { $0.inicio < $1.inicio }.map(partido)
                return .obj(["date": .texto(dia), "matches": .lista(partidos)])
            }
            var o = JSON.objeto([])
            o["generatedAt"] = .texto(iso(ancla))
            o["timezone"] = "Europe/Madrid"
            o["country"] = "España"
            o["source"] = "demo"
            o["attribution"] = "Datos de muestra"
            o["demo"] = .bool(true)
            o["limited"] = .bool(false)
            o["partial"] = .bool(false)
            o["days"] = .lista(listaDias)
            return o
        }

        private static func partido(_ item: Colocado) -> JSON {
            let m = item.muestra
            let canales: [JSON] = m.canales.enumerated().map { indice, nombre in
                JSON.obj(["id": .texto("demo-channel-\(m.id)-\(indice)"), "name": .texto(nombre)])
            }
            var salida = JSON.objeto([])
            salida["id"] = .texto(m.id)
            salida["date"] = .texto(item.dia)
            salida["time"] = .texto(item.hora)
            salida["start"] = .numero(item.inicio)
            salida["title"] = .texto("\(m.local) vs \(m.visitante)")
            salida["home"] = .texto(m.local)
            salida["away"] = .texto(m.visitante)
            salida["competition"] = .texto(m.competicion)
            salida["country"] = "España"
            salida["channels"] = .lista(canales)
            if let local = escudo(m.local) { salida["homeTeam"] = local }
            if let visitante = escudo(m.visitante) { salida["awayTeam"] = visitante }
            salida["competitionBadge"] = competicion(m.competicion)
            return salida
        }

        /// `demoPreheat(matchId)`.
        static func precalentado(_ id: String, ancla: Double) -> JSON {
            guard let muestra = muestras.first(where: { $0.id == id }), let p = muestra.precalentado else { return .nulo }
            var o = JSON.objeto([])
            o["matchId"] = .texto(id)
            o["stage"] = "scan"
            o["updatedAt"] = .texto(iso(ancla))
            o["error"] = ""
            o["status"] = .texto(p.estado)
            o["checked"] = .num(p.comprobadas)
            o["playable"] = .num(p.jugables)
            o["total"] = .num(p.total)
            o["candidateCount"] = .num(p.candidatas)
            return o
        }
    }

    extension JSON: ExpressibleByStringLiteral {
        init(stringLiteral value: String) { self = .texto(value) }
    }
#endif
