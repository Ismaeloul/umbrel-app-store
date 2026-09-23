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
public struct SondaFuente: Sendable, Hashable {
    public var estado: ScanCandidateState
    public var motivo: String
    public var pares: Double
    public var reintentoEn: String?
    /// D6: en iPhone se puede ver aunque la web no (HEVC por el remux).
    public var reproducibleEnIOS: Bool?

    public init(
        estado: ScanCandidateState, motivo: String = "", pares: Double = 0, reintentoEn: String? = nil,
        reproducibleEnIOS: Bool? = nil
    ) {
        self.estado = estado
        self.motivo = motivo
        self.pares = pares
        self.reintentoEn = reintentoEn
        self.reproducibleEnIOS = reproducibleEnIOS
    }

    /// Del candidato del comprobador, con la regla D6 aplicada: una fuente que
    /// la web no puede ver solo por el códec cuenta como verificada en iOS.
    public init(_ candidato: ScanCandidate) {
        var estado = candidato.state
        if candidato.playableOn?.ios == true, estado == .failed || estado == .weak,
            candidato.reason == "unsupported_codec"
        {
            estado = .working
        }
        self.init(
            estado: estado, motivo: candidato.reason, pares: candidato.peers, reintentoEn: candidato.retryAt,
            reproducibleEnIOS: candidato.playableOn?.ios)
    }
}

/// Una fuente del partido.
public struct EntradaFuente: Sendable, Hashable, Identifiable {
    public var id: String
    /// Título tal cual llega («M+ Liga de Campeones --> Elcano»).
    public var titulo: String
    public var alias: String?
    /// true: infohash; false: Content ID; nil: pegado a mano.
    public var ih: Bool?
    /// `CandidateSource` o «manual».
    public var origen: String
    public var listaId: String?
    /// Canal del partido con el que casó.
    public var canal: String
    /// 0…1 o porcentaje; nil si no se midió.
    public var disponibilidad: Double?
    public var aprendida: LearnedVerdict?
    /// Fin de la cuarentena por un reporte.
    public var reportadaHasta: Date?
    public var motivoReporte: SourceReportReason?
    public var sonda: SondaFuente?
    /// Lo que vio el reproductor (y cuándo).
    public var veredicto: VeredictoReproductor?
    /// Ya la probó el arranque automático (no se vuelve a intentar sola).
    public var probadaAuto = false

    public init(
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
    public init(_ candidato: ResolutionCandidate, ahora: Date = .now) {
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
    public func canalReproducible(partido: ContextoPartido?) -> CanalReproducible {
        var contexto = partido
        if !canal.isEmpty { contexto?.canal = canal }
        return CanalReproducible(
            id: id, titulo: ReglasFuentes.nombreVisible(self), ih: ih, partido: contexto, listaId: listaId,
            origen: origen)
    }
}

/// Un motivo para reportar una fuente, con su texto.
public struct MotivoReporte: Sendable, Hashable, Identifiable {
    public var motivo: SourceReportReason
    public var texto: String
    public var id: SourceReportReason { motivo }
}

/// Lo que vio el reproductor al usar la fuente.
public struct VeredictoReproductor: Sendable, Hashable {
    public var estado: VerdictState
    public var motivo: String
    public var fecha: Date
}

/// Qué hay en pantalla ahora (para la regla «la que se ve manda»).
public struct EnPantalla: Sendable, Hashable {
    public var id: String?
    public var sonando: Bool
    public var conectando: Bool

    public static let nada = EnPantalla(id: nil, sonando: false, conectando: false)

    public init(id: String?, sonando: Bool, conectando: Bool) {
        self.id = id
        self.sonando = sonando
        self.conectando = conectando
    }

    /// Del reproductor: sonando si ya arrancó; conectando si aún no hay imagen.
    @MainActor
    public init(_ reproductor: Reproductor) {
        guard let canal = reproductor.canal, reproductor.conexion.enMarcha else {
            self = .nada
            return
        }
        let fase = reproductor.fase
        let sonando = reproductor.arranco && [.reproduciendo, .pausado, .buffer, .buscando].contains(fase)
        self.init(
            id: canal.id, sonando: sonando,
            conectando: !sonando && [.cargando, .reconectando, .buffer].contains(fase))
    }
}

/// Estado efectivo de una entrada.
public struct Efectivo: Sendable, Hashable {
    /// nil = sin datos.
    public var estado: ScanCandidateState?
    public var motivo: String
    public var reportada: Bool
}

public enum ReglasFuentes {
    /// El veredicto del reproductor manda sobre el del comprobador durante 3 min.
    public static let vigenciaVeredicto: TimeInterval = 3 * 60
    /// Cuarentena local si el servidor no devuelve el reporte.
    public static let cuarentenaLocal: TimeInterval = 30 * 60
    /// Vista 60 s o más y luego cortada: floja y visible, no «sin señal».
    public static let caidaTrasSegundos = 60

    public static func reportada(_ entrada: EntradaFuente, ahora: Date) -> Bool {
        (entrada.reportadaHasta ?? .distantPast) > ahora
    }

    public static func efectivo(_ entrada: EntradaFuente, pantalla: EnPantalla, ahora: Date) -> Efectivo {
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
    public static func porcentaje(_ valor: Double?) -> Int? {
        guard let valor, valor.isFinite else { return nil }
        let p = valor >= 0 && valor <= 1 ? valor * 100 : valor
        return Int(max(0, min(100, p)).rounded())
    }

    /// Medidor + palabra de la fuente.
    public static func senal(_ efectivo: Efectivo, _ entrada: EntradaFuente) -> (estado: EstadoSenal, palabra: String) {
        if efectivo.reportada { return (.sinSenal, "Reportada") }
        if let estado = efectivo.estado {
            switch estado {
            case .working: return (.ok, "Verificada")
            case .weak: return (.floja, "Floja")
            case .checking: return (.comprobando, "Comprobando")
            case .queued, .desconocido: return (.pendiente, "Pendiente")
            case .failed: return (.sinSenal, "Sin señal")
            }
        }
        guard let p = porcentaje(entrada.disponibilidad) else { return (.pendiente, "Sin comprobar") }
        let medidor: EstadoSenal = p >= 60 ? .ok : (p > 0 ? .floja : .sinSenal)
        return (medidor, "\(p)% disponible")
    }

    public static let motivosReporte: [MotivoReporte] = [
        MotivoReporte(motivo: .notStarting, texto: "No arranca"),
        MotivoReporte(motivo: .stuttering, texto: "Se corta"),
        MotivoReporte(motivo: .wrongChannel, texto: "Canal incorrecto"),
        MotivoReporte(motivo: .badQuality, texto: "Mala calidad"),
        MotivoReporte(motivo: .audio, texto: "Problema de audio"),
    ]

    public static func etiqueta(_ motivo: SourceReportReason) -> String {
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
    public static func detalle(_ efectivo: Efectivo, _ entrada: EntradaFuente) -> String {
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
    public static func proveedor(_ titulo: String) -> String {
        guard let rango = titulo.range(of: "-->") else { return "" }
        return titulo[rango.upperBound...].trimmingCharacters(in: .whitespaces)
    }

    /// Parte del canal: «M+ Liga de Campeones --> Elcano» → «M+ Liga de Campeones».
    public static func parteCanal(_ titulo: String) -> String {
        guard let rango = titulo.range(of: "-->") else { return titulo.trimmingCharacters(in: .whitespaces) }
        return titulo[..<rango.lowerBound].trimmingCharacters(in: .whitespaces)
    }

    /// Nombre corto para la lista y la pantalla de bloqueo.
    public static func nombreVisible(_ entrada: EntradaFuente) -> String {
        let quien = proveedor(entrada.titulo)
        let nombre = parteCanal(entrada.titulo)
        return quien.isEmpty ? nombre : "\(nombre) · \(quien)"
    }

    /// Arranque por verificadas: la primera verificada no reportada ni probada;
    /// con el comprobador terminado, la primera floja.
    public static func elegirAutomatica(
        _ entradas: [EntradaFuente], efectivos: [String: Efectivo], terminado: Bool
    ) -> EntradaFuente? {
        let candidatas = entradas.filter { !$0.probadaAuto && efectivos[$0.id]?.reportada != true }
        if let verificada = candidatas.first(where: { efectivos[$0.id]?.estado == .working }) { return verificada }
        return terminado ? candidatas.first { efectivos[$0.id]?.estado == .weak } : nil
    }

    /// Qué veredicto deja el reproductor al agotar una fuente.
    public static func veredictoFallo(_ resultado: OutcomeResult, segundos: Int) -> (VerdictState, String) {
        if resultado == .cayo && segundos >= caidaTrasSegundos { return (VerdictState.weak, "player_dropped") }
        return (VerdictState.failed, "player_failed")
    }

    /// Quita duplicados (mismo id), quedándose con la primera aparición.
    public static func sinDuplicados(_ entradas: [EntradaFuente]) -> [EntradaFuente] {
        var vistos = Set<String>()
        return entradas.filter { vistos.insert($0.id.lowercased()).inserted }
    }

    /// Un Content ID o enlace `acestream://` válido (40 hex) → el hash.
    public static func hashValido(_ texto: String) -> String? {
        var limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpio.lowercased().hasPrefix("acestream://") { limpio = String(limpio.dropFirst("acestream://".count)) }
        if let interrogacion = limpio.firstIndex(of: "?") { limpio = String(limpio[..<interrogacion]) }
        guard limpio.count == 40, limpio.allSatisfy(\.isHexDigit) else { return nil }
        return limpio.lowercased()
    }

    public static let textoHashNoValido = "Introduce un Content ID o enlace AceStream válido de 40 caracteres."

    /// Progreso del comprobador (0…1, nunca en blanco del todo).
    public static func progreso(_ trabajo: ScanJob?, total entradas: Int) -> Double {
        guard let trabajo else { return 0 }
        let total = max(trabajo.total, entradas)
        guard total > 0 else { return 0 }
        return max(0.04, min(1, Double(trabajo.checked) / Double(total)))
    }

    /// El comprobador ya no va a cambiar nada.
    public static func terminado(_ trabajo: ScanJob?) -> Bool {
        guard let trabajo else { return true }
        return trabajo.status == .complete || trabajo.status == .waiting || trabajo.status == .cancelled
    }
}
