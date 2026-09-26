import Foundation
import XCTest

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/// El port de Swift de features/sources/model.ts (ReglasFuentes) tiene que dar EXACTAMENTE lo mismo que la web.
/// Los vectores los genera `scripts/generar-vectores.ts` (vectores/fuentes.ts) ejecutando model.ts y
/// normalizeHash de verdad; la CI comprueba que el JSON está al día (`--check`).
final class VectoresFuentesTests: XCTestCase {
    private func vectores() throws -> LoteFuentes {
        try JSONDecoder().decode(LoteFuentes.self, from: Vectores.datos("vectores-fuentes"))
    }

    private func ahora(_ v: LoteFuentes) -> Date { FechaISO.parse(v.ahora) ?? Date(timeIntervalSince1970: 0) }

    private func listas(_ v: LoteFuentes) -> [WebSourceSummary] {
        v.listas.map { WebSourceSummary(id: $0.id, name: $0.name, url: "", type: .m3u, count: 0) }
    }

    func testHayVectoresDeTodo() throws {
        let v = try vectores()
        XCTAssertGreaterThan(v.entradas.count, 40)
        XCTAssertGreaterThan(v.arranques.count, 20)
        XCTAssertGreaterThan(v.saltos.count, 20)
        XCTAssertGreaterThan(v.progresos.count, 100)
        XCTAssertTrue(v.arranques.contains { $0.elegida != nil } && v.arranques.contains { $0.elegida == nil })
        XCTAssertTrue(v.saltos.contains { $0.elegida != nil })
    }

    func testEstadoMedidorYFraseComoLaWeb() throws {
        let v = try vectores()
        let momento = ahora(v)
        for caso in v.entradas {
            let e = caso.entrada.fuente
            for p in caso.pantallas {
                let ef = ReglasFuentes.efectivo(e, pantalla: p.pantalla.enPantalla, ahora: momento)
                let donde = "\(e.titulo) (\(e.id.suffix(3))) con \(p.pantalla)"
                XCTAssertEqual(ef.estado?.rawValue ?? "none", p.efectivo.state, "effectiveOf.state de \(donde)")
                XCTAssertEqual(ef.motivo, p.efectivo.reason, "effectiveOf.reason de \(donde)")
                XCTAssertEqual(ef.reportada, p.efectivo.reported, "effectiveOf.reported de \(donde)")
                let senal = ReglasFuentes.senal(ef, e)
                XCTAssertEqual(senal.estado.rawValue, p.senal.state, "signalOf.state de \(donde)")
                XCTAssertEqual(senal.palabra, p.senal.word, "signalOf.word de \(donde)")
                XCTAssertEqual(ReglasFuentes.detalle(ef, e), p.detalle, "detailOf de \(donde)")
                XCTAssertEqual(
                    ReglasFuentes.visibleMientrasComprueba(e, efectivo: ef, activa: nil), p.visibleSinActiva,
                    "isShownWhileScanning sin activa de \(donde)")
                XCTAssertEqual(
                    ReglasFuentes.visibleMientrasComprueba(e, efectivo: ef, activa: e.id), p.visibleActiva,
                    "isShownWhileScanning activa de \(donde)")
            }
        }
    }

    func testPresentacionCalidadYDescripcionComoLaWeb() throws {
        let v = try vectores()
        let momento = ahora(v)
        let listas = listas(v)
        for (indice, caso) in v.entradas.enumerated() {
            let e = caso.entrada.fuente
            let presentacion = ReglasFuentes.presentacion(e, listas: listas)
            let donde = "\(e.titulo) (\(e.id.suffix(3)))"
            XCTAssertEqual(presentacion.tipo, caso.presentacion.type, "presentationOf.type de \(donde)")
            XCTAssertEqual(presentacion.lista, caso.presentacion.list, "presentationOf.list de \(donde)")
            XCTAssertEqual(presentacion.proveedor, caso.presentacion.provider, "presentationOf.provider de \(donde)")
            XCTAssertEqual(presentacion.etiqueta, caso.presentacion.label, "presentationOf.label de \(donde)")
            XCTAssertEqual(presentacion.corto, caso.presentacion.short, "presentationOf.short de \(donde)")
            XCTAssertEqual(ReglasFuentes.calidad(e.sonda), caso.calidad, "qualityLabel de \(donde)")
            XCTAssertEqual(ReglasFuentes.nombreCanal(e), caso.nombreCanal, "channelNameOf de \(donde)")
            XCTAssertEqual(ReglasFuentes.mbitEnjambre(e), caso.mbit, "swarmMbit de \(donde)")
            for p in caso.pantallas {
                let ef = ReglasFuentes.efectivo(e, pantalla: p.pantalla.enPantalla, ahora: momento)
                let con = ReglasFuentes.describir(
                    e, numero: indice + 1, efectivo: ef, presentacion: presentacion, conComprobador: true)
                let sin = ReglasFuentes.describir(
                    e, numero: indice + 1, efectivo: ef, presentacion: presentacion, conComprobador: false)
                XCTAssertEqual(con, p.descripcionConComprobador, "describeSource con comprobador de \(donde)")
                XCTAssertEqual(sin, p.descripcionSinComprobador, "describeSource sin comprobador de \(donde)")
            }
        }
    }

    func testTextosSueltosComoLaWeb() throws {
        let v = try vectores()
        for caso in v.titulos {
            XCTAssertEqual(ReglasFuentes.proveedor(caso.titulo), caso.proveedor, "providerOf(«\(caso.titulo)»)")
            XCTAssertEqual(ReglasFuentes.parteCanal(caso.titulo), caso.parteCanal, "channelPartOf(«\(caso.titulo)»)")
        }
        let listas = listas(v)
        for caso in v.nombresLista {
            XCTAssertEqual(ReglasFuentes.nombreLista(caso.id, listas: listas), caso.nombre, "listNameOf(\(caso.id ?? "null"))")
        }
        for caso in v.porcentajes {
            XCTAssertEqual(ReglasFuentes.porcentaje(caso.valor), caso.porcentaje, "availabilityPercent(\(caso.valor))")
        }
        for caso in v.motivos {
            let motivo = SourceReportReason(rawValue: caso.motivo) ?? .desconocido
            XCTAssertEqual(ReglasFuentes.etiqueta(motivo), caso.etiqueta, "reportReasonLabel(\(caso.motivo))")
        }
        for caso in v.origenes {
            XCTAssertEqual(ReglasFuentes.etiquetaOrigenResolucion(caso.valor), caso.resolucion, "resolutionSourceLabel(\(caso.valor))")
            XCTAssertEqual(ReglasFuentes.etiquetaRevisado(caso.valor), caso.revisado, "checkedLabel(\(caso.valor))")
        }
        for caso in v.hashes {
            let esperado: String? = caso.hash.isEmpty ? nil : caso.hash
            XCTAssertEqual(ReglasFuentes.normalizarHash(caso.texto), esperado, "normalizeHash(«\(caso.texto)»)")
        }
        XCTAssertEqual(ReglasFuentes.textoHashNoValido, v.textoHashNoValido)
    }

    func testVeredictoYSeguimientoComoLaWeb() throws {
        let v = try vectores()
        for caso in v.veredictos {
            let resultado: OutcomeResult = caso.resultado == "cayo" ? .cayo : .fallo
            let (estado, motivo) = ReglasFuentes.veredictoFallo(resultado, segundos: caso.segundos)
            XCTAssertEqual(estado.rawValue, caso.veredicto.state, "failureVerdict(\(caso.resultado), \(caso.segundos))")
            XCTAssertEqual(motivo, caso.veredicto.reason, "failureVerdict(\(caso.resultado), \(caso.segundos))")
        }
        for caso in v.seguimientos {
            let motivo = SourceReportReason(rawValue: caso.motivo) ?? .desconocido
            let estado = caso.estado.map { ScanCandidateState(rawValue: $0) ?? .desconocido }
            let s = ReglasFuentes.seguimientoReporte(motivo, estado: estado)
            let donde = "reportFollowUp(\(caso.motivo), \(caso.estado ?? "undefined"))"
            XCTAssertEqual(s.sigueApartada, caso.seguimiento.stillReported, donde)
            XCTAssertEqual(s.texto, caso.seguimiento.message, donde)
            XCTAssertEqual(s.tono.rawValue, caso.seguimiento.tone, donde)
        }
    }

    func testArranqueAutomaticoYSaltoDeEntradaComoLaWeb() throws {
        let v = try vectores()
        let momento = ahora(v)
        let todas = v.entradas.map(\.entrada.fuente)
        for caso in v.arranques {
            let lista = caso.indices.map { todas[$0] }
            let efectivos = ReglasFuentes.efectivos(lista, pantalla: caso.pantalla.enPantalla, ahora: momento)
            let elegida = ReglasFuentes.elegirAutomatica(lista, efectivos: efectivos, terminado: caso.terminado)
            XCTAssertEqual(elegida?.id, caso.elegida, "pickAutoSource(\(caso.indices), \(caso.pantalla), \(caso.terminado))")
        }
        for caso in v.saltos {
            let lista = caso.indices.map { todas[$0] }
            let elegida = ReglasFuentes.elegirSaltoInicial(
                lista, activa: caso.activa, pantalla: caso.pantalla.enPantalla, ahora: momento)
            XCTAssertEqual(elegida?.id, caso.elegida, "pickInitialSwitch(\(caso.indices), \(caso.activa ?? "null"))")
        }
    }

    func testProgresoDelComprobadorComoLaWeb() throws {
        let v = try vectores()
        let momento = ahora(v)
        let todas = v.entradas.map(\.entrada.fuente)
        for caso in v.progresos {
            let lista = caso.indices.map { todas[$0] }
            let comprobador = caso.vista?.estado
            let efectivos = ReglasFuentes.efectivos(lista, pantalla: .nada, ahora: momento)
            let donde = "\(caso.indices) \(caso.vista?.status ?? "sin comprobador") \(caso.precalentado?.status.rawValue ?? "-")"
            XCTAssertEqual(
                ReglasFuentes.progreso(comprobador, entradas: lista.count), caso.progreso, accuracy: 1e-12,
                "scanProgress \(donde)")
            XCTAssertEqual(
                ReglasFuentes.textoProgreso(comprobador, entradas: lista, efectivos: efectivos, precalentado: caso.precalentado),
                caso.texto, "scanProgressText \(donde)")
        }
    }

    func testHermanasDeLaBibliotecaComoLaWeb() throws {
        let v = try vectores()
        for caso in v.hermanas {
            XCTAssertEqual(
                ReglasFuentes.hermanas(v.biblioteca, id: caso.id).map(\.id), caso.hermanas, "librarySiblings(\(caso.id))")
        }
    }
}
