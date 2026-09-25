import XCTest

@testable import AceNeo

/// SesionApp (b-arquitectura §2.5.4; a7 §5, a2 §23, a9 §3.5 y §9): arranque, backend no disponible,
/// acceso perdido (conserva las direcciones), olvidar este iPhone (revoca, borra y vuelve sin aviso; 401 y
/// 404 también salen; 403 es un servidor 0.8.0), `aceneo://pair` emparejada y capacidades.
final class SesionAppTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.limpiar()
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    /// El servidor de la pila E2E en pequeño: arranque, agenda y un SSE que cierra enseguida.
    @MainActor
    private func servirArranque(_ extra: [String: (Int, Data)] = [:]) throws {
        var tabla: [String: (Int, Data)] = [
            "GET /native/api/v1/bootstrap": try PruebaDatos.fixture("bootstrap"),
            "GET /native/api/v1/football": try PruebaDatos.fixture("footballSchedule"),
            "GET /native/api/v1/events": (200, Data(": ping\n\n".utf8)),
        ]
        tabla.merge(extra) { _, nuevo in nuevo }
        try PruebaDatos.servir(tabla)
    }

    /// Hay token y direcciones: la fase es la app (la 0.8.0 deja las mismas claves: sigue emparejada).
    @MainActor
    func testFaseInicial() {
        XCTAssertEqual(PruebaDatos.contenedor().0.sesion.fase, .app)
        XCTAssertEqual(PruebaDatos.contenedor(token: nil).0.sesion.fase, .emparejar(nil))
        XCTAssertEqual(PruebaDatos.contenedor(config: ServerConfig()).0.sesion.fase, .emparejar(nil))
        XCTAssertEqual(PruebaDatos.contenedor().0.sesion.dispositivo, "dev_iphone01")
    }

    /// Arranque: `bootstrap` y agenda a la vez, siembra, conectado y tiempo real en marcha.
    @MainActor
    func testArranqueSiembraYAbreElTiempoReal() async throws {
        try servirArranque()
        let (c, _, _) = PruebaDatos.contenedor()
        await c.sesion.arrancar()
        XCTAssertNotNil(c.datos.biblioteca.datos)
        XCTAssertNotNil(c.datos.agenda.datos)
        XCTAssertNotNil(c.datos.motor.datos)
        XCTAssertEqual(c.sesion.versionServidor, "0.7.0")
        XCTAssertEqual(c.sesion.dispositivo, "dev_iphone01")
        XCTAssertEqual(c.sesion.conexion, .conectado(.lan))
        XCTAssertNotEqual(c.tiempoReal.estado, .inactivo)
        XCTAssertEqual(PruebaDatos.peticiones("GET", "bootstrap"), 1)
        XCTAssertEqual(PruebaDatos.peticiones("GET", "library"), 0, "La biblioteca sale del arranque")
        XCTAssertTrue(PruebaDatos.toasts(c.avisos).isEmpty)
        c.tiempoReal.parar()
    }

    /// Sin servidor: toast warn «Backend no disponible; la app seguirá reintentando», una vez (a2 §23.1).
    @MainActor
    func testSinServidorAvisaUnaVez() async throws {
        MockURLProtocol.responder { _ in throw URLError(.cannotConnectToHost) }
        let (c, _, _) = PruebaDatos.contenedor()
        c.datos.arranque.esperarReintento = { _ in }
        c.datos.agenda.esperarReintento = { _ in }
        await c.sesion.arrancar()
        XCTAssertEqual(c.sesion.conexion, .backendNoDisponible)
        XCTAssertEqual(PruebaDatos.toasts(c.avisos), ["Backend no disponible; la app seguirá reintentando"])
        XCTAssertEqual(c.avisos.cola.toasts.first?.tono, .warn)
        c.tiempoReal.parar()
    }

    /// Acceso perdido: token y cachés fuera, direcciones dentro, una sola vez y con el primer motivo.
    @MainActor
    func testAccesoPerdidoConservaLasDirecciones() async throws {
        let (c, almacen, tokens) = PruebaDatos.contenedor()
        c.datos.sembrar(con: try PruebaDatos.arranque())
        var motivos: [MotivoEmparejar] = []
        c.sesion.alPerderAcceso = { motivos.append($0) }
        await c.sesion.accesoPerdido(.dispositivoRetirado)
        await c.sesion.accesoPerdido(.noAutorizado)
        XCTAssertEqual(c.sesion.fase, .emparejar(.dispositivoRetirado))
        XCTAssertEqual(motivos, [.dispositivoRetirado])
        XCTAssertNil(try tokens.leerToken())
        XCTAssertEqual(almacen.leer(), ServerConfig(lan: Prueba.base))
        XCTAssertNil(c.datos.biblioteca.datos)
        XCTAssertEqual(c.tiempoReal.estado, .inactivo)
    }

    /// Un 401 `device_revoked` de cualquier petición es acceso perdido con ese motivo (a2 §23.3).
    @MainActor
    func test401DeUnaPeticion() async throws {
        try PruebaDatos.servir(["GET /native/api/v1/library": (401, Prueba.errorJSON("device_revoked"))])
        let (c, almacen, _) = PruebaDatos.contenedor()
        await c.datos.biblioteca.refrescar()
        let fuera = await llegaA { c.sesion.fase == .emparejar(.dispositivoRetirado) }
        XCTAssertTrue(fuera)
        XCTAssertFalse(almacen.leer().vacia)
    }

    /// Olvidar este iPhone: DELETE del propio, token y cachés fuera, direcciones dentro, sin aviso.
    @MainActor
    func testOlvidarEsteIPhone() async throws {
        try PruebaDatos.servir(["DELETE /native/api/v1/devices/dev_iphone01": try PruebaDatos.fixture("deviceRevoke")])
        let (c, almacen, tokens) = PruebaDatos.contenedor()
        c.datos.sembrar(con: try PruebaDatos.arranque())
        var motivos: [MotivoEmparejar] = []
        c.sesion.alPerderAcceso = { motivos.append($0) }
        await c.sesion.olvidarEsteIPhone()
        XCTAssertEqual(PruebaDatos.peticiones("DELETE", "devices/dev_iphone01"), 1)
        XCTAssertEqual(c.sesion.fase, .emparejar(.olvidadoAqui))
        XCTAssertEqual(motivos, [.olvidadoAqui])
        XCTAssertNil(try tokens.leerToken())
        XCTAssertEqual(almacen.leer(), ServerConfig(lan: Prueba.base))
        XCTAssertFalse(c.sesion.olvidando)
        XCTAssertTrue(PruebaDatos.toasts(c.avisos).isEmpty)
    }

    /// 401 (otro se adelantó) y 404 (el servidor ya no lo conoce) también son salir (a9 §3.5.2).
    @MainActor
    func testOlvidarCon401O404TambienSale() async throws {
        for (estado, codigo) in [(401, "device_revoked"), (404, "device_not_found")] {
            MockURLProtocol.limpiar()
            try PruebaDatos.servir(["DELETE /native/api/v1/devices/dev_iphone01": (estado, Prueba.errorJSON(codigo))])
            let (c, _, _) = PruebaDatos.contenedor()
            var avisosAcceso = 0
            c.sesion.alPerderAcceso = { _ in avisosAcceso += 1 }
            await c.sesion.olvidarEsteIPhone()
            XCTAssertEqual(c.sesion.fase, .emparejar(.olvidadoAqui), codigo)
            XCTAssertEqual(avisosAcceso, 1, "El 401 del DELETE no provoca un segundo acceso perdido (\(codigo))")
        }
    }

    /// 403 `origin_forbidden` (servidor 0.8.0): no sale, apunta la capacidad y avisa; luego, olvido local.
    @MainActor
    func testOlvidarConUnServidorViejo() async throws {
        let prohibido = Prueba.errorJSON("origin_forbidden", "Esta función no está disponible desde aquí.")
        try PruebaDatos.servir(["DELETE /native/api/v1/devices/dev_iphone01": (403, prohibido)])
        let (c, _, tokens) = PruebaDatos.contenedor()
        await c.sesion.olvidarEsteIPhone()
        XCTAssertEqual(c.sesion.fase, .app)
        XCTAssertTrue(c.sesion.capacidades.cerrada(.deviceRevoke))
        XCTAssertEqual(PruebaDatos.toasts(c.avisos), [SesionApp.textoOlvidarViejo])
        XCTAssertNotNil(try tokens.leerToken())

        // Plan B local (a9 §9.1.3): el segundo intento no llama al DELETE.
        await c.sesion.olvidarEsteIPhone()
        XCTAssertEqual(c.sesion.fase, .emparejar(.olvidadoAqui))
        XCTAssertEqual(PruebaDatos.peticiones("DELETE", "devices/dev_iphone01"), 1)
    }

    /// Sin red no se sabe si se revocó: no sale y lo dice (a9 §3.5.2).
    @MainActor
    func testOlvidarSinRedNoSale() async throws {
        MockURLProtocol.responder { peticion in
            if peticion.url?.path() == "/native/api/v1/ping" { return (200, [:], try Fixtures.datos("v1/ping.json")) }
            throw URLError(.networkConnectionLost)
        }
        let (c, _, _) = PruebaDatos.contenedor()
        await c.sesion.olvidarEsteIPhone()
        XCTAssertEqual(c.sesion.fase, .app)
        XCTAssertEqual(
            PruebaDatos.toasts(c.avisos),
            ["No se pudo olvidar este iPhone. No hay conexión con el Umbrel. Comprueba la red; la app seguirá reintentando."])
    }

    /// `aceneo://pair` con la app emparejada → hoja «¿Emparejar con otro servidor?»; sin emparejar, a la pantalla.
    @MainActor
    func testEnlaceDeEmparejar() throws {
        let enlace = try XCTUnwrap(URL(string: "aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792&c=482913"))
        let (emparejada, _, _) = PruebaDatos.contenedor()
        emparejada.sesion.abrir(enlace: enlace)
        XCTAssertEqual(emparejada.sesion.enlacePendiente?.codigo, "482913")
        XCTAssertNil(emparejada.sesion.enlaceParaEmparejar)
        let (nueva, _, _) = PruebaDatos.contenedor(token: nil)
        nueva.sesion.abrir(enlace: enlace)
        XCTAssertEqual(nueva.sesion.enlaceParaEmparejar?.codigo, "482913")
        XCTAssertNil(nueva.sesion.enlacePendiente)
    }

    /// 403 `origin_forbidden` → capacidades (sin comparar versiones); un 2xx lo olvida (a9 §9.1.1).
    @MainActor
    func testCapacidadesDeUnServidorViejo() async throws {
        let prohibido = Prueba.errorJSON("origin_forbidden", "Esta función no está disponible desde aquí.")
        try PruebaDatos.servir([
            "GET /native/api/v1/health": (403, prohibido),
            "GET /native/api/v1/devices": try PruebaDatos.fixture("devicesList"),
        ])
        let (c, _, _) = PruebaDatos.contenedor()
        await c.datos.salud.refrescar()
        XCTAssertTrue(c.sesion.capacidades.servidorViejo)
        XCTAssertTrue(c.sesion.capacidades.cerrada(.health))
        await c.datos.dispositivos.refrescar()
        XCTAssertFalse(c.sesion.capacidades.servidorViejo)
    }

    /// El cuerpo de `POST pairing`: la dirección que se usa ahora y la otra (a9 §3.4).
    @MainActor
    func testCuerpoParaCodigo() async throws {
        try servirArranque()
        let (c, _, _) = PruebaDatos.contenedor(config: ServerConfig(tailscale: Prueba.baseTailscale, lan: Prueba.base))
        _ = try await c.entorno.servidores.probarYFijar(Prueba.base)
        let cuerpo = await c.sesion.cuerpoParaCodigo()
        XCTAssertEqual(cuerpo.baseUrl, "http://umbrel.local:7792")
        XCTAssertEqual(cuerpo.alternateBaseUrls, ["http://100.101.102.103:7792"])
    }

    /// El canje ha ido bien: a la app, con las capacidades olvidadas y el arranque hecho.
    @MainActor
    func testEmparejadoArranca() async throws {
        try servirArranque()
        let (c, almacen, tokens) = PruebaDatos.contenedor(token: nil)
        XCTAssertEqual(c.sesion.fase, .emparejar(nil))
        let respuesta = try JSONDecoder().decode(PairingClaimResponse.self, from: Fixtures.datos("v1/pairingClaim.json"))
        try tokens.guardarToken(respuesta.token)
        await c.sesion.emparejado(respuesta, servidores: [Prueba.base])
        XCTAssertEqual(c.sesion.fase, .app)
        XCTAssertEqual(c.sesion.dispositivo, respuesta.deviceId)
        XCTAssertNotNil(c.datos.biblioteca.datos)
        XCTAssertFalse(almacen.leer().vacia)
        c.tiempoReal.parar()
    }
}
