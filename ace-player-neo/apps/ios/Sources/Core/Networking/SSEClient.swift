import Foundation

/// Lo que va pasando en la conexión de tiempo real.
public enum SSEUpdate: Sendable, Equatable {
    /// Conectado (o reconectado) y recibiendo.
    case conectado(ActiveServer)
    /// Un evento tipado.
    case evento(SSEEnvelope)
    /// Se ha cortado; se reintentará solo tras `reintentoEn` segundos.
    case desconectado(APIError?, reintentoEn: TimeInterval)
    /// El token ya no vale: hay que volver a emparejar (la conexión se acaba).
    case necesitaEmparejar
}

/// Cliente SSE de `GET /native/api/v1/events` sobre `URLSession.bytes`.
///
/// - Reconecta solo con espera exponencial (1 s, 2 s, 4 s… hasta 30 s), o lo
///   que pida el servidor con `retry:` si es más.
/// - Reanuda con `Last-Event-ID`: si lo perdido ya no está en el búfer del
///   servidor, llega un `resync` y hay que recargar.
/// - El plazo de la petición es de inactividad: el servidor manda `: ping`
///   cada 15 s, así que 45 s de silencio es una conexión muerta y se reconecta.
/// - Un corte por red olvida la dirección elegida, por si toca cambiar de red
///   local a Tailscale.
public final class SSEClient: Sendable {
    private let session: URLSession
    private let servidores: ServerResolver
    private let tokens: any TokenStore
    private let esperaInicial: TimeInterval
    private let esperaMaxima: TimeInterval
    private let plazoInactividad: TimeInterval

    public init(
        session: URLSession, servidores: ServerResolver, tokens: any TokenStore,
        esperaInicial: TimeInterval = 1, esperaMaxima: TimeInterval = 30, plazoInactividad: TimeInterval = 45
    ) {
        self.session = session
        self.servidores = servidores
        self.tokens = tokens
        self.esperaInicial = esperaInicial
        self.esperaMaxima = esperaMaxima
        self.plazoInactividad = plazoInactividad
    }

    /// Conexión que dura hasta que se cancela quien la consume.
    public func conectar(desde ultimoId: String? = nil) -> AsyncStream<SSEUpdate> {
        AsyncStream { continuacion in
            let tarea = Task { await self.bucle(desde: ultimoId, continuacion: continuacion) }
            continuacion.onTermination = { _ in tarea.cancel() }
        }
    }

    /// Espera antes del intento número `intento` (1, 2, 3…).
    func espera(intento: Int, retryServidorMs: Int?) -> TimeInterval {
        let exponencial = min(esperaMaxima, esperaInicial * pow(2, Double(max(0, intento - 1))))
        let delServidor = retryServidorMs.map { TimeInterval($0) / 1000 } ?? 0
        return max(exponencial, min(delServidor, esperaMaxima))
    }

    private func bucle(desde ultimoIdInicial: String?, continuacion: AsyncStream<SSEUpdate>.Continuation) async {
        var ultimoId = ultimoIdInicial
        var retryServidorMs: Int?
        var intento = 0
        bucle: while !Task.isCancelled {
            let token: String?
            do {
                token = try tokens.leerToken()
            } catch {
                token = nil
            }
            guard let token, !token.isEmpty else {
                continuacion.yield(.necesitaEmparejar)
                break bucle
            }

            var fallo: APIError?
            do {
                let servidor = try await servidores.actual()
                var peticion = try API.eventos(plazoInactividad: plazoInactividad)
                    .peticion(base: servidor.url, token: token)
                peticion.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                peticion.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                if let ultimoId { peticion.setValue(ultimoId, forHTTPHeaderField: "Last-Event-ID") }

                let (bytes, respuesta) = try await session.bytes(for: peticion)
                guard let http = respuesta as? HTTPURLResponse else {
                    throw APIError.formato("La respuesta del tiempo real no es HTTP")
                }
                if http.statusCode == 401 {
                    try? tokens.borrarToken()
                    continuacion.yield(.necesitaEmparejar)
                    break bucle
                }
                guard http.statusCode == 200 else {
                    throw APIError.servidor(
                        codigo: "http_\(http.statusCode)", estado: http.statusCode, mensaje: nil, requestId: nil)
                }

                continuacion.yield(.conectado(servidor))
                intento = 0
                var parser = SSEParser(lastEventId: ultimoId)
                for try await byte in bytes {
                    guard let mensaje = parser.feed(byte) else { continue }
                    ultimoId = mensaje.id ?? ultimoId
                    retryServidorMs = mensaje.retry ?? retryServidorMs
                    guard let evento = try? SSEEvent.decode(type: mensaje.event, data: Data(mensaje.data.utf8))
                    else { continue }  // Un evento mal formado no tumba la conexión.
                    continuacion.yield(.evento(SSEEnvelope(id: mensaje.id, event: evento)))
                }
                ultimoId = parser.lastEventId ?? ultimoId
            } catch {
                let convertido = APIError.desde(error)
                if convertido == .cancelado || Task.isCancelled { break bucle }
                if case .red = convertido { await servidores.invalidar() }
                if convertido == .servidorInalcanzable { await servidores.invalidar() }
                fallo = convertido
            }

            if Task.isCancelled { break bucle }
            intento += 1
            let pausa = espera(intento: intento, retryServidorMs: retryServidorMs)
            continuacion.yield(.desconectado(fallo, reintentoEn: pausa))
            do {
                try await Task.sleep(for: .seconds(pausa))
            } catch {
                break bucle
            }
        }
        continuacion.finish()
    }
}
