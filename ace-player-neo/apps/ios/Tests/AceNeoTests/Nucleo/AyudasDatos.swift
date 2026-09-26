import Foundation
import XCTest

@testable import AceNeo

/// Piezas de las pruebas del núcleo de datos (M1): un `Entorno` contra `MockURLProtocol`, un
/// `ContenedorApp` sin arrancar (el repartidor ya une sesión, datos y tiempo real) y un servidor
/// simulado por rutas.
@MainActor
enum PruebaDatos {
    static func directorio(_ nombre: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("AceNeoTests-\(nombre)-\(UUID().uuidString)", isDirectory: true)
    }

    static func entorno(
        token: String? = Prueba.token, config: ServerConfig = ServerConfig(lan: Prueba.base)
    ) -> (Entorno, ServerConfigStore, MemoryTokenStore) {
        let almacen = ServerConfigStore(suite: "es.ismaeloul.aceplayerneo.tests.datos.\(UUID().uuidString)")
        if !config.vacia { almacen.guardar(config) }
        let tokens = MemoryTokenStore(token: token)
        let entorno = Entorno(
            session: MockURLProtocol.sesion(), tokens: tokens, configuracion: almacen,
            cache: DiskCache(directorio: directorio("cache")), directorioImagenes: directorio("imagenes"))
        return (entorno, almacen, tokens)
    }

    static func contenedor(
        token: String? = Prueba.token, config: ServerConfig = ServerConfig(lan: Prueba.base)
    ) -> (ContenedorApp, ServerConfigStore, MemoryTokenStore) {
        let (entorno, almacen, tokens) = entorno(token: token, config: config)
        let contenedor = ContenedorApp(entorno: entorno, reloj: RelojSistema(), motor: MotorFalso())
        contenedor.tiempoReal.plazoRespaldo = .milliseconds(80)
        return (contenedor, almacen, tokens)
    }

    /// Responde por «MÉTODO /ruta» (sin la query); `ping` siempre contesta. Lo demás, 404.
    static func servir(_ tabla: [String: (Int, Data)]) throws {
        let ping = try Fixtures.datos("v1/ping.json")
        MockURLProtocol.responder { peticion in
            let clave = "\(peticion.httpMethod ?? "GET") \(peticion.url?.path() ?? "")"
            if clave == "GET /native/api/v1/ping" { return (200, [:], ping) }
            if let (estado, datos) = tabla[clave] {
                let tipo = clave.hasSuffix("/events") ? "text/event-stream" : "application/json"
                return (estado, ["Content-Type": tipo], datos)
            }
            return (404, [:], Prueba.errorJSON("not_found"))
        }
    }

    static func fixture(_ nombre: String) throws -> (Int, Data) { (200, try Fixtures.datos("v1/\(nombre).json")) }

    static func evento(_ nombre: String) throws -> SSEEvent {
        try JSONDecoder().decode(SSEEvent.self, from: Fixtures.datos("events/\(nombre).json"))
    }

    static func arranque() throws -> BootstrapResponse {
        try JSONDecoder().decode(BootstrapResponse.self, from: Fixtures.datos("v1/bootstrap.json"))
    }

    /// Cuántas peticiones se han hecho a una ruta.
    static func peticiones(_ metodo: String = "GET", _ ruta: String) -> Int {
        MockURLProtocol.peticiones.filter {
            $0.httpMethod == metodo && $0.url?.path() == "/native/api/v1/\(ruta)"
        }.count
    }

    /// Los textos de los toasts a la vista.
    static func toasts(_ avisos: Avisos) -> [String] { avisos.cola.toasts.map(\.texto) }
}

/// Espera (sin bloquear el actor principal) a que se cumpla una condición; dice si se cumplió.
@MainActor
func llegaA(_ plazo: TimeInterval = 3, _ condicion: () -> Bool) async -> Bool {
    let limite = Date().addingTimeInterval(plazo)
    while !condicion() && Date() < limite {
        try? await Task.sleep(for: .milliseconds(5))
    }
    return condicion()
}
