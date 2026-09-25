import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/// api/client.ts: TIMEOUTS y los plazos por defecto (12 s).
private let casosPlazo: [(RutaID, Double)] = [
    (.footballSchedule, 14), (.channelStream, 60), (.bootstrap, 12), (.libraryMutate, 12),
]

/// Lo generado desde la web tiene sentido, y la puerta de datos de prueba funciona igual en
/// Xcode y en Linux (canario C11: Swift Testing + Bundle.module en `swift test`).
struct GeneradosTests {
    @Test func losVectoresSeLeenDelBundle() throws {
        #expect(try Vectores.datos("vectores-dominio").count > 1000)
    }

    @Test func cadaEjemploV1EsUnaRutaDeVerdad() throws {
        let ejemplos = try Fixtures.nombres("v1")
        #expect(ejemplos.count > 20)
        for nombre in ejemplos {
            #expect(RutaID(rawValue: nombre) != nil, "fixtures/v1/\(nombre).json no es una ruta de routes.ts")
        }
    }

    @Test func rutasComoRoutesTs() {
        #expect(RutaID.ping.credencial == .ninguna)
        #expect(RutaID.healthLive.acceso == .web)  // §0.0 punto 2: se queda web
        #expect(RutaID.video.credencial == .videoToken)
        #expect(RutaID.events.contenido == .sse)
        #expect(RutaID.allCases.allSatisfy { $0.ruta.hasPrefix("/api/v1/") })
    }

    @Test(arguments: casosPlazo)
    func plazosComoLaWeb(_ ruta: RutaID, _ segundos: Double) {
        #expect(PlazosWeb.plazo(ruta) == segundos)
    }

    @Test func losCincuentaYDosIconosDeLaWeb() {
        #expect(NombreIcono.allCases.count == 52)
        #expect(NombreIcono.starF.rawValue == "star-f")
        #expect(NombreIcono.allCases.first == .agenda)
    }
}
