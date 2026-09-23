import Foundation

/// Emparejamiento con el servidor (arquitectura §7.3):
/// 1. se prueban las direcciones (ping) y se elige la que responde;
/// 2. `POST /native/api/v1/pairing/claim { code, name, platform }` sin token;
/// 3. el token (`<deviceId>.<secreto>`) va al Llavero y las direcciones a `UserDefaults`.
public struct PairingService: Sendable {
    private let api: APIClient
    private let configuracion: ServerConfigStore

    public init(api: APIClient, configuracion: ServerConfigStore) {
        self.api = api
        self.configuracion = configuracion
    }

    @discardableResult
    public func emparejar(config: ServerConfig, codigo: String, nombre: String) async throws -> PairingClaimResponse {
        guard !config.vacia else { throw APIError.sinServidor }
        guard PairingLink.codigoValido(codigo) else {
            throw APIError.servidor(codigo: "pairing_invalid", estado: 401, mensaje: nil, requestId: nil)
        }
        await api.servidores.actualizar(config)
        _ = try await api.servidores.resolver()
        let nombreLimpio = String(nombre.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        let respuesta = try await api.enviar(
            API.reclamarCodigo(
                PairingClaimBody(code: codigo, name: nombreLimpio.isEmpty ? "iPhone" : nombreLimpio)))
        try api.tokens.guardarToken(respuesta.token)
        configuracion.guardar(config)
        return respuesta
    }
}
