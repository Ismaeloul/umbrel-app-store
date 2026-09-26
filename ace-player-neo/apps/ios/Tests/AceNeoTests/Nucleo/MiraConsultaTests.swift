import Observation
import SwiftUI
import XCTest

@testable import AceNeo

/// `.mira(_:)` en una vista de verdad (b-arquitectura §2.5.1; el `useApiQuery` de a7 §4.1): cuando la vista
/// pasa a mirar OTRA consulta (otra `q` en Buscar, una fila reutilizada con otro partido), suelta la vieja y
/// pide la nueva, como la web al cambiar la clave de la consulta.
final class MiraConsultaTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.limpiar()
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    /// La clave de la tarea cambia con la consulta (y con la pestaña visible), no solo con la pestaña.
    @MainActor
    func testLaClaveCambiaConLaConsulta() {
        let una = Consulta<Int> { 1 }
        let otra = Consulta<Int> { 2 }
        XCTAssertEqual(ClaveMira(activa: true, consulta: una), ClaveMira(activa: true, consulta: una))
        XCTAssertNotEqual(ClaveMira(activa: true, consulta: una), ClaveMira(activa: true, consulta: otra))
        XCTAssertNotEqual(ClaveMira(activa: true, consulta: una), ClaveMira(activa: false, consulta: una))
    }

    @MainActor
    func testCambiarDeConsultaPideLaNuevaYSueltaLaVieja() async throws {
        try PruebaDatos.servir([
            "GET /native/api/v1/search": try PruebaDatos.fixture("search")
        ])
        let (entorno, _, _) = PruebaDatos.entorno()
        let datos = DatosApp(api: entorno.api, cache: entorno.cache)
        let eleccion = EleccionPrueba(consulta: datos.busqueda("dazn"))
        let primera = eleccion.consulta
        let ventana = ventanaDePrueba()
        let vista = VistaMiraPrueba(eleccion: eleccion).environment(datos)
        ventana.rootViewController = UIHostingController(rootView: vista)
        ventana.isHidden = false
        defer { ventana.isHidden = true }

        let miraLaPrimera = await llegaA(5) { primera.datos != nil && primera.observadores == 1 }
        XCTAssertTrue(miraLaPrimera, "Al montarse pide y mira la primera búsqueda")

        let segunda = datos.busqueda("m+")
        eleccion.consulta = segunda
        let miraLaSegunda = await llegaA(5) { segunda.datos != nil && segunda.observadores == 1 }
        XCTAssertTrue(miraLaSegunda, "La consulta nueva se pide en cuanto la vista la mira")
        let soltoLaPrimera = await llegaA { primera.observadores == 0 }
        XCTAssertTrue(soltoLaPrimera, "La vieja deja de mirarse")
        let consultas = MockURLProtocol.peticiones.compactMap { (peticion: URLRequest) -> String? in
            guard let url = peticion.url, url.path() == "/native/api/v1/search" else { return nil }
            return URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first { (item: URLQueryItem) -> Bool in item.name == "q" }?.value
        }
        XCTAssertEqual(consultas, ["dazn", "m+"])
    }

    /// Una ventana en la escena de la app anfitriona (sin escena no aparece y `.task` no arranca).
    @MainActor
    private func ventanaDePrueba() -> UIWindow {
        let marco = CGRect(x: 0, y: 0, width: 390, height: 844)
        let escena = UIApplication.shared.connectedScenes.compactMap { (escena: UIScene) -> UIWindowScene? in
            escena as? UIWindowScene
        }.first
        guard let escena else { return UIWindow(frame: marco) }
        let ventana = UIWindow(windowScene: escena)
        ventana.frame = marco
        return ventana
    }
}

/// Qué consulta mira la vista (lo que en Buscar sería la `q` escrita).
@MainActor @Observable private final class EleccionPrueba {
    var consulta: Consulta<SearchResponse>

    init(consulta: Consulta<SearchResponse>) { self.consulta = consulta }
}

private struct VistaMiraPrueba: View {
    let eleccion: EleccionPrueba

    var body: some View {
        Color.clear.mira(eleccion.consulta)
    }
}
