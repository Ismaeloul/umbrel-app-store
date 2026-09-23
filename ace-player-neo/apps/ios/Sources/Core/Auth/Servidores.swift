import Foundation

/// Por dónde se llega al servidor.
public enum ServerVia: String, Codable, Sendable, Hashable, CaseIterable {
    case lan
    case tailscale

    public var etiqueta: String {
        switch self {
        case .lan: "Red local"
        case .tailscale: "Tailscale"
        }
    }

    /// Clasifica una dirección: `*.ts.net` y el rango de Tailscale
    /// (100.64.0.0/10) son Tailscale; lo demás (192.168.x, 10.x, `.local`…),
    /// red local.
    public static func clasificar(_ url: URL) -> ServerVia {
        guard let host = url.host()?.lowercased() else { return .lan }
        if host.hasSuffix(".ts.net") { return .tailscale }
        if let octetos = IPv4.octetos(host), octetos[0] == 100, (64...127).contains(octetos[1]) {
            return .tailscale
        }
        return .lan
    }
}

/// Lectura mínima de una IPv4 literal.
public enum IPv4 {
    public static func octetos(_ host: String) -> [Int]? {
        let partes = host.split(separator: ".", omittingEmptySubsequences: false)
        guard partes.count == 4 else { return nil }
        var octetos: [Int] = []
        for parte in partes {
            guard !parte.isEmpty, parte.count <= 3, parte.allSatisfy(\.isASCII),
                let n = Int(parte), (0...255).contains(n)
            else { return nil }
            octetos.append(n)
        }
        return octetos
    }
}

/// Dirección a la que se está hablando ahora mismo.
public struct ActiveServer: Sendable, Hashable {
    public let via: ServerVia
    public let url: URL

    public init(via: ServerVia, url: URL) {
        self.via = via
        self.url = url
    }
}

/// Las dos direcciones del servidor. No son secretas: se guardan en
/// `UserDefaults` (el token, en cambio, va SOLO al Llavero).
public struct ServerConfig: Codable, Sendable, Hashable {
    public var tailscale: URL?
    public var lan: URL?

    public init(tailscale: URL? = nil, lan: URL? = nil) {
        self.tailscale = tailscale
        self.lan = lan
    }

    public var vacia: Bool { tailscale == nil && lan == nil }

    /// Candidatas, primero la red local (en casa suele contestar antes).
    public var candidatas: [ActiveServer] {
        var lista: [ActiveServer] = []
        if let lan { lista.append(ActiveServer(via: .lan, url: lan)) }
        if let tailscale { lista.append(ActiveServer(via: .tailscale, url: tailscale)) }
        return lista
    }

    /// Normaliza lo que se teclea o llega en el QR: añade `http://` si falta y
    /// se queda solo con el origen (esquema, host y puerto).
    public static func normalizar(_ texto: String) -> URL? {
        var limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !limpio.isEmpty else { return nil }
        if !limpio.contains("://") { limpio = "http://" + limpio }
        guard let partes = URLComponents(string: limpio),
            let esquema = partes.scheme?.lowercased(), esquema == "http" || esquema == "https",
            let host = partes.host, !host.isEmpty, partes.user == nil, partes.password == nil
        else { return nil }
        var origen = URLComponents()
        origen.scheme = esquema
        origen.host = host
        origen.port = partes.port
        return origen.url
    }
}

/// Guarda las direcciones en `UserDefaults`.
public struct ServerConfigStore: Sendable {
    private let suite: String?
    private let clave = "servidores.v1"

    public init(suite: String? = nil) {
        self.suite = suite
    }

    private var defaults: UserDefaults { suite.flatMap { UserDefaults(suiteName: $0) } ?? .standard }

    public func leer() -> ServerConfig {
        guard let datos = defaults.data(forKey: clave),
            let config = try? JSONDecoder().decode(ServerConfig.self, from: datos)
        else { return ServerConfig() }
        return config
    }

    public func guardar(_ config: ServerConfig) {
        if let datos = try? JSONEncoder().encode(config) {
            defaults.set(datos, forKey: clave)
        }
    }

    public func borrar() {
        defaults.removeObject(forKey: clave)
    }
}

/// Enlace de emparejamiento del QR: `aceneo://pair?u=<URL base>&c=<código>`.
public struct PairingLink: Sendable, Hashable {
    public let servidor: URL
    public let codigo: String

    public init?(url: URL) {
        guard url.scheme?.lowercased() == "aceneo", url.host()?.lowercased() == "pair",
            let partes = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }
        let items = partes.queryItems ?? []
        guard let u = items.first(where: { $0.name == "u" })?.value,
            let c = items.first(where: { $0.name == "c" })?.value,
            let servidor = ServerConfig.normalizar(u),
            PairingLink.codigoValido(c)
        else { return nil }
        self.servidor = servidor
        self.codigo = c
    }

    public init?(texto: String) {
        guard let url = URL(string: texto.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        self.init(url: url)
    }

    /// 6 dígitos ASCII.
    public static func codigoValido(_ codigo: String) -> Bool {
        codigo.count == 6 && codigo.allSatisfy { $0.isASCII && $0.isNumber }
    }
}
