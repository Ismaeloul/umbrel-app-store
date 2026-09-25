import Synchronization
import XCTest

@testable import AceNeo

/// Piezas de proceso de M1 (b-arquitectura §2.5.5): reloj compartido, señal por partido (20 min),
/// marcadores destapados y bajas con «Deshacer» (a7 §8.6.1).
final class PiezasProcesoTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.limpiar()
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    /// Un tic solo mientras alguien mira; al empezar a mirar se pone al día.
    @MainActor
    func testRelojCompartido() async {
        let reloj = RelojMovil(Date(timeIntervalSince1970: 1_790_000_000))
        let compartido = RelojCompartido(reloj: reloj, periodo: .milliseconds(30))
        XCTAssertFalse(compartido.enMarcha)
        reloj.avanzar(10)
        compartido.empezarAMirar()
        XCTAssertEqual(compartido.ahora, reloj.ahora)
        compartido.empezarAMirar()
        reloj.avanzar(20)
        let avanzo = await llegaA { compartido.ahora == reloj.ahora }
        XCTAssertTrue(avanzo)
        compartido.dejarDeMirar()
        XCTAssertTrue(compartido.enMarcha, "Queda otro mirando")
        compartido.dejarDeMirar()
        XCTAssertFalse(compartido.enMarcha)
    }

    /// `scan.progress` vale 20 min; `cancelled` lo borra (agenda/data.ts).
    @MainActor
    func testSenalPartidos() throws {
        let t0 = Date(timeIntervalSince1970: 1_790_000_000)
        let reloj = RelojMovil(t0)
        let senales = SenalPartidos()
        senales.reloj = reloj
        guard case .scanProgress(var progreso) = try PruebaDatos.evento("scan.progress") else { return XCTFail() }
        senales.anotar(progreso, ahora: t0)
        XCTAssertEqual(senales.senal(partido: "fltv-2026-09-23-3"), progreso)
        reloj.avanzar(20 * 60)
        XCTAssertNotNil(senales.senal(partido: "fltv-2026-09-23-3"))
        reloj.avanzar(1)
        XCTAssertNil(senales.senal(partido: "fltv-2026-09-23-3"))
        senales.anotar(progreso, ahora: reloj.ahora)
        progreso.status = .cancelled
        senales.anotar(progreso, ahora: reloj.ahora)
        XCTAssertNil(senales.senal(partido: "fltv-2026-09-23-3"))
        progreso.matchId = nil
        progreso.status = .running
        senales.anotar(progreso, ahora: reloj.ahora)  // sin partido: nada
        XCTAssertNil(senales.senal(partido: "fltv-2026-09-23-3"))
    }

    /// Cambiar de partido o detener vuelve a tapar (score-reveal.ts).
    @MainActor
    func testMarcadoresDestapados() {
        let destapados = MarcadoresDestapados()
        destapados.fijarViendo("demo-1")
        destapados.destapar("demo-1")
        destapados.destapar("demo-2")
        XCTAssertTrue(destapados.destapado("demo-1"))
        destapados.fijarViendo("demo-1")
        XCTAssertTrue(destapados.destapado("demo-1"), "El mismo partido no tapa")
        destapados.tapar("demo-2")
        XCTAssertFalse(destapados.destapado("demo-2"))
        destapados.fijarViendo(nil)
        XCTAssertFalse(destapados.destapado("demo-1"))
    }

    /// Quitar: la fila se oculta, toast warn de 6 s con «Deshacer»; «Deshacer» la devuelve sin llamar al servidor.
    @MainActor
    func testQuitarYDeshacer() async throws {
        try PruebaDatos.servir(["POST /native/api/v1/library": try PruebaDatos.fixture("libraryMutate")])
        let (c, _, _) = PruebaDatos.contenedor()
        let hash = String(repeating: "a", count: 40)
        c.bajas.espera = .milliseconds(150)
        c.bajas.quitar(RefCanal(hash: hash, titulo: "DAZN 1", coleccion: .favorites), datos: c.datos, avisos: c.avisos)
        c.bajas.quitar(RefCanal(hash: hash, titulo: "DAZN 1", coleccion: .favorites), datos: c.datos, avisos: c.avisos)
        XCTAssertTrue(c.bajas.pendiente(hash))
        XCTAssertTrue(c.bajas.pendiente(hash, en: .favorites))
        XCTAssertFalse(c.bajas.pendiente(hash, en: .history))
        let toast = try XCTUnwrap(c.avisos.cola.toasts.first)
        XCTAssertEqual(toast.texto, "«DAZN 1» quitado de favoritos")
        XCTAssertEqual(toast.tono, .warn)
        XCTAssertEqual(toast.icono, .star)
        XCTAssertEqual(toast.tituloAccion, "Deshacer")
        XCTAssertEqual(c.avisos.cola.toasts.count, 1, "Ya pendiente: no hace nada")
        c.avisos.ejecutarAccion(toast.id)
        XCTAssertFalse(c.bajas.pendiente(hash))
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(PruebaDatos.peticiones("POST", "library"), 0)
    }

    /// A los 6 s, `libraryMutate delete` (con la lista activa solo en `web`) y la caché al día.
    @MainActor
    func testAlAcabarElDeshacerSeBorra() async throws {
        try PruebaDatos.servir(["POST /native/api/v1/library": try PruebaDatos.fixture("libraryMutate")])
        let (c, _, _) = PruebaDatos.contenedor()
        c.datos.sembrar(con: try PruebaDatos.arranque())
        c.bajas.espera = .milliseconds(50)
        let hash = String(repeating: "b", count: 40)
        c.bajas.quitar(RefCanal(hash: hash, titulo: "", coleccion: .web), datos: c.datos, avisos: c.avisos)
        XCTAssertEqual(c.avisos.cola.toasts.first?.texto, "«Canal» eliminado")
        XCTAssertEqual(c.avisos.cola.toasts.first?.icono, .trash)
        let borrado = await llegaA { !c.bajas.pendiente(hash) }
        XCTAssertTrue(borrado)
        let peticion = try XCTUnwrap(MockURLProtocol.peticiones.first { $0.httpMethod == "POST" })
        let cuerpo = try JSONSerialization.jsonObject(with: try XCTUnwrap(peticion.httpBody)) as? [String: String]
        XCTAssertEqual(cuerpo?["action"], "delete")
        XCTAssertEqual(cuerpo?["collection"], "web")
        XCTAssertEqual(cuerpo?["id"], hash)
        XCTAssertEqual(cuerpo?["sourceId"], try PruebaDatos.arranque().library.activeWebSourceId)
        XCTAssertNotNil(c.datos.directorios.datos, "setLibraryData")
    }

    /// Si falla, la fila vuelve y sale el error (err).
    @MainActor
    func testSiFallaLaFilaVuelve() async throws {
        try PruebaDatos.servir(["POST /native/api/v1/library": (500, Prueba.errorJSON("internal_error"))])
        let (c, _, _) = PruebaDatos.contenedor()
        c.bajas.espera = .milliseconds(30)
        let hash = String(repeating: "c", count: 40)
        c.bajas.quitar(RefCanal(hash: hash, titulo: "M+ LaLiga", coleccion: .favorites), datos: c.datos, avisos: c.avisos)
        let aviso = await llegaA { PruebaDatos.toasts(c.avisos).contains("No se pudo quitar el favorito") }
        XCTAssertTrue(aviso)
        XCTAssertFalse(c.bajas.pendiente(hash))
    }
}

/// Un reloj que se mueve a mano.
final class RelojMovil: Reloj {
    private let instante: Mutex<Date>
    init(_ inicio: Date) { instante = Mutex(inicio) }
    var ahora: Date { instante.withLock { $0 } }
    func avanzar(_ segundos: TimeInterval) { instante.withLock { $0 = $0.addingTimeInterval(segundos) } }
}
