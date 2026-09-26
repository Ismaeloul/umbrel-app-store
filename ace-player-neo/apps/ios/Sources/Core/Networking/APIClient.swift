import Foundation
import Synchronization

/// Cliente de /native/api/v1 con `URLSession` + `async/await`.
///
/// - Pone `Authorization: Bearer <token>` (del Llavero) en todas las rutas que lo piden.
/// - Plazo **total** por ruta, el de la web (`withTimeout` de apps/web/src/api/client.ts): al agotarse
///   la petición se cancela y sale `APIError.red(.timedOut)` («El servidor tarda demasiado…»). Si
///   quien llama cancela, sale `.cancelado`, que no se enseña (a8 §3.11.1).
/// - Pide la dirección al `ServerResolver`; si una petición falla por red, la olvida y, si es un GET,
///   la repite UNA vez con la dirección que responda (cambio casa ↔ Tailscale). Las mutaciones nunca
///   se repiten.
/// - Un 401 en una ruta con token significa que el dispositivo ya no vale
///   (token caducado o retirado desde la web): borra el token, avisa con
///   `alPerderAcceso` y lanza `APIError.necesitaEmparejar`. Mientras se olvida este iPhone
///   (`callarAccesoPerdido(true)`, a9 §3.5.3) el 401 no borra ni avisa: manda el resultado del `DELETE`.
/// - Los errores del servidor salen con el mensaje en español del catálogo común.
public final class APIClient: Sendable {
    public let session: URLSession
    public let servidores: ServerResolver
    public let tokens: any TokenStore
    private let alPerderAcceso: @Sendable () async -> Void
    private let acceso = Mutex(EstadoAcceso())

    /// Lo que se recuerda del último acceso perdido.
    private struct EstadoAcceso: Sendable {
        var callado = false
        var ultimoCodigo: String?
    }

    /// Código que se apunta cuando el Llavero no deja leer el token (a2 §23.3, «Llavero ilegible»).
    static let codigoLlaveroIlegible = "keychain_unreadable"

    public init(
        session: URLSession, servidores: ServerResolver, tokens: any TokenStore,
        alPerderAcceso: @escaping @Sendable () async -> Void = {}
    ) {
        self.session = session
        self.servidores = servidores
        self.tokens = tokens
        self.alPerderAcceso = alPerderAcceso
    }

    /// Mientras se olvida este iPhone, un 401 ni borra el token ni avisa (a9 §3.5.3).
    func callarAccesoPerdido(_ callar: Bool) {
        acceso.withLock { $0.callado = callar }
    }

    /// Código del último 401 que hizo perder el acceso (`unauthorized`, `device_revoked` o el del Llavero).
    var ultimoCodigoAccesoPerdido: String? { acceso.withLock { $0.ultimoCodigo } }

    /// Hace la petición y decodifica la respuesta.
    public func enviar<R>(_ endpoint: Endpoint<R>) async throws -> R {
        let token = endpoint.conToken ? try await tokenGuardado() : nil
        var reintentado = false
        while true {
            if Task.isCancelled { throw APIError.cancelado }
            let servidor = try await servidores.actual()
            let peticion = try endpoint.peticion(base: servidor.url, token: token)
            let recibido: Recibido
            do {
                recibido = try await Self.conPlazo(endpoint.plazo) { [session] in
                    let (datos, respuesta) = try await session.data(for: peticion)
                    return Recibido(datos: datos, respuesta: respuesta)
                }
            } catch {
                let codigo = try Self.codigoDeRed(error)
                if APIError.esDeConectividad(codigo) {
                    await servidores.invalidar()
                    if endpoint.metodo == .get && endpoint.idempotente && !reintentado {
                        reintentado = true
                        continue
                    }
                }
                throw APIError.red(codigo)
            }
            return try await procesar(recibido.datos, recibido.respuesta, endpoint)
        }
    }

    /// Lo que llega del servidor (tipo propio: se cruza entre tareas).
    private struct Recibido: Sendable {
        let datos: Data
        let respuesta: URLResponse
    }

    private struct PlazoAgotado: Error {}

    /// El código de red de un fallo; una cancelación de quien llama sale como `.cancelado`.
    private static func codigoDeRed(_ error: any Error) throws -> URLError.Code {
        switch error {
        case is PlazoAgotado: return .timedOut
        case let error as URLError:
            if error.code == .cancelled { throw APIError.cancelado }
            return error.code
        case is CancellationError: throw APIError.cancelado
        default: throw APIError.desde(error)
        }
    }

    /// Carrera entre la operación y el plazo total (0 = sin plazo).
    static func conPlazo<T: Sendable>(
        _ segundos: TimeInterval, _ operacion: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        guard segundos > 0 else { return try await operacion() }
        return try await withThrowingTaskGroup(of: T.self, returning: T.self) { grupo in
            grupo.addTask { try await operacion() }
            grupo.addTask {
                try await Task.sleep(for: .seconds(segundos))
                throw PlazoAgotado()
            }
            defer { grupo.cancelAll() }
            guard let primero = try await grupo.next() else { throw CancellationError() }
            return primero
        }
    }

    private func tokenGuardado() async throws -> String {
        let token: String?
        do {
            token = try tokens.leerToken()
        } catch KeychainError.datosIlegibles {
            await perderAcceso(codigo: Self.codigoLlaveroIlegible, borrar: false)
            throw APIError.necesitaEmparejar(codigo: nil)
        } catch {
            throw APIError.necesitaEmparejar(codigo: nil)
        }
        guard let token, !token.isEmpty else { throw APIError.necesitaEmparejar(codigo: nil) }
        return token
    }

    /// Un 401 con token: borra el token y avisa, salvo mientras se olvida este iPhone.
    private func perderAcceso(codigo: String, borrar: Bool) async {
        let callado = acceso.withLock { estado -> Bool in
            if !estado.callado { estado.ultimoCodigo = codigo }
            return estado.callado
        }
        guard !callado else { return }
        if borrar { try? tokens.borrarToken() }
        await alPerderAcceso()
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
        let codigo = sobre?.error.code ?? Self.codigoAntiguo(datos) ?? "http_\(http.statusCode)"
        if http.statusCode == 401 && endpoint.conToken {
            await perderAcceso(codigo: codigo, borrar: true)
            throw APIError.necesitaEmparejar(codigo: codigo)
        }
        throw APIError.servidor(
            codigo: codigo, estado: http.statusCode, mensaje: sobre?.error.message,
            requestId: sobre?.error.requestId)
    }

    /// Forma antigua `{ "error": "<código>" }` con un código del catálogo (errorFromResponse de la web).
    private static func codigoAntiguo(_ datos: Data) -> String? {
        struct Antiguo: Decodable { let error: String }
        guard let antiguo = try? JSONDecoder().decode(Antiguo.self, from: datos),
            ErrorCatalog.entries[antiguo.error] != nil
        else { return nil }
        return antiguo.error
    }
}
