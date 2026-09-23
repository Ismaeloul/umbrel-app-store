import Foundation

/// Cliente de /native/api/v1 con `URLSession` + `async/await`.
///
/// - Pone `Authorization: Bearer <token>` (del Llavero) en todas las rutas que lo piden.
/// - Pide la dirección al `ServerResolver`; si una petición falla por red,
///   la olvida y, si la petición es idempotente, la repite UNA vez con la
///   dirección que responda (red local ↔ Tailscale).
/// - Un 401 en una ruta con token significa que el dispositivo ya no vale
///   (token caducado o retirado desde la web): borra el token, avisa con
///   `alPerderAcceso` y lanza `APIError.necesitaEmparejar`.
/// - Los errores del servidor salen con el mensaje en español del catálogo común.
public final class APIClient: Sendable {
    public let session: URLSession
    public let servidores: ServerResolver
    public let tokens: any TokenStore
    private let alPerderAcceso: @Sendable () async -> Void

    public init(
        session: URLSession, servidores: ServerResolver, tokens: any TokenStore,
        alPerderAcceso: @escaping @Sendable () async -> Void = {}
    ) {
        self.session = session
        self.servidores = servidores
        self.tokens = tokens
        self.alPerderAcceso = alPerderAcceso
    }

    /// Hace la petición y decodifica la respuesta.
    public func enviar<R>(_ endpoint: Endpoint<R>) async throws -> R {
        let token = endpoint.conToken ? try tokenGuardado() : nil
        var reintentado = false
        while true {
            try Task.checkCancellation()
            let servidor = try await servidores.actual()
            let peticion = try endpoint.peticion(base: servidor.url, token: token)
            let datos: Data
            let respuesta: URLResponse
            do {
                (datos, respuesta) = try await session.data(for: peticion)
            } catch let error as URLError {
                if error.code == .cancelled { throw APIError.cancelado }
                if APIError.esDeConectividad(error.code) {
                    await servidores.invalidar()
                    if endpoint.idempotente && !reintentado {
                        reintentado = true
                        continue
                    }
                }
                throw APIError.red(error.code)
            } catch is CancellationError {
                throw APIError.cancelado
            }
            return try await procesar(datos, respuesta, endpoint)
        }
    }

    private func tokenGuardado() throws -> String {
        let token: String?
        do {
            token = try tokens.leerToken()
        } catch {
            throw APIError.necesitaEmparejar(codigo: nil)
        }
        guard let token, !token.isEmpty else { throw APIError.necesitaEmparejar(codigo: nil) }
        return token
    }

    private func procesar<R>(_ datos: Data, _ respuesta: URLResponse, _ endpoint: Endpoint<R>) async throws -> R {
        guard let http = respuesta as? HTTPURLResponse else {
            throw APIError.formato("La respuesta no es HTTP")
        }
        if (200..<300).contains(http.statusCode) {
            if datos.isEmpty, let vacia = SinContenido() as? R { return vacia }
            do {
                return try JSONDecoder().decode(R.self, from: datos)
            } catch {
                throw APIError.formato("\(endpoint.ruta): \(error)")
            }
        }
        let sobre = try? JSONDecoder().decode(ApiErrorEnvelope.self, from: datos)
        let codigo = sobre?.error.code ?? "http_\(http.statusCode)"
        if http.statusCode == 401 && endpoint.conToken {
            try? tokens.borrarToken()
            await alPerderAcceso()
            throw APIError.necesitaEmparejar(codigo: codigo)
        }
        throw APIError.servidor(
            codigo: codigo, estado: http.statusCode, mensaje: sobre?.error.message,
            requestId: sobre?.error.requestId)
    }
}
