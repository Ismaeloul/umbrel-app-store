import Foundation

/// Emparejamiento con el servidor (arquitectura §7.3, a7 §8.9.1):
/// 1. se prueban las direcciones (ping) y se elige la que responde;
/// 2. `POST /native/api/v1/pairing/claim { code, name, platform }` sin token;
/// 3. el token (`<deviceId>.<secreto>`) va al Llavero y las direcciones a `UserDefaults`
///    (`servidores.v1`, las mismas claves que la 0.8.0: un iPhone emparejado sigue emparejado).
public struct PairingService: Sendable {
    private let api: APIClient
    private let configuracion: ServerConfigStore

    public init(api: APIClient, configuracion: ServerConfigStore) {
        self.api = api
        self.configuracion = configuracion
    }

    /// Con las direcciones tecleadas: gana la primera que responda (carrera de `ServerResolver`).
    @discardableResult
    public func emparejar(config: ServerConfig, codigo: String, nombre: String) async throws -> PairingClaimResponse {
        guard !config.vacia else { throw APIError.sinServidor }
        try Self.validar(codigo)
        await api.servidores.actualizar(config)
        _ = try await api.servidores.resolver()
        return try await canjear(codigo: codigo, nombre: nombre, config: config)
    }

    /// Con las direcciones de un QR (todas sus `u`, a9 §3.4): guarda la primera de cada tipo y canjea
    /// por la PRIMERA `u` que responda, en su orden (cada ping con su plazo de 4 s).
    @discardableResult
    public func emparejar(enlace: PairingLink, nombre: String) async throws -> PairingClaimResponse {
        try await emparejar(servidores: enlace.servidores, codigo: enlace.codigo, nombre: nombre)
    }

    @discardableResult
    public func emparejar(servidores: [URL], codigo: String, nombre: String) async throws -> PairingClaimResponse {
        let config = ServerConfig(servidores: servidores)
        guard !config.vacia else { throw APIError.sinServidor }
        try Self.validar(codigo)
        await api.servidores.actualizar(config)
        var fallos: [APIError] = []
        var elegido = false
        for url in servidores {
            do {
                _ = try await api.servidores.probarYFijar(url)
                elegido = true
                break
            } catch {
                fallos.append(APIError.desde(error))
            }
        }
        guard elegido else { throw ServerResolver.mejorExplicacion(fallos) }
        return try await canjear(codigo: codigo, nombre: nombre, config: config)
    }

    /// Un código mal escrito no sale a la red: se responde como el servidor (`pairing_invalid`).
    private static func validar(_ codigo: String) throws {
        guard PairingLink.codigoValido(codigo) else {
            throw APIError.servidor(codigo: "pairing_invalid", estado: 401, mensaje: nil, requestId: nil)
        }
    }

    private func canjear(codigo: String, nombre: String, config: ServerConfig) async throws -> PairingClaimResponse {
        let nombreLimpio = String(nombre.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        let respuesta = try await api.enviar(
            API.reclamarCodigo(
                PairingClaimBody(code: codigo, name: nombreLimpio.isEmpty ? "iPhone" : nombreLimpio)))
        try api.tokens.guardarToken(respuesta.token)
        configuracion.guardar(config)
        return respuesta
    }
}
