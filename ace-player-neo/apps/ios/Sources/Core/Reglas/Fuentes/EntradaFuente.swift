import Foundation

/* Tipos del selector de fuentes (apps/web/src/features/sources/model.ts), puros [L]. Vocabulario de la web:
   - «entrada»: una fuente del partido (o hermana del canal) con lo que se sabe de ella: lo que dijo la
     resolución, lo que dice el comprobador (`sonda`) y lo que vio el reproductor (`veredicto`).
   - «estado efectivo»: lo que se enseña y lo que usa el arranque automático (ReglasFuentes.efectivo).
   El identificador de una fuente es OPACO (hoy un hash de 40 hex; mañana puede ser otra cosa, p. ej. una
   fuente IPTV): se compara tal cual y solo se exige un hash donde la web lo exige (copiar el hash). */

/// Lo que dice el comprobador («segundo motor») de una fuente (`SourceProbe`).
struct SondaFuente: Sendable, Hashable {
    var estado: ScanCandidateState
    var motivo: String
    var pares: Double
    /// KB/s en la prueba.
    var velocidadBajada: Double
    /// Kbit/s que midió el comprobador en la señal (nil si no llegó a medir).
    var rateKbps: Double?
    var intakeKbps: Double?
    var streamKbps: Double
    /// Códec de vídeo que vio el comprobador («h264», «hevc»…; vacío si no lo sabe).
    var codec: String
    var intentos: Int
    var reintentoEn: String?
    /// D6: nil si el comprobador aún no lo sabe.
    var reproducibleEnWeb: Bool?
    /// D6 de iOS: el remux del iPhone la puede ver aunque la web no (HEVC).
    var reproducibleEnIOS: Bool?

    init(
        estado: ScanCandidateState, motivo: String = "", pares: Double = 0, velocidadBajada: Double = 0,
        rateKbps: Double? = nil, intakeKbps: Double? = nil, streamKbps: Double = 0, codec: String = "",
        intentos: Int = 0, reintentoEn: String? = nil, reproducibleEnWeb: Bool? = nil, reproducibleEnIOS: Bool? = nil
    ) {
        self.estado = estado
        self.motivo = motivo
        self.pares = pares
        self.velocidadBajada = velocidadBajada
        self.rateKbps = rateKbps
        self.intakeKbps = intakeKbps
        self.streamKbps = streamKbps
        self.codec = codec
        self.intentos = intentos
        self.reintentoEn = reintentoEn
        self.reproducibleEnWeb = reproducibleEnWeb
        self.reproducibleEnIOS = reproducibleEnIOS
    }

    /// `probeFrom` (model.ts) con la regla D6 del iPhone: una fuente que la web no puede ver SOLO por el
    /// códec, y que el servidor marca reproducible en iOS, cuenta como verificada aquí.
    init(_ candidato: ScanCandidate) {
        var estado = candidato.state
        if candidato.playableOn?.ios == true, estado == .failed || estado == .weak,
            candidato.reason == "unsupported_codec"
        {
            estado = .working
        }
        self.init(
            estado: estado, motivo: candidato.reason, pares: candidato.peers, velocidadBajada: candidato.speedDown,
            rateKbps: candidato.rateKbps, intakeKbps: candidato.intakeKbps, streamKbps: candidato.streamKbps,
            codec: candidato.videoCodec, intentos: candidato.attempts, reintentoEn: candidato.retryAt,
            reproducibleEnWeb: candidato.playableOn?.web, reproducibleEnIOS: candidato.playableOn?.ios)
    }

    /// `QUEUED_PROBE` (model.ts): en cola, sin nada medido.
    static let enCola = SondaFuente(estado: .queued)
}

/// Lo que vio el reproductor al usar la fuente (`playerVerdict`).
struct VeredictoReproductor: Sendable, Hashable {
    var estado: VerdictState
    var motivo: String
    var fecha: Date
}

/// Una fuente del partido o una hermana del canal (`SourceEntry`).
struct EntradaFuente: Sendable, Hashable, Identifiable {
    var id: String
    /// Título tal cual llega («M+ Liga de Campeones --> Elcano»).
    var titulo: String
    var alias: String?
    /// true: infohash; false: Content ID; nil: no se sabe (pegado a mano).
    var ih: Bool?
    /// `CandidateSource` («saved», «m3u»…) o «manual». Un tipo nuevo del servidor llega como «desconocido» y
    /// se presenta como «Fuente» (TYPE_LABEL de la web sin esa clave).
    var origen: String
    var listaId: String?
    /// Canal del partido con el que casó («M+ Liga de Campeones»).
    var canal: String
    /// 0…1 o porcentaje; nil si no se midió.
    var disponibilidad: Double?
    var aprendida: LearnedVerdict?
    /// Fin de la cuarentena por un reporte (`reported.until`).
    var reportadaHasta: Date?
    var motivoReporte: SourceReportReason?
    var sonda: SondaFuente?
    /// Una de las primeras que se enseñan sin esperar al comprobador (regla 22).
    var inicial = false
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

    /// `entryFromCandidate` (model.ts), con `reportOf`.
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

    /// `manualEntry` (model.ts): una señal pegada a mano, `ih: nil` porque mirándola no se sabe qué es.
    static func manual(id: String, titulo: String, canal: String) -> EntradaFuente {
        EntradaFuente(id: id, titulo: titulo, ih: nil, origen: "manual", canal: canal)
    }

    /// `entryFromItem` (model.ts): un canal de la biblioteca (los del directorio son de la lista activa).
    init(_ item: Item, listaActiva: String?) {
        let origen: String =
            switch item.type {
            case .fav: "favorites"
            case .recent: "history"
            default: "m3u"
            }
        let titulo = item.title.isEmpty ? "Canal \(item.id.prefix(8))" : item.title
        let alias = item.alias.flatMap { $0.isEmpty ? nil : $0 }
        self.init(
            id: item.id, titulo: titulo, alias: item.alias, ih: item.ih, origen: origen,
            listaId: item.type == .web ? listaActiva : nil, canal: alias ?? item.title)
    }
}

/// Qué hace el reproductor con UNA fuente, la que está en pantalla (`OnScreen`).
struct EnPantalla: Sendable, Hashable {
    var id: String?
    /// Hay imagen de verdad con esta fuente (arrancó).
    var sonando: Bool
    /// Se está conectando sin imagen todavía.
    var conectando: Bool

    static let nada = EnPantalla(id: nil, sonando: false, conectando: false)

    init(id: String?, sonando: Bool, conectando: Bool) {
        self.id = id
        self.sonando = sonando
        self.conectando = conectando
    }

    /// `onScreenOf` (model.ts) sobre la fase pública del reproductor. En iOS no hay «bloqueado».
    init(fase: FaseReproductor, id: String?, arranco: Bool) {
        guard fase != .idle, fase != .error, let id else {
            self = .nada
            return
        }
        let sonando = arranco && [.reproduciendo, .pausado, .buffer, .buscando].contains(fase)
        self.init(
            id: id, sonando: sonando, conectando: !sonando && [.cargando, .reconectando, .buffer].contains(fase))
    }
}

/// Estado efectivo de una entrada (`Effective`). `estado == nil` es el «none» de la web.
struct Efectivo: Sendable, Hashable {
    var estado: ScanCandidateState?
    /// Motivo (del comprobador, del reproductor o «player», «player_check», «reported»).
    var motivo: String
    var reportada: Bool

    /// Verificada o floja y no reportada (lo que la web llama «viva»).
    var viva: Bool { !reportada && (estado == .working || estado == .weak) }
}

/// El trabajo del comprobador tal como lo guarda la sesión (`SessionScan` = `ScanView` + id).
struct EstadoComprobador: Sendable, Hashable {
    var id: String
    var estado: ScanJobStatus
    var total: Int
    var comprobadas: Int
    var jugables: Int
    var reintentoEn: String?
}

/// Un motivo para reportar una fuente, con su texto (`REPORT_REASONS`).
struct MotivoReporte: Sendable, Hashable, Identifiable {
    var motivo: SourceReportReason
    var texto: String
    var id: SourceReportReason { motivo }
}

/// Cómo se presenta una fuente (`SourcePresentation`).
struct PresentacionFuente: Sendable, Hashable {
    /// «M3U», «Guardada», «Externa»…
    var tipo: String
    var lista: String
    var proveedor: String
    /// «M3U · Elcano».
    var etiqueta: String
    /// El proveedor en una palabra: tras la flecha, si no la lista, si no el tipo.
    var corto: String
}

/// Lo que pintan el selector y el inspector de una fuente (`SourceRow` de useSources.ts).
struct FilaFuente: Sendable, Hashable, Identifiable {
    var entrada: EntradaFuente
    /// Número estable: la posición en la lista completa (no se renumera al plegar).
    var numero: Int
    var efectivo: Efectivo
    var senal: EstadoSenal
    var palabra: String
    var detalle: String
    var presentacion: PresentacionFuente
    /// La elegida (la que está o estaba en pantalla).
    var activa: Bool
    /// Suena o se conecta ahora mismo.
    var enPantalla: Bool
    var descripcion: String
    var id: String { entrada.id }
}

/// Qué hacer cuando el comprobador termina con una fuente reportada (`reportFollowUp`).
struct SeguimientoReporte: Sendable, Hashable {
    var sigueApartada: Bool
    var texto: String
    var tono: TonoAviso
}
