import Foundation
import Testing

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* El núcleo de datos decide lo mismo que la web (b-arquitectura §3.2; vectores de scripts/vectores/datos.ts):
   SCOPE_ROUTES, lo que cada evento hace en la caché, el filtro de los dirigidos, las esperas del tiempo real,
   los reintentos de las consultas y el error de cada respuesta. */

/// Lo que un efecto hace en la caché, con las palabras de datos.ts («invalidar ruta», «escribir ruta»).
private func operaciones(de efecto: EfectoEvento) -> [String] {
    switch efecto {
    case .invalidar(let rutas): return rutas.map { "invalidar " + $0.rawValue }
    case .invalidarTodo: return ["invalidar *"]
    case .escribirMotor: return ["escribir engineStatus"]
    case .escribirSonando, .escribirSesiones: return ["escribir playbackStatus"]
    case .trabajo(let id): return ["invalidar footballScan:" + id]
    default: return []
    }
}

private func operaciones(_ efectos: [EfectoEvento]) -> [String] {
    var salida: [String] = []
    for efecto in efectos { salida += operaciones(de: efecto) }
    return salida.sorted()
}

/// El `ApiError` de la web (código y estado) como error de la app.
private func errorDeLaApp(_ codigo: String, _ estado: Int) -> APIError {
    switch codigo {
    case "network": return .red(.notConnectedToInternet)
    case "timeout": return .red(.timedOut)
    case "bad_response": return .formato("bad_response")
    default: return .servidor(codigo: codigo, estado: estado, mensaje: nil, requestId: nil)
    }
}

struct VectoresDatosTests {
    private static let v = VectoresDatos.todos

    @Test func ambitosComoLaWeb() throws {
        #expect(Self.v.ambitos.count == 9)
        for (nombre, rutas) in Self.v.ambitos {
            let ambito = try #require(StateScope(rawValue: nombre), "\(nombre)")
            let deLaApp = Set(EfectosEvento.rutas(de: ambito).map(\.rawValue))
            #expect(deLaApp == Set(rutas), "\(nombre)")
        }
    }

    @Test func cadaEventoHaceLoMismoEnLaCache() throws {
        #expect(Self.v.eventos.count == 15)
        for caso in Self.v.eventos {
            let datos = try Fixtures.datos("events/\(caso.fixture).json")
            let evento = try JSONDecoder().decode(SSEEvent.self, from: datos)
            #expect(operaciones(EfectosEvento.de(evento)) == caso.cache.sorted(), "\(caso.fixture)")
        }
    }

    @Test func losDirigidosSoloLleganAEsteVisor() {
        #expect(Self.v.dirigidos.contains { !$0.llega })
        for caso in Self.v.dirigidos {
            let llega = EfectosEvento.esParaEsteVisor(caso.evento, visor: VectoresDatos.propio)
            #expect(llega == caso.llega, "\(caso.fixture) \(caso.visores ?? [])")
        }
    }

    @Test func esperasDelTiempoReal() {
        let t = Self.v.tiempoReal
        let esperas = t.esperas.indices.map { EsperaSSE.espera(intento: $0 + 1) * 1000 }
        #expect(esperas == t.esperas)
        #expect(EsperaSSE.respaldoTras * 1000 == t.respaldoTras)
        #expect(EsperaSSE.respaldoTras * 1000 == t.respaldo)
        #expect(EsperaSSE.sondeoReproduccion * 1000 == t.sondeoReproduccion)
        #expect(EsperaSSE.sondeoMotor * 1000 == t.sondeoMotor)
        let trasCorte = EfectosEvento.trasCorte.map { "invalidar " + $0.rawValue }.sorted()
        #expect(trasCorte == t.abrirTrasCorte.sorted())
    }

    @Test func reintentosDeLasConsultas() {
        for caso in Self.v.consultas.reintentos {
            let error = errorDeLaApp(caso.codigo, caso.estado)
            let reintenta = Reintentos.reintenta(fallos: caso.fallos, error: error)
            #expect(reintenta == caso.reintenta, "\(caso.codigo) \(caso.estado) tras \(caso.fallos)")
        }
        for caso in Self.v.consultas.esperasReintento {
            #expect(Reintentos.espera(intento: caso.intento) * 1000 == caso.ms, "intento \(caso.intento)")
        }
    }

    @Test func errorDeCadaRespuesta() {
        for caso in Self.v.errores.respuestas {
            let error = APIError.deRespuesta(estado: caso.estado, datos: Data(caso.cuerpo.utf8))
            let rotulo = "\(caso.estado) \(caso.cuerpo)"
            #expect(error.codigo == caso.codigo, "\(rotulo)")
            #expect(error.estado == caso.estado, "\(rotulo)")
            #expect(error.mensaje == caso.mensaje, "\(rotulo)")
            #expect(error.reintentable == caso.reintentable, "\(rotulo)")
            guard case .servidor(_, _, _, let requestId) = error else { continue }
            #expect(requestId == caso.requestId, "\(rotulo)")
        }
    }

    @Test func textosDelCliente() {
        let textos = Self.v.errores.textosCliente
        #expect(TextosCliente.red == textos["network"])
        #expect(TextosCliente.plazo == textos["timeout"])
        #expect(TextosCliente.respuestaIlegible == textos["bad_response"])
        #expect(TextosCliente.demo == textos["demo_unsupported"])
    }
}
