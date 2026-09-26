import Foundation
import UIKit
import XCTest

@testable import AceNeo

/// Caché de imágenes (movido de PalcoTests.swift en la poda, fase 0.2).
final class CacheImagenesTests: XCTestCase {
    private var directorio: URL!

    override func setUp() {
        super.setUp()
        directorio = FileManager.default.temporaryDirectory
            .appendingPathComponent("AceNeoTests-imagenes-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        try? FileManager.default.removeItem(at: directorio)
        super.tearDown()
    }

    private func cache() -> CacheImagenes {
        CacheImagenes(session: MockURLProtocol.sesion(), directorio: directorio) { url in
            var peticion = URLRequest(url: url)
            peticion.setValue("Bearer prueba", forHTTPHeaderField: "Authorization")
            return peticion
        }
    }

    func testMemoriaDiscoYPeticionesUnidas() async throws {
        let descargas = Contador()
        let escudo = Self.png(lado: 8)
        MockURLProtocol.responder { _ in
            descargas.sumar()
            return (200, ["Content-Type": "image/png"], escudo)
        }
        let url = URL(string: "http://umbrel.local:7792/native/api/v1/football/teams/1/crest?v=a")!
        let primera = cache()
        XCTAssertNil(primera.enMemoria(url), "Nada en memoria al principio")

        // Dos peticiones a la vez: una sola descarga.
        async let a = primera.imagen(para: url)
        async let b = primera.imagen(para: url)
        let (ia, ib) = await (a, b)
        XCTAssertNotNil(ia)
        XCTAssertNotNil(ib)
        XCTAssertEqual(descargas.actual, 1)
        XCTAssertNotNil(primera.enMemoria(url), "Ya en memoria: se pinta al instante")
        XCTAssertEqual(MockURLProtocol.peticiones.first?.value(forHTTPHeaderField: "Authorization"), "Bearer prueba")

        // Otra instancia (memoria vacía) la saca del disco sin tocar la red.
        let segunda = cache()
        XCTAssertNil(segunda.enMemoria(url))
        let deDisco = await segunda.imagen(para: url)
        XCTAssertNotNil(deDisco)
        XCTAssertEqual(descargas.actual, 1)
        XCTAssertNotNil(segunda.enMemoria(url))
    }

    func testLaMismaImagenPorOtraDireccionTieneLaMismaClave() {
        let lan = URL(string: "http://umbrel.local:7792/native/api/v1/football/teams/1/crest?v=a")!
        let tailscale = URL(string: "http://100.64.0.1:7792/native/api/v1/football/teams/1/crest?v=a")!
        let otraVersion = URL(string: "http://umbrel.local:7792/native/api/v1/football/teams/1/crest?v=b")!
        XCTAssertEqual(CacheImagenes.clave(lan), CacheImagenes.clave(tailscale))
        XCTAssertNotEqual(CacheImagenes.clave(lan), CacheImagenes.clave(otraVersion), "Otra versión, otra imagen")
        XCTAssertEqual(CacheImagenes.clave(lan).count, 64)
    }

    func testUnErrorNoSeGuarda() async {
        let descargas = Contador()
        MockURLProtocol.responder { _ in
            descargas.sumar()
            return (404, ["Content-Type": "application/json"], Prueba.errorJSON("not_found"))
        }
        let url = URL(string: "http://umbrel.local:7792/native/api/v1/football/teams/2/crest?v=a")!
        let almacen = cache()
        let imagen = await almacen.imagen(para: url)
        XCTAssertNil(imagen)
        XCTAssertNil(almacen.enMemoria(url))
        let otraVez = await almacen.imagen(para: url)
        XCTAssertNil(otraVez)
        XCTAssertEqual(descargas.actual, 2, "Sin imagen no hay nada que cachear: se vuelve a pedir")
        let enCurso = await almacen.peticionesEnCurso
        XCTAssertEqual(enCurso, 0)
    }

    func testElPNGDePruebaEsUnaImagen() {
        let imagen = UIImage(data: Self.png(lado: 16))
        XCTAssertNotNil(imagen)
        XCTAssertEqual(imagen?.size.width, 16)
    }

    /// Un PNG de verdad de `lado`×`lado` puntos a escala 1 (la demo, como la web, no sirve escudos: 404).
    private static func png(lado: Int) -> Data {
        let formato = UIGraphicsImageRendererFormat()
        formato.scale = 1
        let tamano = CGSize(width: lado, height: lado)
        return UIGraphicsImageRenderer(size: tamano, format: formato).pngData { contexto in
            UIColor.systemTeal.setFill()
            contexto.fill(CGRect(origin: .zero, size: tamano))
        }
    }
}
