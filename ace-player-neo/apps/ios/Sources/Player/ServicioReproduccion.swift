import Foundation

/// URL concedida por el backend, ya absoluta.
public struct Concesion: Sendable, Hashable {
    public var grant: StreamGrant
    public var url: URL

    public init(grant: StreamGrant, url: URL) {
        self.grant = grant
        self.url = url
    }
}

/// Respuesta de un latido, con la URL ya absoluta.
public struct LatidoRecibido: Sendable, Hashable {
    public var respuesta: HeartbeatResponse
    public var url: URL

    public init(respuesta: HeartbeatResponse, url: URL) {
        self.respuesta = respuesta
        self.url = url
    }
}

/// Lo que el reproductor necesita del backend (así los tests lo simulan sin red).
public protocol ServicioReproduccion: Sendable {
    func pedirStream(canal: CanalReproducible, modo: PlaybackMode, visor: String) async throws -> Concesion
    func latido(sesion: String, visor: String, reproduciendo: Bool) async throws -> LatidoRecibido
    func soltar(sesion: String, visor: String, motivo: ReleaseReason) async
    func resultado(_ cuerpo: OutcomeBody) async
    func informar(_ cuerpo: DiagnosticReportBody) async
    func estadoReproduccion() async throws -> PlaybackStatus
    func guardarReciente(_ canal: CanalReproducible) async
    /// Olvida la dirección elegida (red local ↔ Tailscale) antes de reconectar.
    func olvidarServidor() async
}

/// El de verdad, sobre `APIClient` (/native/api/v1).
public struct ServicioReproduccionAPI: ServicioReproduccion {
    public let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func pedirStream(canal: CanalReproducible, modo: PlaybackMode, visor: String) async throws -> Concesion {
        let grant = try await api.enviar(
            API.stream(id: canal.id, visor: visor, modo: modo, tipo: canal.tipo, titulo: canal.titulo))
        return Concesion(grant: grant, url: try await absoluta(grant.url))
    }

    public func latido(sesion: String, visor: String, reproduciendo: Bool) async throws -> LatidoRecibido {
        let respuesta = try await api.enviar(
            API.latido(sesion: sesion, cuerpo: HeartbeatBody(viewer: visor, playing: reproduciendo)))
        return LatidoRecibido(respuesta: respuesta, url: try await absoluta(respuesta.url))
    }

    public func soltar(sesion: String, visor: String, motivo: ReleaseReason) async {
        _ = try? await api.enviar(API.soltar(sesion: sesion, cuerpo: ReleaseBody(viewer: visor, reason: motivo)))
    }

    public func resultado(_ cuerpo: OutcomeBody) async {
        _ = try? await api.enviar(API.resultadoFuente(cuerpo))
    }

    public func informar(_ cuerpo: DiagnosticReportBody) async {
        _ = try? await api.enviar(API.informarFallo(cuerpo))
    }

    public func estadoReproduccion() async throws -> PlaybackStatus {
        try await api.enviar(API.estadoReproduccion)
    }

    public func guardarReciente(_ canal: CanalReproducible) async {
        let item = ItemInput(id: canal.id, title: String(canal.titulo.prefix(500)), ih: canal.ih)
        _ = try? await api.enviar(API.cambiarBiblioteca(.historyUpsert(item)))
    }

    public func olvidarServidor() async {
        await api.servidores.invalidar()
    }

    /// La URL del backend es relativa (`/native/api/v1/video/…?t=…`): se completa
    /// con la dirección que está respondiendo.
    private func absoluta(_ relativa: String) async throws -> URL {
        if let completa = URL(string: relativa), completa.scheme != nil { return completa }
        let base = try await api.servidores.actual().url
        guard let url = URL(string: relativa, relativeTo: base)?.absoluteURL else {
            throw APIError.formato("URL de vídeo no válida: \(relativa)")
        }
        return url
    }
}

/// Identidad de este visor para el backend (`viewer`): una por instalación.
public enum IdentidadVisor {
    private static let clave = "es.ismaeloul.aceplayerneo.visor"

    public static func id(_ defaults: UserDefaults = .standard) -> String {
        if let guardado = defaults.string(forKey: clave), valido(guardado) { return guardado }
        let nuevo = "ios_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        defaults.set(nuevo, forKey: clave)
        return nuevo
    }

    /// `ViewerIdSchema`: `^[A-Za-z0-9_-]{4,64}$`.
    public static func valido(_ texto: String) -> Bool {
        guard (4...64).contains(texto.count) else { return false }
        return texto.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }
}
