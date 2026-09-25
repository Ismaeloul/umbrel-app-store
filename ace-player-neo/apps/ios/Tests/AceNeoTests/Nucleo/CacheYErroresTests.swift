import XCTest

@testable import AceNeo

/// Caché en disco (arranque en frío con datos) y catálogo de errores. Los textos de la agenda
/// (`FormatoAgendaTests`) pasaron a Puros/Agenda en la poda (fase 0.2).
final class CacheTests: XCTestCase {
    private var directorio: URL!

    override func setUp() {
        super.setUp()
        directorio = FileManager.default.temporaryDirectory
            .appendingPathComponent("AceNeoTests-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directorio)
        super.tearDown()
    }

    func testGuardaYLeeLaAgenda() async throws {
        let cache = DiskCache(directorio: directorio)
        let agenda = try JSONDecoder().decode(FootballSchedule.self, from: Fixtures.datos("v1/footballSchedule.json"))
        let fecha = Date(timeIntervalSince1970: 1_790_188_200)

        let vacia = await cache.leer(FootballSchedule.self, de: .agenda)
        XCTAssertNil(vacia)
        try await cache.guardar(agenda, en: .agenda, fecha: fecha)
        let guardada = await cache.leer(FootballSchedule.self, de: .agenda)
        let leida = try XCTUnwrap(guardada)
        XCTAssertEqual(leida.valor, agenda)
        XCTAssertEqual(leida.guardadoEn, fecha)
    }

    func testCadaClaveEsIndependienteYSeBorraTodo() async throws {
        let cache = DiskCache(directorio: directorio)
        let biblioteca = try JSONDecoder().decode(LibraryView.self, from: Fixtures.datos("v1/libraryGet.json"))
        try await cache.guardar(biblioteca, en: .biblioteca)
        let agenda = await cache.leer(FootballSchedule.self, de: .agenda)
        XCTAssertNil(agenda)
        let leida = await cache.leer(LibraryView.self, de: .biblioteca)
        XCTAssertEqual(leida?.valor.favorites.count, 1)

        await cache.borrarTodo()
        let despues = await cache.leer(LibraryView.self, de: .biblioteca)
        XCTAssertNil(despues)
    }

    func testUnFicheroEstropeadoSeIgnora() async throws {
        try FileManager.default.createDirectory(at: directorio, withIntermediateDirectories: true)
        try Data("{roto".utf8).write(to: directorio.appendingPathComponent("agenda.json"))
        let cache = DiskCache(directorio: directorio)
        let leida = await cache.leer(FootballSchedule.self, de: .agenda)
        XCTAssertNil(leida)
    }

    /// Leer la agenda guardada tiene que ser casi instantáneo (arranque en frío < 1 s).
    func testLeerLaCacheEsRapido() async throws {
        let cache = DiskCache(directorio: directorio)
        let agenda = try JSONDecoder().decode(FootballSchedule.self, from: Fixtures.datos("v1/footballSchedule.json"))
        var grande = agenda
        let dia = try XCTUnwrap(agenda.days.first)
        grande.days = Array(repeating: FootballDay(date: dia.date, matches: Array(repeating: dia.matches[0], count: 60)), count: 14)
        try await cache.guardar(grande, en: .agenda)
        let inicio = ContinuousClock.now
        let leida = await cache.leer(FootballSchedule.self, de: .agenda)
        let tiempo = ContinuousClock.now - inicio
        XCTAssertEqual(leida?.valor.days.count, 14)
        XCTAssertLessThan(tiempo, .milliseconds(300))
    }
}

final class CatalogoErroresTests: XCTestCase {
    func testMensajesDelCatalogo() {
        XCTAssertEqual(
            ErrorCatalog.mensaje(para: "unauthorized"),
            "Este dispositivo no está emparejado o su acceso ha caducado. Vuelve a emparejarlo.")
        XCTAssertEqual(ErrorCatalog.entries["remux_timeout"]?.status, 504)
        XCTAssertEqual(ErrorCatalog.mensaje(para: "http_404"), "El servidor respondió con un error 404.")
        XCTAssertEqual(ErrorCatalog.mensaje(para: "no_existe"), ErrorCatalog.mensaje(para: "internal_error"))
    }

    /// Orden de la web (errors.ts): el `message` del servidor; sin él, el catálogo común.
    func testElMensajeDelServidorVaPrimero() {
        let interno = APIError.servidor(
            codigo: "scanner_session_leak", estado: 502, mensaje: "detalle interno", requestId: nil)
        XCTAssertEqual(interno.mensaje, "detalle interno")
        let publico = APIError.servidor(codigo: "remux_timeout", estado: 504, mensaje: nil, requestId: nil)
        XCTAssertEqual(publico.mensaje, ErrorCatalog.mensaje(para: "remux_timeout"))
    }

    func testMensajesPropiosDeLaApp() {
        XCTAssertTrue(APIError.servidorInalcanzable.mensaje.contains("Tailscale"))
        XCTAssertEqual(
            APIError.red(.notConnectedToInternet).mensaje,
            "No hay conexión con el Umbrel. Comprueba la red; la app seguirá reintentando.")
        XCTAssertEqual(APIError.desde(URLError(.cancelled)), .cancelado)
        XCTAssertEqual(APIError.desde(CancellationError()), .cancelado)
    }
}
