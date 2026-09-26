import Foundation

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Forma de Vectores/vectores-datos.json (scripts/vectores/datos.ts): lo que decide el TypeScript de la web al
   hablar con el servidor (api/sse.ts, api/query.ts, api/errors.ts). Se lee una vez. */

struct VectoresDatos: Decodable, Sendable {
    struct Evento: Decodable, Sendable {
        let fixture: String
        let cache: [String]
    }

    struct Dirigido: Decodable, Sendable {
        let fixture: String
        let visores: [String]?
        let evento: SSEEvent
        let llega: Bool
    }

    struct TiempoReal: Decodable, Sendable {
        let respaldoTras: Double
        let esperas: [Double]
        let abrirTrasCorte: [String]
        let sondeoReproduccion: Double
        let sondeoMotor: Double
        let respaldo: Double
    }

    struct Reintento: Decodable, Sendable {
        let codigo: String
        let estado: Int
        let fallos: Int
        let reintenta: Bool
    }

    struct Espera: Decodable, Sendable {
        let intento: Int
        let ms: Double
    }

    struct ConYSin<T: Decodable & Sendable>: Decodable, Sendable {
        let conTiempoReal: T
        let sinTiempoReal: T
    }

    struct Consultas: Decodable, Sendable {
        let reintentos: [Reintento]
        let esperasReintento: [Espera]
        let frescura: ConYSin<Double?>
        let alVolver: ConYSin<Bool>
        let gcTime: Double
    }

    struct Respuesta: Decodable, Sendable {
        let estado: Int
        let cuerpo: String
        let codigo: String
        let mensaje: String
        let requestId: String?
        let reintentable: Bool
    }

    struct Errores: Decodable, Sendable {
        let respuestas: [Respuesta]
        let textosCliente: [String: String]
    }

    let ambitos: [String: [String]]
    let eventos: [Evento]
    let dirigidos: [Dirigido]
    let tiempoReal: TiempoReal
    let consultas: Consultas
    let errores: Errores

    static let todos: VectoresDatos = {
        do {
            return try JSONDecoder().decode(VectoresDatos.self, from: Vectores.datos("vectores-datos"))
        } catch {
            fatalError("vectores-datos.json no se lee: \(error)")
        }
    }()

    /// El visor de «esta pestaña» en los vectores (datos.ts cambia el aleatorio de la web por este).
    static let propio = "v_propio"
}
