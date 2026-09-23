import Foundation
import Security
import os

/// Dónde vive el token del dispositivo (`<deviceId>.<secreto>`).
/// En la app, SIEMPRE el Llavero: nunca `UserDefaults` ni disco.
public protocol TokenStore: Sendable {
    func leerToken() throws -> String?
    func guardarToken(_ token: String) throws
    func borrarToken() throws
}

/// Las cuatro llamadas de Security.framework que usa el Llavero, detrás de
/// un protocolo para poder probar la lógica con un almacén simulado.
public protocol KeychainBackend: Sendable {
    func anadir(_ atributos: [String: Any]) -> OSStatus
    func buscar(_ consulta: [String: Any]) -> (OSStatus, Data?)
    func actualizar(_ consulta: [String: Any], con atributos: [String: Any]) -> OSStatus
    func borrar(_ consulta: [String: Any]) -> OSStatus
}

/// El Llavero de verdad.
public struct SystemKeychain: KeychainBackend {
    public init() {}

    public func anadir(_ atributos: [String: Any]) -> OSStatus {
        SecItemAdd(atributos as CFDictionary, nil)
    }

    public func buscar(_ consulta: [String: Any]) -> (OSStatus, Data?) {
        var resultado: CFTypeRef?
        let estado = SecItemCopyMatching(consulta as CFDictionary, &resultado)
        return (estado, resultado as? Data)
    }

    public func actualizar(_ consulta: [String: Any], con atributos: [String: Any]) -> OSStatus {
        SecItemUpdate(consulta as CFDictionary, atributos as CFDictionary)
    }

    public func borrar(_ consulta: [String: Any]) -> OSStatus {
        SecItemDelete(consulta as CFDictionary)
    }
}

/// Error del Llavero con su `OSStatus`.
public enum KeychainError: Error, Sendable, Equatable, LocalizedError {
    case estado(OSStatus)
    case datosIlegibles

    public var errorDescription: String? {
        switch self {
        case .estado(let estado):
            "No se ha podido usar el Llavero del iPhone (error \(estado))."
        case .datosIlegibles:
            "El token guardado en el Llavero no se puede leer. Vuelve a emparejar la app."
        }
    }
}

/// Token del dispositivo en el Llavero (contraseña genérica).
///
/// Se guarda con `AfterFirstUnlockThisDeviceOnly`: se puede leer con el
/// iPhone bloqueado (el latido de la reproducción en segundo plano y el PiP lo
/// necesitan) y no viaja en copias de seguridad ni a otros dispositivos.
public struct KeychainTokenStore: TokenStore {
    public static let servicioPorDefecto = "es.ismaeloul.aceplayerneo"
    public static let cuentaPorDefecto = "token-dispositivo"

    private let backend: any KeychainBackend
    private let servicio: String
    private let cuenta: String

    public init(
        backend: any KeychainBackend = SystemKeychain(), servicio: String = Self.servicioPorDefecto,
        cuenta: String = Self.cuentaPorDefecto
    ) {
        self.backend = backend
        self.servicio = servicio
        self.cuenta = cuenta
    }

    private var consultaBase: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: servicio,
            kSecAttrAccount as String: cuenta,
        ]
    }

    public func leerToken() throws -> String? {
        var consulta = consultaBase
        consulta[kSecReturnData as String] = true
        consulta[kSecMatchLimit as String] = kSecMatchLimitOne
        let (estado, datos) = backend.buscar(consulta)
        switch estado {
        case errSecSuccess:
            guard let datos, let token = String(data: datos, encoding: .utf8), !token.isEmpty else {
                throw KeychainError.datosIlegibles
            }
            return token
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError.estado(estado)
        }
    }

    public func guardarToken(_ token: String) throws {
        let datos = Data(token.utf8)
        var alta = consultaBase
        alta[kSecValueData as String] = datos
        alta[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let estado = backend.anadir(alta)
        switch estado {
        case errSecSuccess:
            return
        case errSecDuplicateItem:
            let cambio: [String: Any] = [
                kSecValueData as String: datos,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ]
            let actualizado = backend.actualizar(consultaBase, con: cambio)
            guard actualizado == errSecSuccess else { throw KeychainError.estado(actualizado) }
        default:
            throw KeychainError.estado(estado)
        }
    }

    public func borrarToken() throws {
        let estado = backend.borrar(consultaBase)
        guard estado == errSecSuccess || estado == errSecItemNotFound else {
            throw KeychainError.estado(estado)
        }
    }
}

/// Token en memoria: solo para las pruebas de interfaz (nunca persiste).
public final class MemoryTokenStore: TokenStore {
    private let token: OSAllocatedUnfairLock<String?>

    public init(token inicial: String? = nil) {
        token = OSAllocatedUnfairLock(initialState: inicial)
    }

    public func leerToken() throws -> String? { token.withLock { $0 } }
    public func guardarToken(_ nuevo: String) throws { token.withLock { $0 = nuevo } }
    public func borrarToken() throws { token.withLock { $0 = nil } }
}
