import Foundation
import XCTest

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/// Resumen de las fuentes de un partido (movido de PalcoTests.swift en la poda, fase 0.2).
final class ResumenFuentesTests: XCTestCase {
    private func entrada(_ id: String, _ estado: ScanCandidateState?, kbps: Double? = nil) -> EntradaFuente {
        EntradaFuente(
            id: id, titulo: "M+ LaLiga --> Elcano", ih: false, origen: "m3u", canal: "M+ LaLiga",
            sonda: estado.map { SondaFuente(estado: $0, kbps: kbps) })
    }

    private func efectivos(_ entradas: [EntradaFuente]) -> [String: Efectivo] {
        var resultado: [String: Efectivo] = [:]
        for e in entradas { resultado[e.id] = ReglasFuentes.efectivo(e, pantalla: .nada, ahora: .now) }
        return resultado
    }

    func testResumenParaLaCapsula() {
        XCTAssertEqual(ReglasFuentes.resumen([], efectivos: [:]).tono, .neutro)
        let conVerificada = [entrada("a", .working), entrada("b", .weak), entrada("c", .checking)]
        let r1 = ReglasFuentes.resumen(conVerificada, efectivos: efectivos(conVerificada))
        XCTAssertEqual(r1.tono, .ok)
        XCTAssertEqual(r1.etiqueta, "Señal")
        XCTAssertEqual(r1.detalle, "1 de 3 verificadas")
        let enCola = [entrada("a", .queued), entrada("b", .checking)]
        XCTAssertEqual(ReglasFuentes.resumen(enCola, efectivos: efectivos(enCola)).etiqueta, "Comprobando")
        XCTAssertEqual(ReglasFuentes.resumen(enCola, efectivos: efectivos(enCola)).detalle, "2 fuentes en cola")
        let flojas = [entrada("a", .weak), entrada("b", .failed)]
        XCTAssertEqual(ReglasFuentes.resumen(flojas, efectivos: efectivos(flojas)).tono, .floja)
        let aMedias = [entrada("a", .failed), entrada("b", .checking)]
        XCTAssertEqual(ReglasFuentes.resumen(aMedias, efectivos: efectivos(aMedias)).detalle, "1 de 2 probadas")
        let caidas = [entrada("a", .failed), entrada("b", .failed)]
        XCTAssertEqual(ReglasFuentes.resumen(caidas, efectivos: efectivos(caidas)).etiqueta, "Sin señal")
    }

    func testCalidadPorCaudalYChips() {
        XCTAssertEqual(ReglasFuentes.calidad(SondaFuente(estado: .working, kbps: 6200)), "1080p")
        XCTAssertEqual(ReglasFuentes.calidad(SondaFuente(estado: .working, kbps: 3000)), "720p")
        XCTAssertEqual(ReglasFuentes.calidad(SondaFuente(estado: .working, kbps: 1200)), "576i")
        XCTAssertNil(ReglasFuentes.calidad(SondaFuente(estado: .working)))
        XCTAssertNil(ReglasFuentes.calidad(nil))
        XCTAssertEqual(ReglasFuentes.chipsCartel(entrada("a", .working, kbps: 6200)), "1080p · Elcano")
        XCTAssertEqual(ReglasFuentes.chipsCartel(entrada("a", .working)), "Elcano")
    }

    func testLaSondaGuardaCodecYCaudal() throws {
        let trabajo = try JSONDecoder().decode(ScanJob.self, from: Fixtures.datos("v1/footballScan.json"))
        let sonda = SondaFuente(try XCTUnwrap(trabajo.candidates.first))
        XCTAssertFalse(sonda.codec.isEmpty)
        XCTAssertNotNil(sonda.kbps)
    }

    func testZapeables() {
        let lista = [entrada("a", .working), entrada("b", .failed), entrada("c", .weak)]
        var ef = efectivos(lista)
        XCTAssertEqual(ReglasFuentes.zapeables(lista, efectivos: ef).map(\.id), ["a", "c"])
        ef["a"] = Efectivo(estado: .failed, motivo: "reported", reportada: true)
        XCTAssertEqual(ReglasFuentes.zapeables(lista, efectivos: ef).map(\.id), ["c"])
    }
}
