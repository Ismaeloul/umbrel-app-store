import Foundation
import Testing

@testable import AceNeo

/* La política por defecto de las consultas es la de TanStack en la web (api/query.ts), sacada de los vectores
   de scripts/vectores/datos.ts: frescura con y sin tiempo real, vuelta a la app, reintentos y `gcTime`. Aquí y
   no en Puros porque `PoliticaConsulta` y `DatosApp` viven en Core/Datos (solo Xcode). */

@MainActor struct PoliticaWebTests {
    private static let web = VectoresDatos.todos.consultas

    @Test func frescuraComoQueryTs() {
        let politica = PoliticaConsulta.porDefecto
        #expect(politica.frescuraConTiempoReal == nil)
        #expect(Self.web.frescura.conTiempoReal == nil, "Con el SSE abierto no caduca (Infinity)")
        let sin = Self.web.frescura.sinTiempoReal ?? -1
        #expect(politica.frescuraSinTiempoReal == .milliseconds(sin))
    }

    @Test func vueltaALaAppComoQueryTs() {
        #expect(PoliticaConsulta.porDefecto.alVolverActiva == .soloSinTiempoReal)
        #expect(Self.web.alVolver.conTiempoReal == false)
        #expect(Self.web.alVolver.sinTiempoReal == true)
    }

    @Test func reintentosYRecogidaComoQueryTs() {
        #expect(PoliticaConsulta.porDefecto.reintentos == Reintentos.maximo)
        let ultimoQueReintenta = Self.web.reintentos.filter { $0.codigo == "network" && $0.reintenta }.map(\.fallos).max()
        #expect(ultimoQueReintenta == Reintentos.maximo - 1)
        #expect(DatosApp.recogerTras * 1000 == Self.web.gcTime)
    }
}
