import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Método HTTP de una ruta v1.
public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case delete = "DELETE"
}

/// Parámetro de la query (el orden se conserva: `channel` se puede repetir).
public struct QueryParam: Sendable, Hashable {
    public let nombre: String
    public let valor: String

    public init(_ nombre: String, _ valor: String) {
        self.nombre = nombre
        self.valor = valor
    }
}

/// Una ruta de /api/v1 vista desde la app: la app entra SIEMPRE por
/// `/native/api/v1/...` (D4), con `Authorization: Bearer` salvo en `ping` y
/// `pairing/claim`.
public struct Endpoint<Response: Decodable & Sendable>: Sendable {
    /// Prefijo de la entrada nativa (`NATIVE_PREFIX` + `/api/v1`).
    public static var prefijo: String { "/native/api/v1" }

    public let metodo: HTTPMethod
    /// Ruta bajo el prefijo, ya codificada, sin barra inicial (p. ej. `football/resolve`).
    public let ruta: String
    public var query: [QueryParam]
    public var cuerpo: Data?
    /// Si hace falta el token del dispositivo.
    public var conToken: Bool
    /// Plazo de la petición, en segundos.
    public var plazo: TimeInterval
    /// Si se puede repetir tal cual contra la otra dirección tras un fallo de red.
    public var idempotente: Bool

    public init(
        _ metodo: HTTPMethod, _ ruta: String, query: [QueryParam] = [], cuerpo: Data? = nil,
        conToken: Bool = true, plazo: TimeInterval = 15, idempotente: Bool? = nil
    ) {
        self.metodo = metodo
        self.ruta = ruta
        self.query = query
        self.cuerpo = cuerpo
        self.conToken = conToken
        self.plazo = plazo
        self.idempotente = idempotente ?? (metodo == .get)
    }

    /// Igual, con un cuerpo JSON.
    public init<Body: Encodable>(
        _ metodo: HTTPMethod, _ ruta: String, json: Body, conToken: Bool = true,
        plazo: TimeInterval = 15, idempotente: Bool = false
    ) {
        let codificador = JSONEncoder()
        codificador.outputFormatting = [.sortedKeys]
        self.init(
            metodo, ruta, cuerpo: try? codificador.encode(json), conToken: conToken, plazo: plazo,
            idempotente: idempotente)
    }

    /// URL completa contra una dirección base (`http://umbrel.local:7792`).
    public func url(base: URL) throws -> URL {
        guard var partes = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            throw APIError.formato("Dirección base no válida: \(base)")
        }
        var camino = partes.percentEncodedPath
        while camino.hasSuffix("/") { camino.removeLast() }
        partes.percentEncodedPath = camino + Self.prefijo + (ruta.isEmpty ? "" : "/" + ruta)
        partes.percentEncodedQuery =
            query.isEmpty
            ? nil
            : query.map { "\(Codificacion.query($0.nombre))=\(Codificacion.query($0.valor))" }
                .joined(separator: "&")
        partes.fragment = nil
        guard let url = partes.url else { throw APIError.formato("No se pudo formar la URL de \(ruta)") }
        return url
    }

    /// Petición lista para `URLSession`.
    public func peticion(base: URL, token: String?) throws -> URLRequest {
        var peticion = URLRequest(url: try url(base: base), timeoutInterval: plazo)
        peticion.httpMethod = metodo.rawValue
        peticion.setValue("application/json", forHTTPHeaderField: "Accept")
        if let cuerpo {
            peticion.httpBody = cuerpo
            peticion.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token {
            peticion.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return peticion
    }
}

/// Codificación de trozos de URL.
public enum Codificacion {
    /// Solo ASCII no reservado (RFC 3986). Nada de `%2F` ni `%2E` en la ruta:
    /// nginx los rechaza con 400 (D4), y un id válido nunca los necesita.
    private static func permitidos() -> CharacterSet {
        CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
    }

    /// Un segmento de ruta (ids, hashes).
    public static func segmento(_ texto: String) -> String {
        texto.addingPercentEncoding(withAllowedCharacters: permitidos()) ?? texto
    }

    /// Un nombre o valor de la query. `+` va como `%2B`: el servidor (Node) lee
    /// `+` como espacio, y «M+ LaLiga» tiene que llegar tal cual.
    public static func query(_ texto: String) -> String {
        texto.addingPercentEncoding(withAllowedCharacters: permitidos()) ?? texto
    }
}
