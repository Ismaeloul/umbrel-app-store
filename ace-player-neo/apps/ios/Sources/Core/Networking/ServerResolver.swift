import Foundation

/// Elige la dirección del servidor que responde: la de Tailscale o la de la
/// red local, con cambio automático.
///
/// - Hace ping (`GET /native/api/v1/ping`, sin token) a las dos a la vez y se
///   queda con la primera que contesta y resulta ser un Ace Player Neo.
/// - Recuerda la elegida hasta que una petición falla por red
///   (`invalidar()`), cambia la red del teléfono o se cambian las direcciones.
/// - Si varias peticiones piden dirección a la vez, comparten la misma carrera.
public actor ServerResolver {
    /// Hace ping a una dirección base y devuelve la respuesta validada.
    public typealias Pinger = @Sendable (URL) async throws -> PingResponse

    private var config: ServerConfig
    private var activo: ActiveServer?
    private var enCurso: Task<ActiveServer, any Error>?
    private var generacion = 0
    private let pinger: Pinger

    public init(config: ServerConfig, pinger: @escaping Pinger) {
        self.config = config
        self.pinger = pinger
    }

    /// Resolver que hace ping de verdad con `session`.
    public init(config: ServerConfig, session: URLSession, plazoPing: TimeInterval = 4) {
        self.init(config: config) { base in
            try await ServerResolver.ping(base: base, session: session, plazo: plazoPing)
        }
    }

    public func configuracion() -> ServerConfig { config }

    /// La dirección elegida ahora mismo, si ya se sabe (sin hacer ping).
    public func conocido() -> ActiveServer? { activo }

    /// Cambia las direcciones (emparejar, Ajustes) y olvida la elegida.
    public func actualizar(_ nueva: ServerConfig) {
        config = nueva
        olvidar()
    }

    /// Olvida la dirección elegida: la próxima petición vuelve a hacer ping.
    /// Si ya hay una carrera en marcha, se deja terminar (su resultado es fresco).
    public func invalidar() {
        activo = nil
    }

    private func olvidar() {
        generacion += 1
        activo = nil
        enCurso?.cancel()
        enCurso = nil
    }

    /// La dirección que hay que usar (la recordada o una carrera nueva).
    public func actual() async throws -> ActiveServer {
        if let activo { return activo }
        return try await resolver()
    }

    /// Hace la carrera de pings aunque ya haya una dirección elegida.
    public func resolver() async throws -> ActiveServer {
        if let enCurso { return try await enCurso.value }
        let candidatas = config.candidatas
        guard !candidatas.isEmpty else { throw APIError.sinServidor }
        let pinger = self.pinger
        let tarea = Task { try await ServerResolver.carrera(candidatas, pinger: pinger) }
        let miGeneracion = generacion
        enCurso = tarea
        do {
            let elegido = try await tarea.value
            if miGeneracion == generacion {
                activo = elegido
                enCurso = nil
            }
            return elegido
        } catch {
            if miGeneracion == generacion { enCurso = nil }
            throw APIError.desde(error)
        }
    }

    private enum Resultado: Sendable {
        case ok(ActiveServer)
        case fallo(APIError)
    }

    /// Ping a todas a la vez; gana la primera que responde bien.
    static func carrera(_ candidatas: [ActiveServer], pinger: @escaping Pinger) async throws -> ActiveServer {
        try await withThrowingTaskGroup(of: Resultado.self, returning: ActiveServer.self) { grupo in
            for candidata in candidatas {
                grupo.addTask {
                    do {
                        _ = try await pinger(candidata.url)
                        return .ok(candidata)
                    } catch {
                        return .fallo(APIError.desde(error))
                    }
                }
            }
            var fallos: [APIError] = []
            for try await resultado in grupo {
                switch resultado {
                case .ok(let elegido):
                    grupo.cancelAll()
                    return elegido
                case .fallo(let error):
                    fallos.append(error)
                }
            }
            throw mejorExplicacion(fallos)
        }
    }

    /// De todos los fallos, el que mejor explica qué pasa.
    static func mejorExplicacion(_ fallos: [APIError]) -> APIError {
        if let version = fallos.first(where: {
            if case .versionIncompatible = $0 { return true }
            return false
        }) {
            return version
        }
        if fallos.contains(.noEsAcePlayerNeo) { return .noEsAcePlayerNeo }
        if fallos.contains(.red(.appTransportSecurityRequiresSecureConnection)) {
            return .red(.appTransportSecurityRequiresSecureConnection)
        }
        if fallos.contains(.cancelado) && fallos.allSatisfy({ $0 == .cancelado }) { return .cancelado }
        return .servidorInalcanzable
    }

    /// `GET /native/api/v1/ping` sin token.
    public static func ping(base: URL, session: URLSession, plazo: TimeInterval) async throws -> PingResponse {
        let peticion = try API.ping(plazo: plazo).peticion(base: base, token: nil)
        let datos: Data
        let respuesta: URLResponse
        do {
            (datos, respuesta) = try await session.data(for: peticion)
        } catch {
            throw APIError.desde(error)
        }
        guard let http = respuesta as? HTTPURLResponse, http.statusCode == 200,
            let ping = try? JSONDecoder().decode(PingResponse.self, from: datos),
            ping.app == PingResponse.appEsperada
        else { throw APIError.noEsAcePlayerNeo }
        guard ping.apiVersion == PingResponse.apiVersionEsperada else {
            throw APIError.versionIncompatible(ping.apiVersion)
        }
        return ping
    }
}
