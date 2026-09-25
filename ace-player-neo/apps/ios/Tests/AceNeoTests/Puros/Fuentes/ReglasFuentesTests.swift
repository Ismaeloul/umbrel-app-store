import Foundation
import XCTest

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/// Reglas del selector de fuentes (las de la web): qué estado se enseña, cuál
/// arranca sola, qué deja el reproductor al fallar y la regla D6 de iOS.
final class ReglasFuentesTests: XCTestCase {
    private let ahora = Date(timeIntervalSince1970: 1_790_188_200)

    private func entrada(
        _ id: String, sonda: ScanCandidateState? = nil, reportadaHasta: Date? = nil, disponibilidad: Double? = nil
    ) -> EntradaFuente {
        EntradaFuente(
            id: id, titulo: "M+ LaLiga --> Proveedor \(id)", ih: false, origen: "m3u", canal: "M+ LaLiga",
            disponibilidad: disponibilidad, reportadaHasta: reportadaHasta,
            motivoReporte: reportadaHasta == nil ? nil : .stuttering, sonda: sonda.map { SondaFuente(estado: $0) })
    }

    func testPrioridadDelEstadoEfectivo() {
        let pantalla = EnPantalla(id: "b", sonando: true, conectando: false)
        // Reportada manda sobre todo.
        let reportada = entrada("a", sonda: .working, reportadaHasta: ahora.addingTimeInterval(60))
        XCTAssertEqual(ReglasFuentes.efectivo(reportada, pantalla: pantalla, ahora: ahora).estado, .failed)
        XCTAssertTrue(ReglasFuentes.efectivo(reportada, pantalla: pantalla, ahora: ahora).reportada)
        // La que suena en pantalla es verificada aunque el comprobador diga que no.
        XCTAssertEqual(ReglasFuentes.efectivo(entrada("b", sonda: .failed), pantalla: pantalla, ahora: ahora).estado, .working)
        // La que se conecta en pantalla es «comprobando».
        let conectando = EnPantalla(id: "c", sonando: false, conectando: true)
        XCTAssertEqual(ReglasFuentes.efectivo(entrada("c", sonda: .failed), pantalla: conectando, ahora: ahora).estado, .checking)
        // El veredicto del reproductor manda durante 3 min sobre el comprobador.
        var vista = entrada("d", sonda: .working)
        vista.veredicto = VeredictoReproductor(estado: .failed, motivo: "player_failed", fecha: ahora.addingTimeInterval(-60))
        XCTAssertEqual(ReglasFuentes.efectivo(vista, pantalla: .nada, ahora: ahora).estado, .failed)
        vista.veredicto?.fecha = ahora.addingTimeInterval(-400)
        XCTAssertEqual(ReglasFuentes.efectivo(vista, pantalla: .nada, ahora: ahora).estado, .working)
        // Sin datos.
        XCTAssertNil(ReglasFuentes.efectivo(entrada("e"), pantalla: .nada, ahora: ahora).estado)
    }

    func testMedidorYPalabraComoEnLaWeb() {
        func senal(_ e: EntradaFuente) -> (EstadoSenal, String) {
            let r = ReglasFuentes.senal(ReglasFuentes.efectivo(e, pantalla: .nada, ahora: ahora), e)
            return (r.estado, r.palabra)
        }
        XCTAssertTrue(senal(entrada("a", sonda: .working)) == (.ok, "Verificada"))
        XCTAssertTrue(senal(entrada("a", sonda: .weak)) == (.weak, "Floja"))
        XCTAssertTrue(senal(entrada("a", sonda: .failed)) == (.fail, "Sin señal"))
        XCTAssertTrue(senal(entrada("a", sonda: .checking)) == (.checking, "Comprobando"))
        XCTAssertTrue(senal(entrada("a", sonda: .queued)) == (.pending, "Pendiente"))
        XCTAssertTrue(senal(entrada("a", reportadaHasta: ahora.addingTimeInterval(9))) == (.fail, "Reportada"))
        XCTAssertTrue(senal(entrada("a", disponibilidad: 0.8)) == (.ok, "80% disponible"))
        XCTAssertTrue(senal(entrada("a", disponibilidad: 30)) == (.weak, "30% disponible"))
        XCTAssertTrue(senal(entrada("a")) == (.pending, "Sin comprobar"))
    }

    func testFrasesDeDetalle() {
        let reportada = entrada("a", reportadaHasta: ahora.addingTimeInterval(60))
        let efectivo = ReglasFuentes.efectivo(reportada, pantalla: .nada, ahora: ahora)
        XCTAssertEqual(ReglasFuentes.detalle(efectivo, reportada), "apartada por tu reporte (se corta)")
        let sonando = ReglasFuentes.efectivo(
            entrada("b"), pantalla: EnPantalla(id: "b", sonando: true, conectando: false), ahora: ahora)
        XCTAssertEqual(ReglasFuentes.detalle(sonando, entrada("b")), "reproduciendo ahora")
        XCTAssertEqual(ReglasFuentes.proveedor("M+ Liga de Campeones --> Elcano"), "Elcano")
        XCTAssertEqual(ReglasFuentes.parteCanal("M+ Liga de Campeones --> Elcano"), "M+ Liga de Campeones")
        XCTAssertEqual(ReglasFuentes.proveedor("DAZN 1"), "")
    }

    func testArranqueAutomaticoPorVerificadas() {
        var probada = entrada("a", sonda: .working)
        probada.probadaAuto = true
        let lista = [probada, entrada("b", sonda: .weak), entrada("c", sonda: .working), entrada("d", sonda: .checking)]
        var efectivos: [String: Efectivo] = [:]
        for e in lista { efectivos[e.id] = ReglasFuentes.efectivo(e, pantalla: .nada, ahora: ahora) }
        XCTAssertEqual(ReglasFuentes.elegirAutomatica(lista, efectivos: efectivos, terminado: false)?.id, "c")

        // Sin verificadas: solo con el comprobador terminado se prueba una floja.
        let flojas = [entrada("b", sonda: .weak), entrada("d", sonda: .checking)]
        var ef2: [String: Efectivo] = [:]
        for e in flojas { ef2[e.id] = ReglasFuentes.efectivo(e, pantalla: .nada, ahora: ahora) }
        XCTAssertNil(ReglasFuentes.elegirAutomatica(flojas, efectivos: ef2, terminado: false))
        XCTAssertEqual(ReglasFuentes.elegirAutomatica(flojas, efectivos: ef2, terminado: true)?.id, "b")
    }

    func testVeredictoAlAgotarUnaFuente() {
        XCTAssertTrue(ReglasFuentes.veredictoFallo(.fallo, segundos: 0) == (.failed, "player_failed"))
        XCTAssertTrue(ReglasFuentes.veredictoFallo(.cayo, segundos: 20) == (.failed, "player_failed"))
        XCTAssertTrue(ReglasFuentes.veredictoFallo(.cayo, segundos: 600) == (.weak, "player_dropped"))
    }

    func testReglaD6UnaFuenteHEVCCuentaComoVerificadaEnIOS() throws {
        let datos = try Fixtures.datos("v1/footballScan.json")
        var trabajo = try JSONDecoder().decode(ScanJob.self, from: datos)
        var candidato = trabajo.candidates[0]
        candidato.state = .failed
        candidato.reason = "unsupported_codec"
        candidato.playableOn = PlayableOn(web: false, ios: true)
        XCTAssertEqual(SondaFuente(candidato).estado, .working)
        candidato.playableOn = PlayableOn(web: false, ios: false)
        XCTAssertEqual(SondaFuente(candidato).estado, .failed)
        trabajo.status = .complete
        XCTAssertTrue(ReglasFuentes.terminado(trabajo))
        trabajo.status = .running
        XCTAssertFalse(ReglasFuentes.terminado(trabajo))
        XCTAssertEqual(ReglasFuentes.progreso(trabajo, total: 2), 0.5, accuracy: 0.001)
    }

    func testCandidatoDeLaResolucion() throws {
        let resolucion = try JSONDecoder().decode(Resolution.self, from: Fixtures.datos("v1/footballResolve.json"))
        let entradas = resolucion.candidates.map { EntradaFuente($0, ahora: ahora) }
        XCTAssertEqual(entradas.first?.origen, "m3u")
        XCTAssertEqual(entradas.first?.canal, "M+ LaLiga")
        let canal = entradas[0].canalReproducible(
            partido: ContextoPartido(id: "p", titulo: "A – B", competicion: "LaLiga", canal: ""))
        XCTAssertEqual(canal.partido?.canal, "M+ LaLiga")
        XCTAssertEqual(canal.tipo, .id)
        XCTAssertEqual(ReglasFuentes.sinDuplicados(entradas + entradas).count, entradas.count)
    }

    func testHashPegado() {
        let hash = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
        XCTAssertEqual(ReglasFuentes.hashValido(hash), hash)
        XCTAssertEqual(ReglasFuentes.hashValido("  acestream://\(hash.uppercased())  "), hash)
        XCTAssertEqual(ReglasFuentes.hashValido("acestream://\(hash)?x=1"), hash)
        XCTAssertNil(ReglasFuentes.hashValido("hola"))
        XCTAssertNil(ReglasFuentes.hashValido(String(hash.dropLast()) + "z"))
    }

    // Poda (fase 0.2): `testFiltroDeLaBibliotecaSinAcentos` (FiltroBiblioteca de CanalesView.swift) y las
    // iniciales y el tono de `ColorEquipo` (Design) se fueron con la interfaz vieja; el filtro lo cubre
    // `ReglasBiblioteca.filtrar` (ReglasBibliotecaTests) y los colores, Equipos/TonoCanal (M2).

    func testMarcadorYMinuto() throws {
        let marcadores = try JSONDecoder().decode(ScoresResponse.self, from: Fixtures.datos("v1/scores.json"))
        let marcador = try XCTUnwrap(marcadores.scores.values.first)
        XCTAssertEqual(Marcador.minuto(marcador), 54)
        XCTAssertEqual(Marcador.progreso(marcador, inicio: nil, ahora: ahora), 0.6, accuracy: 0.001)
    }
}
