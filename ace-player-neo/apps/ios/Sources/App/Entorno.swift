import Foundation

/// Todas las dependencias de la app en un sitio: se crean una vez al
/// arrancar y se pasan a los modelos de pantalla. En las pruebas de interfaz
/// se sustituyen por un servidor simulado (ver `ServidorSimulado`).
public struct Entorno: Sendable {
    public let api: APIClient
    public let servidores: ServerResolver
    public let tokens: any TokenStore
    public let tiempoReal: SSEClient
    public let cache: DiskCache
    /// Escudos y logos, en memoria y en disco.
    public let imagenes: CacheImagenes
    public let configuracion: ServerConfigStore
    /// Avisa cuando el servidor dice que el token ya no vale (401); el código queda en
    /// `api.ultimoCodigoAccesoPerdido` (lo escucha `SesionApp`).
    public let accesoPerdido: AsyncStream<Void>

    public init(
        session: URLSession, tokens: any TokenStore, configuracion: ServerConfigStore, cache: DiskCache,
        directorioImagenes: URL? = nil
    ) {
        let (avisos, continuacion) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let servidores = ServerResolver(config: configuracion.leer(), session: session)
        self.servidores = servidores
        self.tokens = tokens
        self.cache = cache
        self.configuracion = configuracion
        self.accesoPerdido = avisos
        self.api = APIClient(session: session, servidores: servidores, tokens: tokens) {
            _ = continuacion.yield()
        }
        self.tiempoReal = SSEClient(session: session, servidores: servidores, tokens: tokens)
        // Las imágenes van con el mismo `Bearer` que el resto de la API. Las de la agenda llegan con el
        // anfitrión simbólico de `RutaImagen`: aquí se cambia por la dirección que responda ahora.
        self.imagenes = CacheImagenes(session: session, directorio: directorioImagenes) { simbolica in
            var url = simbolica
            if simbolica.scheme == RutaImagen.esquema {
                let base = try await servidores.actual().url
                guard let real = RutaImagen.resolver(simbolica, base: base) else { throw APIError.sinServidor }
                url = real
            }
            var peticion = URLRequest(url: url, timeoutInterval: 20)
            peticion.setValue("image/png, image/*", forHTTPHeaderField: "Accept")
            if let token = try? tokens.leerToken(), !token.isEmpty {
                peticion.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            return peticion
        }
    }

    /// El de verdad: Llavero, `UserDefaults` y caché en disco.
    public static func real() -> Entorno {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = false
        config.httpMaximumConnectionsPerHost = 6
        // ETag / 304 de la agenda, del arranque y de los escudos. Cada petición de la API pone su política
        // (GET revalida, el resto no usa la caché: `Endpoint.peticion`, a7 §3.1).
        config.requestCachePolicy = .useProtocolCachePolicy
        config.urlCache = URLCache(memoryCapacity: 4 << 20, diskCapacity: 32 << 20)
        return Entorno(
            session: URLSession(configuration: config), tokens: KeychainTokenStore(),
            configuracion: ServerConfigStore(), cache: DiskCache())
    }

    /// El que toca según cómo se ha lanzado la app.
    public static func actual() -> Entorno {
        #if DEBUG
            // El banco y la galería no hablan con ningún servidor: la demo sin SSE.
            if ModoEjecucion.demo || ModoEjecucion.servidorSimulado || ModoEjecucion.laboratorio || ModoEjecucion.sistema {
                return ServidorDemo.entorno(opciones: ModoEjecucion.opcionesSimulado)
            }
            if ModoEjecucion.empezarDeCero { olvidarTodo() }
        #endif
        return real()
    }

    #if DEBUG
        /// Prueba contra el backend de verdad (`-AceNeoEmpezarDeCero`): sin
        /// token, sin direcciones y sin caché, como recién instalada.
        private static func olvidarTodo() {
            try? KeychainTokenStore().borrarToken()
            ServerConfigStore().borrar()
            let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("AceNeo", isDirectory: true)
            try? FileManager.default.removeItem(at: cache)
        }
    #endif
}

/// Cómo se ha lanzado el proceso: los argumentos de lanzamiento de b-arquitectura §3.3.1 (I0 los
/// declara; M2 los hace funcionar). Todos cuentan SOLO en Debug: en la IPA (Release) son `false`/`nil`.
public enum ModoEjecucion {
    /// Dentro de los tests unitarios (la app hace de anfitriona y no debe arrancar nada).
    public static var testsUnitarios: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            && !servidorSimulado && !demo
    }

    /// `-AceNeoDemo`: `ServidorDemo` sin SSE y `modoDemo = true` («Modo demo» en vez del motor), como `?demo=1`.
    static var demo: Bool { argumento("-AceNeoDemo") }

    /// `-AceNeoServidorSimulado`: `ServidorDemo` + `SSEDemo`, sin la cápsula de demo (flujos con tiempo real).
    public static var servidorSimulado: Bool { argumento("-AceNeoServidorSimulado") }

    /// `-AceNeoSinEmparejar` (con uno de los dos anteriores): arranca en Emparejar (código de la demo 482913).
    static var sinEmparejar: Bool { argumento("-AceNeoSinEmparejar") }

    /// `-AceNeoReloj <ISO 8601>`: `RelojDesplazado` desde esa hora (capturas: 2026-09-24T19:00:00+02:00).
    static var reloj: Date? {
        guard let texto = valor("AceNeoReloj") else { return nil }
        return ISO8601DateFormatter().date(from: texto)
    }

    /// `-AceNeoEscena <vista>`: `EscenasCaptura` deja la app en esa vista de `final/` (I2).
    static var escena: String? { valor("AceNeoEscena") }

    /// `-AceNeoTransparenciaReducida`: fuerza la transparencia reducida de la app.
    static var transparenciaReducida: Bool { argumento("-AceNeoTransparenciaReducida") }

    /// `-AceNeoMovimientoReducido`: fuerza el movimiento reducido (capturas).
    static var movimientoReducido: Bool { argumento("-AceNeoMovimientoReducido") }

    /// `-AceNeoLaboratorio`: abre el banco de la fase 0 (P).
    static var laboratorio: Bool { argumento("-AceNeoLaboratorio") }

    /// `-AceNeoSistema`: abre la galería «Sistema» (P).
    static var sistema: Bool { argumento("-AceNeoSistema") }

    /// `-AceNeoDesplazar <pt>`: el banco o la galería abren desplazados (capturas por tramos).
    static var desplazar: Double { Double(valor("AceNeoDesplazar") ?? "") ?? 0 }

    /// `-AceNeoLaboratorioSeccion <n>`: el banco enseña solo el bloque n (capturas por bloque).
    static var seccionLaboratorio: Int? { Int(valor("AceNeoLaboratorioSeccion") ?? "") }

    /// Prueba de interfaz contra el backend de verdad (pila E2E de la CI): la
    /// app de siempre, pero arrancando sin emparejar. Solo cuenta en Debug.
    public static var empezarDeCero: Bool { argumento("-AceNeoEmpezarDeCero") }

    /// Apariencia forzada para las capturas (`-AceNeoApariencia claro|oscuro`,
    /// que el sistema deja en el dominio de argumentos de `UserDefaults`).
    /// Solo en Debug: en la IPA manda siempre la del sistema.
    public static var aparienciaForzada: String? { valor("AceNeoApariencia") }

    #if DEBUG
        /// Las opciones de `ServidorDemo` que salen de los argumentos.
        static var opcionesSimulado: OpcionesSimulado {
            OpcionesSimulado(sinEmparejar: sinEmparejar, tiempoReal: servidorSimulado && !demo, reloj: reloj)
        }
    #endif

    /// Un argumento suelto (`-AceNeoX`). Solo en Debug.
    private static func argumento(_ nombre: String) -> Bool {
        #if DEBUG
            return ProcessInfo.processInfo.arguments.contains(nombre)
        #else
            return false
        #endif
    }

    /// El valor de `-Clave valor` (el sistema lo deja en el dominio de argumentos de `UserDefaults`). Solo en Debug.
    private static func valor(_ clave: String) -> String? {
        #if DEBUG
            return UserDefaults.standard.string(forKey: clave)
        #else
            return nil
        #endif
    }
}
