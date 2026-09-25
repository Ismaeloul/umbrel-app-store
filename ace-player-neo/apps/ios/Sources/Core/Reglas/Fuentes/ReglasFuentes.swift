import Foundation

/* Reglas puras del selector de fuentes: las de la web
   (apps/web/src/features/sources/model.ts), sin red ni temporizadores, para
   probarlas solas. Vocabulario:
   - «entrada»: una fuente del partido con lo que se sabe de ella: lo que dijo
     la resolución, lo que dice el comprobador (`sonda`) y lo que vio el
     reproductor (`veredicto`).
   - «estado efectivo»: lo que se enseña y lo que usa el arranque automático.
     Manda, por este orden: el reporte en cuarentena, el reproductor en
     pantalla (sonando = verificada; conectando = comprobando), lo que vio el
     reproductor en los últimos 3 min y el comprobador. */

/// Lo que dice el comprobador de una fuente.
struct SondaFuente: Sendable, Hashable {
    var estado: ScanCandidateState
    var motivo: String
    var pares: Double
    var reintentoEn: String?
    /// D6: en iPhone se puede ver aunque la web no (HEVC por el remux).
    var reproducibleEnIOS: Bool?
    /// Códec de vídeo («h264», «hevc»), para «Datos técnicos».
    var codec: String = ""
    /// Caudal medido (kbit/s): de él se deriva la calidad del cartel («1080p»).
    var kbps: Double?

    init(
        estado: ScanCandidateState, motivo: String = "", pares: Double = 0, reintentoEn: String? = nil,
        reproducibleEnIOS: Bool? = nil, codec: String = "", kbps: Double? = nil
    ) {
        self.estado = estado
        self.motivo = motivo
        self.pares = pares
        self.reintentoEn = reintentoEn
        self.reproducibleEnIOS = reproducibleEnIOS
        self.codec = codec
        self.kbps = kbps
    }

    /// Del candidato del comprobador, con la regla D6 aplicada: una fuente que
    /// la web no puede ver solo por el códec cuenta como verificada en iOS.
    init(_ candidato: ScanCandidate) {
        var estado = candidato.state
        if candidato.playableOn?.ios == true, estado == .failed || estado == .weak,
            candidato.reason == "unsupported_codec"
        {
            estado = .working
        }
        let kbps = [candidato.rateKbps, candidato.streamKbps > 0 ? candidato.streamKbps : nil, candidato.intakeKbps]
            .compactMap { $0 }.first { $0 > 0 }
        self.init(
            estado: estado, motivo: candidato.reason, pares: candidato.peers, reintentoEn: candidato.retryAt,
            reproducibleEnIOS: candidato.playableOn?.ios, codec: candidato.videoCodec, kbps: kbps)
    }
}

/// Resumen de las fuentes de un partido para la cápsula de la agenda y del
/// escenario (`sessionSummary` del prototipo).
struct ResumenFuentes: Sendable, Hashable {
    enum Tono: Sendable, Hashable { case ok, floja, fallo, comprobando, neutro }

    var tono: Tono
    /// «Señal», «Floja», «Sin señal», «Comprobando» o "" (sin datos).
    var etiqueta: String
    /// «2 de 5 verificadas», «3 fuentes en cola»…
    var detalle: String
    var total: Int
    var verificadas: Int

    static let vacio = ResumenFuentes(tono: .neutro, etiqueta: "", detalle: "", total: 0, verificadas: 0)
}

/// Una fuente del partido.
struct EntradaFuente: Sendable, Hashable, Identifiable {
    var id: String
    /// Título tal cual llega («M+ Liga de Campeones --> Elcano»).
    var titulo: String
    var alias: String?
    /// true: infohash; false: Content ID; nil: pegado a mano.
    var ih: Bool?
    /// `CandidateSource` o «manual».
    var origen: String
    var listaId: String?
    /// Canal del partido con el que casó.
    var canal: String
    /// 0…1 o porcentaje; nil si no se midió.
    var disponibilidad: Double?
    var aprendida: LearnedVerdict?
    /// Fin de la cuarentena por un reporte.
    var reportadaHasta: Date?
    var motivoReporte: SourceReportReason?
    var sonda: SondaFuente?
    /// Lo que vio el reproductor (y cuándo).
    var veredicto: VeredictoReproductor?
    /// Ya la probó el arranque automático (no se vuelve a intentar sola).
    var probadaAuto = false

    init(
        id: String, titulo: String, alias: String? = nil, ih: Bool?, origen: String, listaId: String? = nil,
        canal: String, disponibilidad: Double? = nil, aprendida: LearnedVerdict? = nil, reportadaHasta: Date? = nil,
        motivoReporte: SourceReportReason? = nil, sonda: SondaFuente? = nil
    ) {
        self.id = id
        self.titulo = titulo
        self.alias = alias
        self.ih = ih
        self.origen = origen
        self.listaId = listaId
        self.canal = canal
        self.disponibilidad = disponibilidad
        self.aprendida = aprendida
        self.reportadaHasta = reportadaHasta
        self.motivoReporte = motivoReporte
        self.sonda = sonda
    }

    /// De un candidato de la resolución.
    init(_ candidato: ResolutionCandidate, ahora: Date) {
        var hasta: Date?
        var motivo: SourceReportReason?
        if let reporte = candidato.reported, let fin = reporte.quarantineUntil.flatMap(FechaISO.parse), fin > ahora {
            hasta = fin
            motivo = reporte.reason
        } else if candidato.quarantined {
            hasta = ahora.addingTimeInterval(ReglasFuentes.cuarentenaLocal)
            motivo = candidato.reported?.reason ?? .notStarting
        }
        self.init(
            id: candidato.id, titulo: candidato.title.isEmpty ? "Fuente" : candidato.title, alias: candidato.alias,
            ih: candidato.ih, origen: candidato.source.rawValue, listaId: candidato.listaId,
            canal: candidato.matchedChannel, disponibilidad: candidato.availability, aprendida: candidato.learned,
            reportadaHasta: hasta, motivoReporte: motivo)
    }

    /// Lo que se le pasa al reproductor.
    func canalReproducible(partido: ContextoPartido?) -> CanalReproducible {
        var contexto = partido
        if !canal.isEmpty { contexto?.canal = canal }
        return CanalReproducible(
            id: id, titulo: ReglasFuentes.nombreVisible(self), ih: ih, partido: contexto, listaId: listaId,
            origen: origen)
    }
}

/// Un motivo para reportar una fuente, con su texto.
struct MotivoReporte: Sendable, Hashable, Identifiable {
    var motivo: SourceReportReason
    var texto: String
    var id: SourceReportReason { motivo }
}

/// Lo que vio el reproductor al usar la fuente.
struct VeredictoReproductor: Sendable, Hashable {
    var estado: VerdictState
    var motivo: String
    var fecha: Date
}

/// Qué hay en pantalla ahora (para la regla «la que se ve manda»).
struct EnPantalla: Sendable, Hashable {
    var id: String?
    var sonando: Bool
    var conectando: Bool

    static let nada = EnPantalla(id: nil, sonando: false, conectando: false)

    init(id: String?, sonando: Bool, conectando: Bool) {
        self.id = id
        self.sonando = sonando
        self.conectando = conectando
    }
    // `EnPantalla(reproductor)` vive en Player/Fuentes/SesionFuentes.swift (necesita el Reproductor).
}

/// Estado efectivo de una entrada.
struct Efectivo: Sendable, Hashable {
    /// nil = sin datos.
    var estado: ScanCandidateState?
    var motivo: String
    var reportada: Bool
}

enum ReglasFuentes {
    /// El veredicto del reproductor manda sobre el del comprobador durante 3 min.
    static let vigenciaVeredicto: TimeInterval = 3 * 60
    /// Cuarentena local si el servidor no devuelve el reporte.
    static let cuarentenaLocal: TimeInterval = 30 * 60
    /// Vista 60 s o más y luego cortada: floja y visible, no «sin señal».
    static let caidaTrasSegundos = 60

    static func reportada(_ entrada: EntradaFuente, ahora: Date) -> Bool {
        (entrada.reportadaHasta ?? .distantPast) > ahora
    }

    static func efectivo(_ entrada: EntradaFuente, pantalla: EnPantalla, ahora: Date) -> Efectivo {
        if reportada(entrada, ahora: ahora) { return Efectivo(estado: .failed, motivo: "reported", reportada: true) }
        if entrada.id == pantalla.id && pantalla.sonando {
            return Efectivo(estado: .working, motivo: "player", reportada: false)
        }
        // La que se conecta en pantalla es «comprobando» aunque el comprobador la diera por caída.
        if entrada.id == pantalla.id && pantalla.conectando {
            return Efectivo(estado: .checking, motivo: "player_check", reportada: false)
        }
        if let veredicto = entrada.veredicto, ahora.timeIntervalSince(veredicto.fecha) < vigenciaVeredicto {
            let estado: ScanCandidateState =
                switch veredicto.estado {
                case .working: .working
                case .weak: .weak
                case .failed: .failed
                case .desconocido: .queued
                }
            return Efectivo(estado: estado, motivo: veredicto.motivo, reportada: false)
        }
        if let sonda = entrada.sonda { return Efectivo(estado: sonda.estado, motivo: sonda.motivo, reportada: false) }
        return Efectivo(estado: nil, motivo: "", reportada: false)
    }

    /// 0…1 o porcentaje → 0…100.
    static func porcentaje(_ valor: Double?) -> Int? {
        guard let valor, valor.isFinite else { return nil }
        let p = valor >= 0 && valor <= 1 ? valor * 100 : valor
        return Int(max(0, min(100, p)).rounded())
    }

    /// Medidor + palabra de la fuente.
    static func senal(_ efectivo: Efectivo, _ entrada: EntradaFuente) -> (estado: EstadoSenal, palabra: String) {
        if efectivo.reportada { return (.fail, "Reportada") }
        if let estado = efectivo.estado {
            switch estado {
            case .working: return (.ok, "Verificada")
            case .weak: return (.weak, "Floja")
            case .checking: return (.checking, "Comprobando")
            case .queued, .desconocido: return (.pending, "Pendiente")
            case .failed: return (.fail, "Sin señal")
            }
        }
        guard let p = porcentaje(entrada.disponibilidad) else { return (.pending, "Sin comprobar") }
        let medidor: EstadoSenal = p >= 60 ? .ok : (p > 0 ? .weak : .fail)
        return (medidor, "\(p)% disponible")
    }

    static let motivosReporte: [MotivoReporte] = [
        MotivoReporte(motivo: .notStarting, texto: "No arranca"),
        MotivoReporte(motivo: .stuttering, texto: "Se corta"),
        MotivoReporte(motivo: .wrongChannel, texto: "Canal incorrecto"),
        MotivoReporte(motivo: .badQuality, texto: "Mala calidad"),
        MotivoReporte(motivo: .audio, texto: "Problema de audio"),
    ]

    static func etiqueta(_ motivo: SourceReportReason) -> String {
        motivosReporte.first { $0.motivo == motivo }?.texto ?? "No arranca"
    }

    private static let frases: [String: String] = [
        "player": "reproduciendo ahora",
        "player_check": "comprobando en pantalla",
        "unsupported_codec": "vídeo no compatible",
        "no_video": "sin pista de vídeo",
        "unverified_media": "señal detectada · vídeo sin confirmar",
        "player_failed": "no arrancó en el reproductor",
        "player_dropped": "se cortó en el reproductor",
        "player_ok": "funcionó en el reproductor",
        "intermittent": "intermitente: falló la última prueba",
        "starved": "llega menos señal de la que el canal necesita",
        "retry": "reintentando",
        "delayed_retry": "reintentando",
    ]

    /// Frase humana de la fuente.
    static func detalle(_ efectivo: Efectivo, _ entrada: EntradaFuente) -> String {
        if efectivo.reportada, let motivo = entrada.motivoReporte {
            return "apartada por tu reporte (\(etiqueta(motivo).lowercased()))"
        }
        guard let estado = efectivo.estado else {
            return porcentaje(entrada.disponibilidad).map { "\($0)% disponible" } ?? "disponibilidad sin medir"
        }
        let porEstado: String =
            switch estado {
            case .working: "verificada"
            case .weak: "señal sin confirmar"
            case .checking: "probándose en el segundo motor"
            case .queued, .desconocido: "en cola"
            case .failed: "sin señal"
            }
        return frases[efectivo.motivo] ?? porEstado
    }

    /// Proveedor tras la flecha: «M+ Liga de Campeones --> Elcano» → «Elcano».
    static func proveedor(_ titulo: String) -> String {
        guard let rango = titulo.range(of: "-->") else { return "" }
        return titulo[rango.upperBound...].trimmingCharacters(in: .whitespaces)
    }

    /// Parte del canal: «M+ Liga de Campeones --> Elcano» → «M+ Liga de Campeones».
    static func parteCanal(_ titulo: String) -> String {
        guard let rango = titulo.range(of: "-->") else { return titulo.trimmingCharacters(in: .whitespaces) }
        return titulo[..<rango.lowerBound].trimmingCharacters(in: .whitespaces)
    }

    /// Nombre corto para la lista y la pantalla de bloqueo.
    static func nombreVisible(_ entrada: EntradaFuente) -> String {
        let quien = proveedor(entrada.titulo)
        let nombre = parteCanal(entrada.titulo)
        return quien.isEmpty ? nombre : "\(nombre) · \(quien)"
    }

    /// Arranque por verificadas: la primera verificada no reportada ni probada;
    /// con el comprobador terminado, la primera floja.
    static func elegirAutomatica(
        _ entradas: [EntradaFuente], efectivos: [String: Efectivo], terminado: Bool
    ) -> EntradaFuente? {
        let candidatas = entradas.filter { !$0.probadaAuto && efectivos[$0.id]?.reportada != true }
        if let verificada = candidatas.first(where: { efectivos[$0.id]?.estado == .working }) { return verificada }
        return terminado ? candidatas.first { efectivos[$0.id]?.estado == .weak } : nil
    }

    /// Qué veredicto deja el reproductor al agotar una fuente.
    static func veredictoFallo(_ resultado: OutcomeResult, segundos: Int) -> (VerdictState, String) {
        if resultado == .cayo && segundos >= caidaTrasSegundos { return (VerdictState.weak, "player_dropped") }
        return (VerdictState.failed, "player_failed")
    }

    /// Quita duplicados (mismo id), quedándose con la primera aparición.
    static func sinDuplicados(_ entradas: [EntradaFuente]) -> [EntradaFuente] {
        var vistos = Set<String>()
        return entradas.filter { vistos.insert($0.id.lowercased()).inserted }
    }

    /// Un Content ID o enlace `acestream://` válido (40 hex) → el hash.
    static func hashValido(_ texto: String) -> String? {
        var limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpio.lowercased().hasPrefix("acestream://") { limpio = String(limpio.dropFirst("acestream://".count)) }
        if let interrogacion = limpio.firstIndex(of: "?") { limpio = String(limpio[..<interrogacion]) }
        guard limpio.count == 40, limpio.allSatisfy(\.isHexDigit) else { return nil }
        return limpio.lowercased()
    }

    static let textoHashNoValido = "Introduce un Content ID o enlace AceStream válido de 40 caracteres."

    /// Progreso del comprobador (0…1, nunca en blanco del todo).
    static func progreso(_ trabajo: ScanJob?, total entradas: Int) -> Double {
        guard let trabajo else { return 0 }
        let total = max(trabajo.total, entradas)
        guard total > 0 else { return 0 }
        return max(0.04, min(1, Double(trabajo.checked) / Double(total)))
    }

    /// El comprobador ya no va a cambiar nada.
    static func terminado(_ trabajo: ScanJob?) -> Bool {
        guard let trabajo else { return true }
        return trabajo.status == .complete || trabajo.status == .waiting || trabajo.status == .cancelled
    }

    /// Resumen para la cápsula: verificadas → «Señal»; todo en cola → «Comprobando»;
    /// solo flojas → «Floja»; algo pendiente → «Comprobando»; si no, «Sin señal».
    static func resumen(_ entradas: [EntradaFuente], efectivos: [String: Efectivo]) -> ResumenFuentes {
        let n = entradas.count
        guard n > 0 else { return .vacio }
        var verificadas = 0
        var flojas = 0
        var caidas = 0
        var pendientes = 0
        for entrada in entradas {
            switch efectivos[entrada.id]?.estado {
            case .working: verificadas += 1
            case .weak: flojas += 1
            case .failed: caidas += 1
            case .checking, .queued, .desconocido, .none: pendientes += 1
            }
        }
        let hechas = n - pendientes
        if verificadas > 0 {
            return ResumenFuentes(
                tono: .ok, etiqueta: "Señal", detalle: "\(verificadas) de \(n) verificadas", total: n,
                verificadas: verificadas)
        }
        if pendientes > 0 && hechas == 0 {
            return ResumenFuentes(
                tono: .comprobando, etiqueta: "Comprobando", detalle: n == 1 ? "1 fuente en cola" : "\(n) fuentes en cola",
                total: n, verificadas: 0)
        }
        if flojas > 0 && pendientes == 0 {
            return ResumenFuentes(
                tono: .floja, etiqueta: "Floja", detalle: "\(flojas) de \(n) con señal floja", total: n, verificadas: 0)
        }
        if pendientes > 0 {
            return ResumenFuentes(
                tono: .comprobando, etiqueta: "Comprobando", detalle: "\(hechas) de \(n) probadas", total: n,
                verificadas: 0)
        }
        return ResumenFuentes(
            tono: .fallo, etiqueta: "Sin señal", detalle: caidas == 1 ? "1 fuente sin señal" : "\(caidas) fuentes sin señal",
            total: n, verificadas: 0)
    }

    /// Calidad del cartel a partir del caudal («1080p», «720p», «576i»); nil sin medida.
    static func calidad(_ sonda: SondaFuente?) -> String? {
        guard let kbps = sonda?.kbps, kbps > 0 else { return nil }
        if kbps >= 5000 { return "1080p" }
        if kbps >= 2500 { return "720p" }
        return "576i"
    }

    /// «1080p · Elcano» (o solo una de las dos partes).
    static func chipsCartel(_ entrada: EntradaFuente) -> String {
        [calidad(entrada.sonda), proveedor(entrada.titulo)].compactMap { $0 }.filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    /// Las fuentes entre las que se puede zapear deslizando (no caídas ni reportadas).
    static func zapeables(_ entradas: [EntradaFuente], efectivos: [String: Efectivo]) -> [EntradaFuente] {
        entradas.filter { entrada in
            let efectivo = efectivos[entrada.id]
            return efectivo?.reportada != true && efectivo?.estado != .failed
        }
    }
}
