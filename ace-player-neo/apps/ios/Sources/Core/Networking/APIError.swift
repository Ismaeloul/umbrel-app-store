import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Errores de la app al hablar con el servidor, con su texto en español.
///
/// Los del servidor llevan el código del catálogo común (`ErrorCatalog`), así
/// que el iPhone enseña exactamente el mismo mensaje que la web.
public enum APIError: Error, Sendable, Equatable {
    /// Error del catálogo que ha devuelto el servidor.
    case servidor(codigo: String, estado: Int, mensaje: String?, requestId: String?)
    /// Hay que volver a emparejar: no hay token, el token no vale o se retiró el dispositivo.
    case necesitaEmparejar(codigo: String?)
    /// No hay ninguna dirección configurada.
    case sinServidor
    /// Ninguna de las direcciones (Tailscale ni red local) responde.
    case servidorInalcanzable
    /// La dirección responde, pero no es un Ace Player Neo.
    case noEsAcePlayerNeo
    /// El servidor habla una versión de la API que esta app no entiende.
    case versionIncompatible(Int)
    /// Fallo de red (sin conexión, plazo agotado…).
    case red(URLError.Code)
    /// La respuesta no tiene el formato esperado.
    case formato(String)
    /// La operación se ha cancelado (cambio de pantalla, app en segundo plano…).
    case cancelado

    /// Código del catálogo, si lo hay.
    public var codigo: String? {
        switch self {
        case .servidor(let codigo, _, _, _): codigo
        case .necesitaEmparejar(let codigo): codigo ?? "unauthorized"
        default: nil
        }
    }

    /// Convierte cualquier error en uno de la app.
    public static func desde(_ error: any Error) -> APIError {
        switch error {
        case let error as APIError: return error
        case let error as URLError: return error.code == .cancelled ? .cancelado : .red(error.code)
        case is CancellationError: return .cancelado
        case is DecodingError: return .formato(String(describing: error))
        default: return .formato(String(describing: error))
        }
    }

    /// Fallos de red en los que tiene sentido probar la otra dirección del servidor.
    public static func esDeConectividad(_ codigo: URLError.Code) -> Bool {
        switch codigo {
        case .cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost,
            .notConnectedToInternet, .dnsLookupFailed, .secureConnectionFailed,
            .internationalRoamingOff, .dataNotAllowed, .resourceUnavailable:
            return true
        default:
            return false
        }
    }
}

extension APIError: LocalizedError {
    public var errorDescription: String? { mensaje }

    /// Texto para enseñárselo a Isma tal cual.
    public var mensaje: String {
        switch self {
        case .servidor(let codigo, _, let mensaje, _):
            if let definicion = ErrorCatalog.describir(codigo), definicion.isPublic {
                return definicion.message
            }
            if let mensaje, !mensaje.isEmpty { return mensaje }
            return ErrorCatalog.mensaje(para: "internal_error")
        case .necesitaEmparejar(let codigo):
            return ErrorCatalog.mensaje(para: codigo == "device_revoked" ? "device_revoked" : "unauthorized")
        case .sinServidor:
            return "Todavía no hay ningún servidor configurado. Empareja la app con tu Ace Player Neo."
        case .servidorInalcanzable:
            return "No se encuentra el servidor ni por Tailscale ni por la red local. Comprueba que Tailscale está conectado o que estás en casa."
        case .noEsAcePlayerNeo:
            return "Esa dirección responde, pero no es un Ace Player Neo. Revisa la dirección y el puerto (normalmente, el 7792)."
        case .versionIncompatible(let version):
            return "El servidor usa la versión \(version) de la API y esta app no la entiende. Actualiza la app o el servidor."
        case .red(let codigo):
            switch codigo {
            case .notConnectedToInternet, .dataNotAllowed:
                return "No hay conexión a internet."
            case .timedOut:
                return "El servidor ha tardado demasiado en responder."
            case .appTransportSecurityRequiresSecureConnection:
                return "iOS no permite conectar con esa dirección sin cifrar. Usa la dirección de Tailscale (.ts.net) o la de la red local."
            default:
                return "No se ha podido conectar con el servidor."
            }
        case .formato:
            return "La respuesta del servidor no tiene el formato esperado. Puede que la app y el servidor tengan versiones distintas."
        case .cancelado:
            return "Se ha cancelado la operación."
        }
    }
}

extension ErrorCatalog {
    /// Definición de un código, también de los dinámicos `http_NNN` (fallos de un servidor remoto).
    public static func describir(_ codigo: String) -> ErrorDefinition? {
        if let definicion = entries[codigo] { return definicion }
        guard codigo.hasPrefix("http_"), codigo.count == 8,
            let estado = Int(codigo.dropFirst(5))
        else { return nil }
        let mensaje =
            estado == 429
            ? "Ese servidor limita las descargas (429). Vuelve a intentarlo en unos minutos."
            : "El servidor respondió con un error \(estado)."
        return ErrorDefinition(status: 502, isPublic: true, message: mensaje)
    }

    /// Mensaje en español de un código; el de `internal_error` si no se conoce.
    public static func mensaje(para codigo: String) -> String {
        describir(codigo)?.message ?? entries["internal_error"]?.message
            ?? "Algo ha fallado en el servidor."
    }
}
