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
    public let configuracion: ServerConfigStore
    /// Avisa cuando el servidor dice que el token ya no vale (401).
    public let accesoPerdido: AsyncStream<Void>

    public init(
        session: URLSession, tokens: any TokenStore, configuracion: ServerConfigStore, cache: DiskCache
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
    }

    /// El de verdad: Llavero, `UserDefaults` y caché en disco.
    public static func real() -> Entorno {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = false
        config.httpMaximumConnectionsPerHost = 6
        // ETag / 304 de la agenda y del arranque sin trabajo extra.
        config.requestCachePolicy = .useProtocolCachePolicy
        config.urlCache = URLCache(memoryCapacity: 4 << 20, diskCapacity: 32 << 20)
        return Entorno(
            session: URLSession(configuration: config), tokens: KeychainTokenStore(),
            configuracion: ServerConfigStore(), cache: DiskCache())
    }

    /// El que toca según cómo se ha lanzado la app.
    public static func actual() -> Entorno {
        #if DEBUG
            if ModoEjecucion.servidorSimulado { return ServidorSimulado.entorno() }
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

/// Cómo se ha lanzado el proceso.
public enum ModoEjecucion {
    /// Dentro de los tests unitarios (la app hace de anfitriona y no debe arrancar nada).
    public static var testsUnitarios: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            && !servidorSimulado
    }

    /// Pruebas de interfaz: servidor simulado y nada persistente.
    public static var servidorSimulado: Bool {
        ProcessInfo.processInfo.arguments.contains("-AceNeoServidorSimulado")
    }

    /// Prueba de interfaz contra el backend de verdad (pila E2E de la CI): la
    /// app de siempre, pero arrancando sin emparejar. Solo cuenta en Debug.
    public static var empezarDeCero: Bool {
        ProcessInfo.processInfo.arguments.contains("-AceNeoEmpezarDeCero")
    }

    /// Apariencia forzada para las capturas (`-AceNeoApariencia claro|oscuro`,
    /// que el sistema deja en el dominio de argumentos de `UserDefaults`).
    /// Solo en Debug: en la IPA manda siempre la del sistema.
    public static var aparienciaForzada: String? {
        #if DEBUG
            return UserDefaults.standard.string(forKey: "AceNeoApariencia")
        #else
            return nil
        #endif
    }
}
