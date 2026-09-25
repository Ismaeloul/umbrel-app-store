import XCTest

@testable import AceNeo

/// La tabla de la máquina de estados (la misma que la web) y los números del directo.
final class MaquinaYDirectoTests: XCTestCase {
    func testTransicionesDeLaTabla() {
        let casos: [(FaseConexion, EventoConexion, FaseConexion?)] = [
            (.idle, .solicitar, .pidiendo),
            (.idle, .fallo, nil),
            (.idle, .reenganche, nil),
            (.pidiendo, .concedida, .conectando),
            (.pidiendo, .reenganche, nil),
            (.pidiendo, .fallo, .reconectando),
            (.conectando, .motorListo, .precarga),
            (.conectando, .colchonListo, .arrancando),
            (.precarga, .colchonListo, .arrancando),
            (.arrancando, .primerFotograma, .activa),
            (.conectando, .primerFotograma, nil),
            (.activa, .reenganche, .conectando),
            (.activa, .fallo, .reconectando),
            (.activa, .agotado, .error),
            (.activa, .traspaso, .idle),
            (.reconectando, .reintentar, .pidiendo),
            (.reconectando, .fallo, nil),
            (.reconectando, .agotado, .error),
            (.error, .solicitar, .pidiendo),
            (.error, .reintentar, nil),
            (.error, .detener, .idle),
        ]
        for (desde, evento, esperado) in casos {
            XCTAssertEqual(
                MaquinaConexion.siguiente(desde, evento), esperado, "\(desde.rawValue) + \(evento.rawValue)")
        }
    }

    func testTodosLosEstadosSePuedenDetener() {
        for fase in FaseConexion.allCases {
            XCTAssertEqual(MaquinaConexion.siguiente(fase, .detener), .idle, fase.rawValue)
            XCTAssertEqual(MaquinaConexion.siguiente(fase, .solicitar), .pidiendo, fase.rawValue)
        }
    }

    func testFasePublica() {
        XCTAssertEqual(FaseReproductor.derivar(.idle, .reproduciendo), .idle)
        XCTAssertEqual(FaseReproductor.derivar(.pidiendo, .idle), .cargando)
        XCTAssertEqual(FaseReproductor.derivar(.arrancando, .idle), .cargando)
        XCTAssertEqual(FaseReproductor.derivar(.reconectando, .reproduciendo), .reconectando)
        XCTAssertEqual(FaseReproductor.derivar(.error, .idle), .error)
        XCTAssertEqual(FaseReproductor.derivar(.activa, .buffer), .buffer)
        XCTAssertEqual(FaseReproductor.derivar(.activa, .pausado), .pausado)
        XCTAssertEqual(FaseReproductor.derivar(.activa, .buscando), .buscando)
        XCTAssertEqual(FaseReproductor.derivar(.activa, .reproduciendo), .reproduciendo)
        XCTAssertTrue(FaseConexion.reconectando.enMarcha)
        XCTAssertFalse(FaseConexion.error.enMarcha)
    }

    func testEsperaEntreReconexiones() {
        XCTAssertEqual(PoliticaReconexion.espera(intento: 1), 1)
        XCTAssertEqual(PoliticaReconexion.espera(intento: 2), 2)
        XCTAssertEqual(PoliticaReconexion.espera(intento: 3), 4)
        XCTAssertEqual(PoliticaReconexion.espera(intento: 9), 8, "Tope de 8 s")
    }

    func testBordeUtilDelDirecto() {
        let ventana = VentanaDirecto(inicio: 10, fin: 110)
        // Equilibrado: min(8, max(1,2, 100 × 0,25)) = 8.
        XCTAssertEqual(Directo.colchonSeguridad(modo: .balanced, duracionVentana: 100), 8)
        XCTAssertEqual(Directo.colchonSeguridad(modo: .stable, duracionVentana: 100), 12)
        XCTAssertEqual(Directo.colchonSeguridad(modo: .low, duracionVentana: 8), 2)
        XCTAssertEqual(Directo.colchonSeguridad(modo: .low, duracionVentana: 2), 1.2)
        XCTAssertEqual(Directo.objetivo(ventana: ventana, seguridad: 8), 102)
        XCTAssertEqual(Directo.objetivo(ventana: ventana, preferido: 50, seguridad: 8), 50)
        XCTAssertEqual(Directo.objetivo(ventana: ventana, preferido: 200, seguridad: 8), 102)
        XCTAssertEqual(Directo.objetivo(ventana: ventana, preferido: 0, seguridad: 8), 10)
        // Ventana corta: el colchón no puede comerse toda la ventana.
        XCTAssertEqual(Directo.objetivo(ventana: VentanaDirecto(inicio: 0, fin: 4), seguridad: 8), 0.5)
        XCTAssertNil(Directo.objetivo(ventana: nil))
        XCTAssertNil(Directo.objetivo(ventana: VentanaDirecto(inicio: 5, fin: 5)))
    }

    func testVentanaElegidaEsLaQueContieneElCabezal() {
        let tramos: [(inicio: Double, fin: Double)] = [(0, 10), (20, 60)]
        XCTAssertEqual(VentanaDirecto.elegir(tramos: tramos, actual: 5), VentanaDirecto(inicio: 0, fin: 10))
        XCTAssertEqual(VentanaDirecto.elegir(tramos: tramos, actual: 30), VentanaDirecto(inicio: 20, fin: 60))
        XCTAssertEqual(VentanaDirecto.elegir(tramos: tramos, actual: 15), VentanaDirecto(inicio: 20, fin: 60))
        XCTAssertNil(VentanaDirecto.elegir(tramos: [], actual: 0))
    }

    func testIndicadorDeDirecto() {
        let ventana = VentanaDirecto(inicio: 0, fin: 100)
        let pegado = InfoDirecto.medir(ventana: ventana, actual: 91, modo: .balanced)
        XCTAssertTrue(pegado.disponible)
        XCTAssertTrue(pegado.enDirecto)
        XCTAssertEqual(pegado.retraso, 9, accuracy: 0.001)
        XCTAssertEqual(pegado.textoBoton, "Directo")
        XCTAssertTrue(pegado.etiquetaAccesible.contains("9 segundos"))

        let atras = InfoDirecto.medir(ventana: ventana, actual: 40, modo: .balanced)
        XCTAssertFalse(atras.enDirecto)
        XCTAssertEqual(atras.recuperable, 52, accuracy: 0.001)
        XCTAssertEqual(atras.textoBoton, "−52 s")

        XCTAssertFalse(InfoDirecto.medir(ventana: nil, actual: 3, modo: .low).disponible)
    }

    func testIdentidadDelVisor() {
        // Como la web (api/identity.ts): `v_` + 14 base64url, una por arranque de proceso (a7 §7).
        let id = IdentidadVisor.id()
        XCTAssertTrue(IdentidadVisor.valido(id))
        XCTAssertEqual(IdentidadVisor.id(), id, "La misma durante todo el proceso")
        XCTAssertTrue(id.hasPrefix("v_"))
        XCTAssertEqual(id.count, 16)
        XCTAssertNotEqual(IdentidadVisor.generar(), IdentidadVisor.generar())
        XCTAssertFalse(IdentidadVisor.valido("a b"))
        XCTAssertFalse(IdentidadVisor.valido("abc"))
    }

    func testTipoDeLaPeticionSegunElCanal() {
        XCTAssertEqual(CanalReproducible(id: "x", titulo: "x", ih: true).tipo, .infohash)
        XCTAssertEqual(CanalReproducible(id: "x", titulo: "x", ih: false).tipo, .id)
        XCTAssertEqual(CanalReproducible(id: "x", titulo: "x", ih: nil).tipo, .auto)
    }
}
