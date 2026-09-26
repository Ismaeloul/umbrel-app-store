#if DEBUG
    import Foundation
    import Synchronization

    /* El servidor de la demo (b-arquitectura §2.5.6 y §3.3, M2): un `URLProtocol` que contesta /native/api/v1
       con `RutasDemo` (los MISMOS datos que `?demo=1` de la web, decisión 10), sin red, sin Llavero y sin tocar lo
       guardado de verdad. Con `-AceNeoDemo` no hay SSE (la app entra en las reglas «sin SSE», como la web);
       con solo `-AceNeoServidorSimulado` el SSE simulado (`SSEDemo`) reparte los eventos de las mutaciones y el
       avance del comprobador (flujos con tiempo real de los UITests). Solo existe en Debug.

       Argumentos que lee aquí (además de los de `ModoEjecucion`, a7 §5.1 y b2 §F.4):
       - `-AceNeoHistorialCapturas`: precarga el historial del recorrido de capturas (a7 §13.3);
       - `-AceNeoServidor080`: responde 403 `origin_forbidden` en las cinco rutas de la 0.8.1 (a9 §2);
       - `-AceNeoListaLarga`: 240 favoritos más (UITest de rendimiento del desplazamiento de Canales). */

    struct OpcionesSimulado: Sendable {
        var sinEmparejar = false  // arranca en Emparejar
        var tiempoReal = false  // SSEDemo en vez de modo demo sin SSE
        var reloj: Date?  // ancla del reloj (T0 = 2026-09-24T19:00:00+02:00)
        var semilla: UInt64 = 1
        /// `-AceNeoHistorialCapturas` (a7 §13.3).
        var historialCapturas = false
        /// `-AceNeoServidor080` (a7 §13.5).
        var servidor080 = false
    }

    /// El servidor simulado del proceso: estado, reloj y si hay tiempo real.
    struct ServidorActivo: Sendable {
        let estado: EstadoDemo
        let reloj: any Reloj
        let tiempoReal: Bool
    }

    enum ServidorDemo {
        /// El token de los ejemplos (fixtures/v1/pairingClaim.json): `dev_iphone01.` + 43 «A».
        static let token = "dev_iphone01." + String(repeating: "A", count: 43)
        /// La dirección simulada del Umbrel (red de casa).
        static let direccion = URL(string: DispositivosDemo.direccion)

        /* El `URLProtocol` lo crea URLSession por su clase: no se le puede pasar el estado, así que vive aquí
           (solo Debug; lo fija `entorno(opciones:)` una vez por arranque). */
        private static let activo = Mutex<ServidorActivo?>(nil)

        static var servidor: ServidorActivo? { activo.withLock { $0 } }

        static func entorno(opciones: OpcionesSimulado) -> Entorno {
            let argumentos = ProcessInfo.processInfo.arguments
            let reloj: any Reloj = opciones.reloj.map { RelojDesplazado(inicio: $0) } ?? RelojSistema()
            let modo = ModoDemo(
                demo: !opciones.tiempoReal,
                servidor080: opciones.servidor080 || argumentos.contains("-AceNeoServidor080"),
                historialCapturas: opciones.historialCapturas || argumentos.contains("-AceNeoHistorialCapturas"),
                listaLarga: argumentos.contains("-AceNeoListaLarga"))
            let estado = EstadoDemo(modo: modo, ahora: reloj.ahora, semilla: opciones.semilla)
            let servidor = ServidorActivo(estado: estado, reloj: reloj, tiempoReal: opciones.tiempoReal)
            activo.withLock { $0 = servidor }

            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [ProtocoloDemo.self]
            let configuracion = ServerConfigStore(suite: "es.ismaeloul.aceplayerneo.demo")
            configuracion.borrar()
            let tokens = MemoryTokenStore()
            if !opciones.sinEmparejar {
                configuracion.guardar(ServerConfig(lan: direccion))
                try? tokens.guardarToken(token)
            }
            let cache = FileManager.default.temporaryDirectory
                .appendingPathComponent("AceNeoDemo-\(UUID().uuidString)", isDirectory: true)
            return Entorno(
                session: URLSession(configuration: config), tokens: tokens, configuracion: configuracion,
                cache: DiskCache(directorio: cache))
        }

        /// La petición de URLSession como la lee `RutasDemo` (el cuerpo llega por `httpBodyStream`).
        static func peticion(_ request: URLRequest) -> PeticionDemo {
            let url = request.url
            let componentes = url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
            let consulta = (componentes?.queryItems ?? []).map { (nombre: $0.name, valor: $0.value ?? "") }
            return PeticionDemo(
                metodo: request.httpMethod ?? "GET", ruta: url?.path() ?? "", consulta: consulta, cuerpo: cuerpo(request))
        }

        private static func cuerpo(_ request: URLRequest) -> Data? {
            if let cuerpo = request.httpBody { return cuerpo }
            guard let flujo = request.httpBodyStream else { return nil }
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

    /// Lo que la tarea de una respuesta necesita del `URLProtocol` (el cliente de URLSession es seguro entre hilos).
    struct EnvioDemo: @unchecked Sendable {
        let protocolo: URLProtocol

        func cabecera(_ estado: Int, tipo: String) {
            guard let url = protocolo.request.url,
                let respuesta = HTTPURLResponse(
                    url: url, statusCode: estado, httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": tipo, "Cache-Control": "no-store"])
            else {
                protocolo.client?.urlProtocol(protocolo, didFailWithError: URLError(.badURL))
                return
            }
            protocolo.client?.urlProtocol(protocolo, didReceive: respuesta, cacheStoragePolicy: .notAllowed)
        }

        func datos(_ datos: Data) { protocolo.client?.urlProtocol(protocolo, didLoad: datos) }
        func fin() { protocolo.client?.urlProtocolDidFinishLoading(protocolo) }
        func fallo(_ error: Error) { protocolo.client?.urlProtocol(protocolo, didFailWithError: error) }
    }

    /// `URLProtocol` que contesta con la demo sin salir a la red.
    final class ProtocoloDemo: URLProtocol {
        private let tarea = Mutex<Task<Void, Never>?>(nil)

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            let envio = EnvioDemo(protocolo: self)
            guard let servidor = ServidorDemo.servidor else {
                envio.fallo(URLError(.cannotConnectToHost))
                return
            }
            let peticion = ServidorDemo.peticion(request)
            if peticion.ruta.hasSuffix("/api/v1/events") && servidor.tiempoReal {
                let ultimo = request.value(forHTTPHeaderField: "Last-Event-ID").flatMap { Int($0) }
                let flujo = SSEDemo.transmitir(envio, servidor: servidor, desde: ultimo)
                tarea.withLock { $0 = flujo }
                return
            }
            let respuesta = RutasDemo.responder(peticion, estado: servidor.estado, ahora: servidor.reloj.ahora)
            let trabajo = Task {
                if respuesta.espera > 0 { try? await Task.sleep(for: .seconds(respuesta.espera)) }
                guard !Task.isCancelled else { return }
                envio.cabecera(respuesta.estado, tipo: respuesta.tipo)
                envio.datos(respuesta.cuerpo)
                envio.fin()
            }
            tarea.withLock { $0 = trabajo }
        }

        override func stopLoading() {
            tarea.withLock { tarea in
                tarea?.cancel()
                tarea = nil
            }
        }
    }
#endif
