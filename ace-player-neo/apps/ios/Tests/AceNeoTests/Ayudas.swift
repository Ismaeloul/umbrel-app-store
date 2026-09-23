import Foundation
import Security
import XCTest
import os

@testable import AceNeo

/// `URLProtocol` simulado: cada test dice qué contestar y luego mira qué
/// peticiones se hicieron (con su cuerpo ya leído).
final class MockURLProtocol: URLProtocol {
    typealias Manejador = @Sendable (URLRequest) throws -> (Int, [String: String], Data)

    private struct Estado: Sendable {
        var manejador: Manejador?
        var peticiones: [URLRequest] = []
    }

    private static let estado = OSAllocatedUnfairLock(initialState: Estado())

    static func responder(_ manejador: @escaping Manejador) {
        estado.withLock { $0 = Estado(manejador: manejador) }
    }

    static func limpiar() {
        estado.withLock { $0 = Estado() }
    }

    static var peticiones: [URLRequest] { estado.withLock { $0.peticiones } }

    static func sesion() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var copia = request
        if copia.httpBody == nil { copia.httpBody = Self.leerCuerpo(request) }
        let guardada = copia
        let manejador = Self.estado.withLock { estado -> Manejador? in
            estado.peticiones.append(guardada)
            return estado.manejador
        }
        guard let manejador, let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        do {
            let (codigo, cabeceras, datos) = try manejador(guardada)
            var todas = cabeceras
            if todas["Content-Type"] == nil { todas["Content-Type"] = "application/json" }
            let respuesta = HTTPURLResponse(url: url, statusCode: codigo, httpVersion: "HTTP/1.1", headerFields: todas)!
            client?.urlProtocol(self, didReceive: respuesta, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: datos)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    static func leerCuerpo(_ peticion: URLRequest) -> Data? {
        if let cuerpo = peticion.httpBody { return cuerpo }
        guard let flujo = peticion.httpBodyStream else { return nil }
        flujo.open()
        defer { flujo.close() }
        var datos = Data()
        var bufer = [UInt8](repeating: 0, count: 4096)
        while flujo.hasBytesAvailable {
            let leidos = flujo.read(&bufer, maxLength: bufer.count)
            if leidos <= 0 { break }
            datos.append(bufer, count: leidos)
        }
        return datos
    }
}

/// Ejemplos de packages/shared/fixtures, copiados al bundle de los tests.
enum Fixtures {
    static var raiz: URL {
        guard let url = Bundle(for: MockURLProtocol.self).url(forResource: "fixtures", withExtension: nil) else {
            fatalError("La carpeta fixtures no está en el bundle de los tests (revisa project.yml)")
        }
        return url
    }

    static func datos(_ ruta: String) throws -> Data {
        try Data(contentsOf: raiz.appendingPathComponent(ruta))
    }

    /// Nombres (sin `.json`) de los ejemplos de una carpeta.
    static func nombres(_ carpeta: String) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: raiz.appendingPathComponent(carpeta).path)
            .filter { $0.hasSuffix(".json") }
            .map { String($0.dropLast(5)) }
            .sorted()
    }
}

/// Comparación de JSON sin depender del orden de claves ni de cómo se escriben los números.
enum ComparadorJSON {
    /// Quita los `null`: Swift no codifica los opcionales vacíos.
    static func normalizar(_ valor: Any) -> Any? {
        switch valor {
        case is NSNull:
            return nil
        case let objeto as [String: Any]:
            var limpio: [String: Any] = [:]
            for (clave, valor) in objeto {
                if let normalizado = normalizar(valor) { limpio[clave] = normalizado }
            }
            return limpio
        case let lista as [Any]:
            return lista.map { normalizar($0) ?? NSNull() }
        default:
            return valor
        }
    }

    /// Primera diferencia entre dos JSON ya normalizados, o nil si son iguales.
    static func diferencia(_ a: Any?, _ b: Any?, ruta: String = "$") -> String? {
        switch (a, b) {
        case (nil, nil):
            return nil
        case let (x as [String: Any], y as [String: Any]):
            for clave in Set(x.keys).union(y.keys).sorted() {
                if let d = diferencia(x[clave], y[clave], ruta: "\(ruta).\(clave)") { return d }
            }
            return nil
        case let (x as [Any], y as [Any]):
            guard x.count == y.count else { return "\(ruta): \(x.count) elementos frente a \(y.count)" }
            for (i, (p, q)) in zip(x, y).enumerated() {
                if let d = diferencia(p, q, ruta: "\(ruta)[\(i)]") { return d }
            }
            return nil
        case let (x as String, y as String):
            return x == y ? nil : "\(ruta): «\(x)» frente a «\(y)»"
        case let (x as NSNumber, y as NSNumber):
            return x.doubleValue == y.doubleValue ? nil : "\(ruta): \(x) frente a \(y)"
        default:
            return "\(ruta): \(String(describing: a)) frente a \(String(describing: b))"
        }
    }

    /// Decodifica con `T`, vuelve a codificar y devuelve la primera diferencia con el original.
    static func idaYVuelta<T: Codable>(_ tipo: T.Type, _ datos: Data) throws -> String? {
        let valor = try JSONDecoder().decode(T.self, from: datos)
        let vuelta = try JSONEncoder().encode(valor)
        let original = normalizar(try JSONSerialization.jsonObject(with: datos))
        let recodificado = normalizar(try JSONSerialization.jsonObject(with: vuelta))
        return diferencia(original, recodificado)
    }
}

/// Almacén simulado con la semántica del Llavero (duplicado, no encontrado…).
final class LlaveroSimulado: KeychainBackend {
    struct Entrada: Sendable {
        var datos: Data
        var accesible: String?
    }

    private let almacen = OSAllocatedUnfairLock<[String: Entrada]>(initialState: [:])
    private let fallo: OSStatus?

    /// `fallo`: si se da, todas las operaciones devuelven ese estado.
    init(fallo: OSStatus? = nil) {
        self.fallo = fallo
    }

    var entradas: [String: Entrada] { almacen.withLock { $0 } }

    private func clave(_ consulta: [String: Any]) -> String? {
        guard (consulta[kSecClass as String] as? String) == (kSecClassGenericPassword as String),
            let servicio = consulta[kSecAttrService as String] as? String,
            let cuenta = consulta[kSecAttrAccount as String] as? String
        else { return nil }
        return servicio + "|" + cuenta
    }

    func anadir(_ atributos: [String: Any]) -> OSStatus {
        if let fallo { return fallo }
        guard let clave = clave(atributos), let datos = atributos[kSecValueData as String] as? Data else {
            return errSecParam
        }
        let accesible = atributos[kSecAttrAccessible as String] as? String
        return almacen.withLock { almacen in
            if almacen[clave] != nil { return errSecDuplicateItem }
            almacen[clave] = Entrada(datos: datos, accesible: accesible)
            return errSecSuccess
        }
    }

    func buscar(_ consulta: [String: Any]) -> (OSStatus, Data?) {
        if let fallo { return (fallo, nil) }
        guard let clave = clave(consulta) else { return (errSecParam, nil) }
        let entrada = almacen.withLock { $0[clave] }
        guard let entrada else { return (errSecItemNotFound, nil) }
        return (errSecSuccess, entrada.datos)
    }

    func actualizar(_ consulta: [String: Any], con atributos: [String: Any]) -> OSStatus {
        if let fallo { return fallo }
        guard let clave = clave(consulta), let datos = atributos[kSecValueData as String] as? Data else {
            return errSecParam
        }
        let accesible = atributos[kSecAttrAccessible as String] as? String
        return almacen.withLock { almacen in
            guard almacen[clave] != nil else { return errSecItemNotFound }
            almacen[clave] = Entrada(datos: datos, accesible: accesible)
            return errSecSuccess
        }
    }

    func borrar(_ consulta: [String: Any]) -> OSStatus {
        if let fallo { return fallo }
        guard let clave = clave(consulta) else { return errSecParam }
        return almacen.withLock { almacen in
            almacen.removeValue(forKey: clave) == nil ? errSecItemNotFound : errSecSuccess
        }
    }
}

/// Piezas comunes de los tests de red.
enum Prueba {
    static let base = URL(string: "http://umbrel.local:7792")!
    static let baseTailscale = URL(string: "http://100.101.102.103:7792")!
    static let token = "dev_iphone01.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

    static func ping() throws -> PingResponse {
        try JSONDecoder().decode(PingResponse.self, from: Fixtures.datos("v1/ping.json"))
    }

    /// Resolver que no hace ping de verdad: responde la dirección de la red local.
    static func servidores(config: ServerConfig = ServerConfig(lan: base)) throws -> ServerResolver {
        let respuesta = try ping()
        return ServerResolver(config: config) { _ in respuesta }
    }

    static func errorJSON(_ codigo: String, _ mensaje: String = "x") -> Data {
        Data(#"{"error":{"code":"\#(codigo)","message":"\#(mensaje)","requestId":"req-1"}}"#.utf8)
    }
}

/// Contador seguro entre hilos.
final class Contador: Sendable {
    private let valor = OSAllocatedUnfairLock(initialState: 0)

    @discardableResult
    func sumar() -> Int {
        valor.withLock { v in
            v += 1
            return v
        }
    }

    var actual: Int { valor.withLock { $0 } }
}

/// Falla el test si `operacion` tarda más de `segundos` (para que un fallo no cuelgue la CI).
func conPlazo<T: Sendable>(
    _ segundos: TimeInterval, _ operacion: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self, returning: T.self) { grupo in
        grupo.addTask { try await operacion() }
        grupo.addTask {
            try await Task.sleep(for: .seconds(segundos))
            throw URLError(.timedOut)
        }
        guard let primero = try await grupo.next() else { throw URLError(.unknown) }
        grupo.cancelAll()
        return primero
    }
}
