import Foundation
import Network

/// El backend DE VERDAD de la pila E2E de la CI (`scripts/pila-e2e.mjs`:
/// motor AceStream falso + backend del monorepo con ffmpeg), visto desde las
/// pruebas de interfaz. Hace lo que en casa hace Isma desde la web: crear el
/// código de emparejamiento y revocar el iPhone.
///
/// Habla con el backend sin `/native` y sin `X-Ace-Origin` (origen `web`,
/// como las peticiones que llegan a Node sin nginx) y con un cliente HTTP/1.1
/// mínimo sobre Network.framework: ATS no deja a `URLSession` hablar con una
/// IP en claro, y el ejecutor de las pruebas no tiene excepciones propias.
struct ServidorDePruebas: Sendable {
    let puerto: UInt16

    /// Lo que deja la CI (`TEST_RUNNER_ACE_E2E_PUERTO`: xcodebuild quita el
    /// prefijo y se lo pasa al ejecutor de las pruebas). Nil fuera de la CI.
    static func desdeEntorno() -> ServidorDePruebas? {
        guard let texto = ProcessInfo.processInfo.environment["ACE_E2E_PUERTO"], let puerto = UInt16(texto) else {
            return nil
        }
        return ServidorDePruebas(puerto: puerto)
    }

    /// Dirección que se teclea en la app. `localhost` es un nombre sin dominio:
    /// ATS lo deja ir en claro con `NSAllowsLocalNetworking`, igual que un `.local`.
    var direccionApp: String { "localhost:\(puerto)" }

    /// La misma, con esquema: lo que pide el campo «Red de casa» (ejemplo de la web: http://umbrel.local:7792).
    var direccionConEsquema: String { "http://\(direccionApp)" }

    struct Codigo: Sendable {
        let codigo: String
        /// `aceneo://pair?u=…&c=…`: lo que lleva el QR de la web.
        let enlace: String
    }

    enum Fallo: Error, CustomStringConvertible {
        case respuesta(Int, String)
        case formato(String)

        var description: String {
            switch self {
            case .respuesta(let estado, let cuerpo): "El backend respondió \(estado): \(cuerpo.prefix(300))"
            case .formato(let detalle): "Respuesta inesperada del backend: \(detalle)"
            }
        }
    }

    /// `POST /api/v1/pairing` como la web: código de 6 dígitos y enlace del QR.
    func crearCodigo() async throws -> Codigo {
        let cuerpo = Data(#"{"baseUrl":"http://\#(direccionApp)"}"#.utf8)
        let respuesta = try await HTTPCrudo.enviar("POST", puerto: puerto, ruta: "/api/v1/pairing", cuerpo: cuerpo)
        let objeto = try respuesta.json()
        guard let codigo = objeto["code"] as? String, let enlace = objeto["pairUri"] as? String else {
            throw Fallo.formato(respuesta.texto)
        }
        return Codigo(codigo: codigo, enlace: enlace)
    }

    /// Un dispositivo emparejado, como lo ve la web (`GET /api/v1/devices`).
    struct Dispositivo: Sendable {
        let id: String
        let nombre: String
        let plataforma: String
        let revocado: Bool
    }

    /// Todos los dispositivos (vivos y revocados).
    func dispositivos() async throws -> [Dispositivo] {
        let lista = try await HTTPCrudo.enviar("GET", puerto: puerto, ruta: "/api/v1/devices").json()
        guard let crudos = lista["devices"] as? [[String: Any]] else { throw Fallo.formato("sin «devices»") }
        return crudos.compactMap { (d: [String: Any]) -> Dispositivo? in
            guard let id = d["id"] as? String else { return nil }
            let revocado = !(d["revokedAt"] == nil || d["revokedAt"] is NSNull)
            let nombre = d["name"] as? String ?? ""
            let plataforma = d["platform"] as? String ?? ""
            return Dispositivo(id: id, nombre: nombre, plataforma: plataforma, revocado: revocado)
        }
    }

    /// Empareja OTRO aparato (como un iPad): código de la web y `POST /native/api/v1/pairing/claim` con el
    /// prefijo /native (origen `native`, como detrás de nginx). Devuelve su id.
    func emparejarOtro(nombre: String) async throws -> String {
        let codigo = try await crearCodigo()
        let objeto: [String: String] = ["code": codigo.codigo, "name": nombre, "platform": "ipados"]
        let cuerpo = try JSONSerialization.data(withJSONObject: objeto)
        let respuesta = try await HTTPCrudo.enviar("POST", puerto: puerto, ruta: "/native/api/v1/pairing/claim", cuerpo: cuerpo)
        guard let id = try respuesta.json()["deviceId"] as? String else { throw Fallo.formato(respuesta.texto) }
        return id
    }

    /// Revoca todos los dispositivos vivos (`DELETE /api/v1/devices/:id`) y dice cuántos.
    @discardableResult
    func revocarTodos() async throws -> Int {
        let lista = try await HTTPCrudo.enviar("GET", puerto: puerto, ruta: "/api/v1/devices").json()
        guard let dispositivos = lista["devices"] as? [[String: Any]] else {
            throw Fallo.formato("sin «devices»")
        }
        let vivos = dispositivos.compactMap { dispositivo -> String? in
            guard let id = dispositivo["id"] as? String,
                dispositivo["revokedAt"] == nil || dispositivo["revokedAt"] is NSNull
            else { return nil }
            return id
        }
        for id in vivos {
            _ = try await HTTPCrudo.enviar("DELETE", puerto: puerto, ruta: "/api/v1/devices/\(id)").json()
        }
        return vivos.count
    }
}

/// HTTP/1.1 mínimo sobre `NWConnection` (Network.framework no pasa por ATS).
/// Una petición por conexión (`Connection: close`): se lee hasta el cierre.
enum HTTPCrudo {
    struct Respuesta: Sendable {
        let estado: Int
        let cuerpo: Data

        var texto: String { String(decoding: cuerpo, as: UTF8.self) }

        /// El cuerpo como objeto JSON; un estado que no es 2xx es un fallo.
        func json() throws -> [String: Any] {
            guard (200..<300).contains(estado) else { throw ServidorDePruebas.Fallo.respuesta(estado, texto) }
            guard let objeto = try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any] else {
                throw ServidorDePruebas.Fallo.formato(texto)
            }
            return objeto
        }
    }

    enum Error: Swift.Error, CustomStringConvertible {
        case conexion(String)
        case plazo
        case cabecera

        var description: String {
            switch self {
            case .conexion(let detalle): "No se pudo hablar con el backend de pruebas: \(detalle)"
            case .plazo: "El backend de pruebas no contestó a tiempo"
            case .cabecera: "Respuesta HTTP sin cabecera válida"
            }
        }
    }

    static func enviar(
        _ metodo: String, puerto: UInt16, ruta: String, cuerpo: Data? = nil, plazo: TimeInterval = 30
    ) async throws -> Respuesta {
        var cabecera = "\(metodo) \(ruta) HTTP/1.1\r\nHost: 127.0.0.1:\(puerto)\r\nAccept: application/json\r\nConnection: close\r\n"
        if let cuerpo {
            cabecera += "Content-Type: application/json\r\nContent-Length: \(cuerpo.count)\r\n"
        }
        cabecera += "\r\n"
        var peticion = Data(cabecera.utf8)
        if let cuerpo { peticion.append(cuerpo) }
        let crudo = try await Intercambio(puerto: puerto).ejecutar(peticion, plazo: plazo)
        return try analizar(crudo)
    }

    /// Separa la línea de estado, las cabeceras y el cuerpo (con o sin `chunked`).
    static func analizar(_ crudo: Data) throws -> Respuesta {
        let separador = Data("\r\n\r\n".utf8)
        guard let corte = crudo.range(of: separador) else { throw Error.cabecera }
        let cabecera = String(decoding: crudo[..<corte.lowerBound], as: UTF8.self)
        var cuerpo = Data(crudo[corte.upperBound...])
        let lineas = cabecera.components(separatedBy: "\r\n")
        let partes = lineas.first?.split(separator: " ") ?? []
        guard partes.count >= 2, let estado = Int(partes[1]) else { throw Error.cabecera }
        let troceado = lineas.dropFirst().contains {
            $0.lowercased().hasPrefix("transfer-encoding:") && $0.lowercased().contains("chunked")
        }
        if troceado { cuerpo = desTrocear(cuerpo) }
        return Respuesta(estado: estado, cuerpo: cuerpo)
    }

    static func desTrocear(_ datos: Data) -> Data {
        var resultado = Data()
        var resto = datos[...]
        let fin = Data("\r\n".utf8)
        while let linea = resto.range(of: fin) {
            let tamanoTexto = String(decoding: resto[..<linea.lowerBound], as: UTF8.self)
                .split(separator: ";").first.map(String.init) ?? ""
            guard let tamano = Int(tamanoTexto.trimmingCharacters(in: .whitespaces), radix: 16), tamano > 0 else {
                break
            }
            let inicio = linea.upperBound
            guard resto.distance(from: inicio, to: resto.endIndex) >= tamano else { break }
            let final = resto.index(inicio, offsetBy: tamano)
            resultado.append(resto[inicio..<final])
            resto = resto[final...].dropFirst(2)
        }
        return resultado
    }

    /// Una conexión: envía la petición, lee hasta que el servidor cierra y
    /// entrega los bytes una sola vez (éxito, fallo o plazo).
    private final class Intercambio: @unchecked Sendable {
        private let conexion: NWConnection
        private let cola = DispatchQueue(label: "es.ismaeloul.aceplayerneo.uitests.http")
        private let candado = NSLock()
        private var recibido = Data()
        private var continuacion: CheckedContinuation<Data, Swift.Error>?

        init(puerto: UInt16) {
            conexion = NWConnection(
                host: NWEndpoint.Host("127.0.0.1"), port: NWEndpoint.Port(rawValue: puerto) ?? .http, using: .tcp)
        }

        func ejecutar(_ peticion: Data, plazo: TimeInterval) async throws -> Data {
            try await withCheckedThrowingContinuation { (continuacion: CheckedContinuation<Data, Swift.Error>) in
                candado.lock()
                self.continuacion = continuacion
                candado.unlock()
                conexion.stateUpdateHandler = { [self] estado in
                    switch estado {
                    case .ready:
                        conexion.send(
                            content: peticion,
                            completion: .contentProcessed { [self] error in
                                if let error { terminar(.failure(Error.conexion("\(error)"))) } else { leer() }
                            })
                    case .waiting(let error), .failed(let error):
                        terminar(.failure(Error.conexion("\(error)")))
                    default:
                        break
                    }
                }
                conexion.start(queue: cola)
                cola.asyncAfter(deadline: .now() + plazo) { [self] in terminar(.failure(Error.plazo)) }
            }
        }

        private func leer() {
            conexion.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { [self] datos, _, completo, error in
                if let datos, !datos.isEmpty {
                    candado.lock()
                    recibido.append(datos)
                    candado.unlock()
                }
                if completo {
                    candado.lock()
                    let todo = recibido
                    candado.unlock()
                    terminar(.success(todo))
                } else if let error {
                    terminar(.failure(Error.conexion("\(error)")))
                } else {
                    leer()
                }
            }
        }

        private func terminar(_ resultado: Result<Data, Swift.Error>) {
            candado.lock()
            let pendiente = continuacion
            continuacion = nil
            candado.unlock()
            guard let pendiente else { return }
            conexion.cancel()
            pendiente.resume(with: resultado)
        }
    }
}
