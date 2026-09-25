import XCTest

@testable import AceNeo

/// DatosApp (b-arquitectura §2.5.2; a7 §4.3, §5): sembrar del arranque, escrituras directas de cada
/// mutación, invalidar por ruta, pintar en frío, vaciar y las capacidades de las rutas 0.8.1.
final class DatosAppTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.limpiar()
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    @MainActor
    private func datos() -> (DatosApp, DiskCache) {
        let (entorno, _, _) = PruebaDatos.entorno()
        return (DatosApp(api: entorno.api, cache: entorno.cache), entorno.cache)
    }

    /// `seedFromBootstrap`: arranque, biblioteca, gustos, reproducción y motor con UNA petición.
    @MainActor
    func testSembrarDelArranque() throws {
        let (datos, _) = datos()
        let arranque = try PruebaDatos.arranque()
        datos.sembrar(con: arranque)
        XCTAssertEqual(datos.arranque.datos, arranque)
        XCTAssertEqual(datos.biblioteca.datos, arranque.library)
        XCTAssertEqual(datos.preferencias.datos?.preferences, arranque.preferences)
        XCTAssertEqual(datos.reproduccion.datos, arranque.playback)
        XCTAssertEqual(datos.motor.datos, arranque.engine)
        XCTAssertNil(datos.ajustes.datos)  // la web no siembra settingsGet
        XCTAssertNotNil(datos.biblioteca.actualizadaEn)
        XCTAssertTrue(MockURLProtocol.peticiones.isEmpty)
    }

    /// `setLibraryData`: biblioteca y, con sus canales y listas, directorios.
    @MainActor
    func testMutarBibliotecaEscribeBibliotecaYDirectorios() async throws {
        try PruebaDatos.servir(["POST /native/api/v1/library": try PruebaDatos.fixture("libraryMutate")])
        let (datos, _) = datos()
        try await datos.mutarBiblioteca(.delete(collection: .favorites, id: String(repeating: "a", count: 40)))
        let vista = try XCTUnwrap(datos.biblioteca.datos)
        XCTAssertEqual(datos.directorios.datos, DatosApp.directorios(de: vista))
        XCTAssertEqual(PruebaDatos.peticiones("POST", "library"), 1)
    }

    /// Gustos: la consulta y el `bootstrap.preferences` de la caché.
    @MainActor
    func testGuardarPreferenciasEscribeTambienElArranque() async throws {
        try PruebaDatos.servir(["PUT /native/api/v1/preferences": try PruebaDatos.fixture("preferencesUpdate")])
        let (datos, _) = datos()
        datos.sembrar(con: try PruebaDatos.arranque())
        try await datos.guardarPreferencias(PreferencesInput(onboardingComplete: true, leagues: ["LaLiga"]))
        XCTAssertEqual(datos.preferencias.datos?.preferences.leagues, ["LaLiga", "Champions League"])
        XCTAssertEqual(datos.arranque.datos?.preferences, datos.preferencias.datos?.preferences)
    }

    /// `applyDirectoryView`: directorios y, encima de la biblioteca, sus canales y listas.
    @MainActor
    func testListasEscribenDirectoriosYLaBiblioteca() async throws {
        try PruebaDatos.servir([
            "POST /native/api/v1/directories/principal/activate": try PruebaDatos.fixture("directoriesActivate")
        ])
        let (datos, _) = datos()
        let arranque = try PruebaDatos.arranque()
        datos.sembrar(con: arranque)
        try await datos.activarLista(id: "principal")
        let directorios = try XCTUnwrap(datos.directorios.datos)
        XCTAssertEqual(datos.biblioteca.datos?.web, directorios.web)
        XCTAssertEqual(datos.biblioteca.datos?.activeWebSourceId, directorios.activeWebSourceId)
        XCTAssertEqual(datos.biblioteca.datos?.favorites, arranque.library.favorites)  // lo demás se queda
    }

    @MainActor
    func testGuardarAjustesEscribeLosAjustes() async throws {
        try PruebaDatos.servir(["PUT /native/api/v1/settings": try PruebaDatos.fixture("settingsUpdate")])
        let (datos, _) = datos()
        var abiertas: [RutaAdministracion] = []
        datos.alAbrirAdministracion = { abiertas.append($0) }
        try await datos.guardarAjustes(SettingsUpdateBody(sameChannelPolicy: .handoff))
        XCTAssertNotNil(datos.ajustes.datos)
        XCTAssertEqual(abiertas, [.settingsUpdate])
    }

    /// Al pulsar, el motor pasa a «reiniciando» (a7 §4.3).
    @MainActor
    func testReiniciarMotorPasaAReiniciando() async throws {
        try PruebaDatos.servir(["POST /native/api/v1/engine/restart": try PruebaDatos.fixture("engineRestart")])
        let (datos, _) = datos()
        datos.sembrar(con: try PruebaDatos.arranque())
        _ = try await datos.reiniciarMotor()
        XCTAssertEqual(datos.motor.datos?.status, .restarting)
        XCTAssertEqual(datos.motor.datos?.online, false)
    }

    /// Un 403 `origin_forbidden` (servidor 0.8.0) se apunta, sin reintentos (es un 4xx).
    @MainActor
    func testUnServidorViejoCierraLaSalud() async throws {
        let prohibido = Prueba.errorJSON("origin_forbidden", "Esta función no está disponible desde aquí.")
        try PruebaDatos.servir(["GET /native/api/v1/health": (403, prohibido)])
        let (datos, _) = datos()
        var fallos: [(String?, RutaAdministracion)] = []
        datos.alFallarAdministracion = { error, ruta in fallos.append((error.codigo, ruta)) }
        await datos.salud.refrescar()
        XCTAssertEqual(fallos.map(\.0), ["origin_forbidden"])
        XCTAssertEqual(fallos.map(\.1), [.health])
        XCTAssertEqual(PruebaDatos.peticiones("GET", "health"), 1)
        XCTAssertEqual(datos.salud.error?.codigo, "origin_forbidden")
    }

    @MainActor
    func testCrearCodigoYRevocarAvisanALasCapacidades() async throws {
        try PruebaDatos.servir([
            "POST /native/api/v1/pairing": (201, try Fixtures.datos("v1/pairingCreate.json")),
            "DELETE /native/api/v1/devices/dev_otro": try PruebaDatos.fixture("deviceRevoke"),
        ])
        let (datos, _) = datos()
        var abiertas: [RutaAdministracion] = []
        datos.alAbrirAdministracion = { abiertas.append($0) }
        let codigo = try await datos.crearCodigo(PairingCreateBody(baseUrl: "http://umbrel.local:7792"))
        XCTAssertEqual(codigo.code.count, 6)
        try await datos.revocar(dispositivo: "dev_otro")
        XCTAssertEqual(abiertas, [.pairingCreate, .deviceRevoke])
        let cuerpo = try XCTUnwrap(MockURLProtocol.peticiones.first { $0.url?.path() == "/native/api/v1/pairing" })
        let json = try JSONSerialization.jsonObject(with: try XCTUnwrap(cuerpo.httpBody)) as? [String: String]
        XCTAssertEqual(json, ["baseUrl": "http://umbrel.local:7792"])
    }

    /// Invalidar por ruta: solo lo que alguien mira vuelve a pedirse.
    @MainActor
    func testInvalidarPorRuta() async throws {
        try PruebaDatos.servir([
            "GET /native/api/v1/library": try PruebaDatos.fixture("libraryGet"),
            "GET /native/api/v1/bootstrap": try PruebaDatos.fixture("bootstrap"),
        ])
        let (datos, _) = datos()
        datos.sembrar(con: try PruebaDatos.arranque())
        datos.biblioteca.empezarAMirar()
        datos.invalidar([.libraryGet, .bootstrap])
        let pidioLaBiblioteca = await llegaA { PruebaDatos.peticiones("GET", "library") == 1 }
        XCTAssertTrue(pidioLaBiblioteca)
        XCTAssertEqual(PruebaDatos.peticiones("GET", "bootstrap"), 0)  // nadie lo mira
        XCTAssertNil(datos.arranque.actualizadaEn)  // pero queda caducado
    }

    /// Lo que llega de la red se guarda y la próxima vez se pinta al momento, caducado (a2 §23.1).
    @MainActor
    func testPintarEnFrio() async throws {
        let (entorno, _, _) = PruebaDatos.entorno()
        let arranque = try PruebaDatos.arranque()
        let primera = DatosApp(api: entorno.api, cache: entorno.cache)
        primera.sembrar(con: arranque)
        let guardado = await enDisco(entorno.cache, true)
        XCTAssertTrue(guardado)

        let segunda = DatosApp(api: entorno.api, cache: entorno.cache)
        await segunda.pintarEnFrio()
        XCTAssertEqual(segunda.biblioteca.datos, arranque.library)
        XCTAssertEqual(segunda.arranque.datos?.version, arranque.version)
        XCTAssertTrue(segunda.biblioteca.caducada(tiempoRealAbierto: true, ahora: Date()))
    }

    /// Olvidar este iPhone: nada del servidor se queda, ni en memoria ni en disco.
    @MainActor
    func testVaciar() async throws {
        let (datos, cache) = datos()
        datos.sembrar(con: try PruebaDatos.arranque())
        _ = datos.precalentado(partido: "demo-1")
        _ = datos.busqueda("dazn")
        let guardado = await enDisco(cache, true)
        XCTAssertTrue(guardado)
        datos.vaciar()
        XCTAssertNil(datos.arranque.datos)
        XCTAssertNil(datos.biblioteca.datos)
        XCTAssertNil(datos.motor.datos)
        XCTAssertTrue(datos.precalentados.isEmpty)
        XCTAssertTrue(datos.busquedas.isEmpty)
        let borrado = await enDisco(cache, false)
        XCTAssertTrue(borrado)
    }
}

/// Espera a que la biblioteca esté (o ya no esté) guardada en disco.
private func enDisco(_ cache: DiskCache, _ esperado: Bool) async -> Bool {
    let limite = Date().addingTimeInterval(3)
    while Date() < limite {
        let hay = await cache.leer(LibraryView.self, de: .biblioteca) != nil
        if hay == esperado { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return false
}
