import Foundation

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Lo que trae vectores-fuentes.json (scripts/vectores/fuentes.ts), con los nombres de la web, y cómo se convierte
   a los tipos de la app. Las fechas de la web van en milisegundos desde 1970. */

struct LoteFuentes: Decodable {
    struct Lista: Decodable {
        let id: String
        let name: String
    }

    struct Caso: Decodable {
        let entrada: EntradaWeb
        let presentacion: PresentacionWeb
        let calidad: String?
        let nombreCanal: String
        let mbit: String?
        let pantallas: [CasoPantalla]
    }

    struct CasoPantalla: Decodable {
        let pantalla: PantallaWeb
        let efectivo: EfectivoWeb
        let senal: SenalWeb
        let detalle: String
        let visibleSinActiva: Bool
        let visibleActiva: Bool
        let descripcionConComprobador: String
        let descripcionSinComprobador: String
    }

    struct Titulo: Decodable {
        let titulo: String
        let proveedor: String
        let parteCanal: String
    }

    struct NombreLista: Decodable {
        let id: String?
        let nombre: String
    }

    struct Porcentaje: Decodable {
        let valor: Double
        let porcentaje: Int?
    }

    struct Motivo: Decodable {
        let motivo: String
        let etiqueta: String
    }

    struct Origen: Decodable {
        let valor: String
        let resolucion: String
        let revisado: String
    }

    struct Veredicto: Decodable {
        struct Salida: Decodable {
            let state: String
            let reason: String
        }

        let resultado: String
        let segundos: Int
        let veredicto: Salida
    }

    struct Seguimiento: Decodable {
        struct Salida: Decodable {
            let stillReported: Bool
            let message: String
            let tone: String
        }

        let motivo: String
        let estado: String?
        let seguimiento: Salida
    }

    struct Arranque: Decodable {
        let indices: [Int]
        let pantalla: PantallaWeb
        let terminado: Bool
        let elegida: String?
    }

    struct Salto: Decodable {
        let indices: [Int]
        let pantalla: PantallaWeb
        let activa: String?
        let elegida: String?
    }

    struct Progreso: Decodable {
        let indices: [Int]
        let vista: VistaComprobadorWeb?
        let precalentado: PreheatPublic?
        let progreso: Double
        let texto: String
    }

    struct Hermanas: Decodable {
        let id: String
        let hermanas: [String]
    }

    struct Hash: Decodable {
        let texto: String
        let hash: String
    }

    let ahora: String
    let listas: [Lista]
    let entradas: [Caso]
    let titulos: [Titulo]
    let nombresLista: [NombreLista]
    let porcentajes: [Porcentaje]
    let motivos: [Motivo]
    let origenes: [Origen]
    let veredictos: [Veredicto]
    let seguimientos: [Seguimiento]
    let arranques: [Arranque]
    let saltos: [Salto]
    let progresos: [Progreso]
    let biblioteca: LibraryView
    let hermanas: [Hermanas]
    let hashes: [Hash]
    let textoHashNoValido: String
}

private func fecha(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

/// `SourceEntry`.
struct EntradaWeb: Decodable {
    struct Reporte: Decodable {
        let reason: String
        let until: Double
    }

    struct Sonda: Decodable {
        let state: String
        let reason: String
        let peers: Double
        let speedDown: Double
        let rateKbps: Double?
        let intakeKbps: Double?
        let streamKbps: Double
        let videoCodec: String
        let attempts: Int
        let retryAt: String?
        let playableOnWeb: Bool?
    }

    struct VeredictoWeb: Decodable {
        let state: String
        let reason: String
        let at: Double
    }

    let id: String
    let title: String
    let alias: String?
    let ih: Bool?
    let origin: String
    let listaId: String?
    let matchedChannel: String
    let availability: Double?
    let learned: String?
    let reported: Reporte?
    let probe: Sonda?
    let initial: Bool
    let playerVerdict: VeredictoWeb?
    let autoTried: Bool

    var fuente: EntradaFuente {
        var e = EntradaFuente(
            id: id, titulo: title, alias: alias, ih: ih, origen: origin, listaId: listaId, canal: matchedChannel,
            disponibilidad: availability, aprendida: learned.map { LearnedVerdict(rawValue: $0) ?? .desconocido },
            reportadaHasta: reported.map { fecha($0.until) },
            motivoReporte: reported.map { SourceReportReason(rawValue: $0.reason) ?? .desconocido })
        e.sonda = probe.map { p in
            SondaFuente(
                estado: ScanCandidateState(rawValue: p.state) ?? .desconocido, motivo: p.reason, pares: p.peers,
                velocidadBajada: p.speedDown, rateKbps: p.rateKbps, intakeKbps: p.intakeKbps, streamKbps: p.streamKbps,
                codec: p.videoCodec, intentos: p.attempts, reintentoEn: p.retryAt, reproducibleEnWeb: p.playableOnWeb)
        }
        e.inicial = initial
        e.veredicto = playerVerdict.map { v in
            VeredictoReproductor(
                estado: VerdictState(rawValue: v.state) ?? .desconocido, motivo: v.reason, fecha: fecha(v.at))
        }
        e.probadaAuto = autoTried
        return e
    }
}

/// `SourcePresentation`.
struct PresentacionWeb: Decodable {
    let type: String
    let list: String
    let provider: String
    let label: String
    let short: String
}

/// `OnScreen`.
struct PantallaWeb: Decodable, CustomStringConvertible {
    let hash: String?
    let playing: Bool
    let connecting: Bool

    var enPantalla: EnPantalla { EnPantalla(id: hash, sonando: playing, conectando: connecting) }
    var description: String { hash == nil ? "nada" : (playing ? "sonando" : (connecting ? "conectando" : "quieta")) }
}

struct EfectivoWeb: Decodable {
    let state: String
    let reason: String
    let reported: Bool
}

struct SenalWeb: Decodable {
    let state: String
    let word: String
}

/// `ScanView` (sin id: la prueba le pone uno).
struct VistaComprobadorWeb: Decodable {
    let status: String
    let total: Int
    let checked: Int
    let playable: Int
    let retryAt: String?

    var estado: EstadoComprobador {
        EstadoComprobador(
            id: "vector", estado: ScanJobStatus(rawValue: status) ?? .desconocido, total: total, comprobadas: checked,
            jugables: playable, reintentoEn: retryAt)
    }
}
