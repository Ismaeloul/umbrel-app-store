import CoreGraphics
import Foundation
import SwiftUI
import Testing

@testable import AceNeo

/* IconosTests, NumTests y EstiloTextoTests (b-arquitectura §3.1). */

@MainActor
struct IconosTests {
    private let caja = CGRect(x: 0, y: 0, width: 24, height: 24)

    @Test func losCincuentaYDosIconosDeLaWeb() {
        #expect(NombreIcono.allCases.count == 52)
    }

    @Test(arguments: NombreIcono.allCases)
    func ningunIconoVacioYTodosEnLaRejilla(_ nombre: NombreIcono) {
        let trazo = TrazosIcono.camino(nombre, parte: .trazo, en: caja)
        let relleno = TrazosIcono.camino(nombre, parte: .relleno, en: caja)
        #expect(!(trazo.isEmpty && relleno.isEmpty), "\(nombre.rawValue) no tiene dibujo")
        let partes = [trazo, relleno].filter { !$0.isEmpty }
        let limites = partes.map(\.boundingRect).reduce(CGRect.null) { $0.union($1) }
        #expect(limites.minX >= -0.01 && limites.minY >= -0.01, "\(nombre.rawValue): \(limites)")
        #expect(limites.maxX <= 24.01 && limites.maxY <= 24.01, "\(nombre.rawValue): \(limites)")
    }

    @Test func escalaYCentraEnElRectangulo() {
        let grande = TrazosIcono.camino(.stop, parte: .trazo, en: CGRect(x: 10, y: 0, width: 48, height: 48)).boundingRect
        // stop: rect 6,5-17,5 en la rejilla 24 → ×2 y desplazado 10.
        #expect(abs(grande.minX - 23) < 0.05 && abs(grande.maxX - 45) < 0.05)
        let ancho = TrazosIcono.camino(.stop, parte: .trazo, en: CGRect(x: 0, y: 0, width: 48, height: 24)).boundingRect
        #expect(abs(ancho.minX - 18.5) < 0.05, "centrado en horizontal si sobra ancho")
    }

    @Test func estrellaRellenaTieneTrazoYRelleno() {
        #expect(!TrazosIcono.camino(.starF, parte: .trazo, en: caja).isEmpty)
        #expect(!TrazosIcono.camino(.starF, parte: .relleno, en: caja).isEmpty)
        #expect(TrazosIcono.camino(.star, parte: .relleno, en: caja).isEmpty)
    }
}

@MainActor
struct NumTests {
    @Test func partirCifrasComoSplitDigits() {
        let partes = Num.segmentos("90+4'")
        #expect(partes == [
            SegmentoNum(cifra: true, texto: "9"), SegmentoNum(cifra: true, texto: "0"),
            SegmentoNum(cifra: false, texto: "+"), SegmentoNum(cifra: true, texto: "4"),
            SegmentoNum(cifra: false, texto: "'"),
        ])
        #expect(Num.segmentos("21:00").map(\.texto) == ["2", "1", ":", "0", "0"])
        #expect(Num.segmentos("45 + 2").map(\.texto) == ["4", "5", " + ", "2"])
        #expect(Num.segmentos("").isEmpty)
    }

    @Test func anchosDeCelda() {
        #expect(abs(Num.anchoCelda(tamano: 64, celda: Num.celdaCondensada) - 31.36) < 0.001)
        #expect(abs(Num.anchoCelda(tamano: 17, celda: Num.celdaCondensada) - 8.33) < 0.001)
        #expect(Num.celdaTexto == 0.645 && Num.celdaCodigo == 0.72)
    }
}

struct EstiloTextoTests {
    @Test func trackingDeEmAPuntos() {
        #expect(abs(EstiloTexto.titularVista.trackingPt - -0.6) < 0.0001)
        #expect(abs(EstiloTexto.kicker.trackingPt - 1.82) < 0.0001)
        #expect(abs(EstiloTexto.tituloHoja.trackingPt - -0.22) < 0.0001)
        #expect(abs(EstiloTexto.capsulaSm.trackingPt - 0.22) < 0.0001)
    }

    @Test func altoDeLineaComoLaWeb() {
        #expect(abs(EstiloTexto.cuerpo.altoLineaPt - 21.75) < 0.0001)
        #expect(abs(EstiloTexto.titularVista.altoLineaPt - 33) < 0.0001)
        #expect(abs(EstiloTexto.tituloHoja.altoLineaPt - 27.5) < 0.0001)
        #expect(abs(EstiloTexto.subtituloVista.altoLineaPt - 18.85) < 0.0001)
        #expect(EstiloTexto.menu.altoLineaPt == 15)
    }

    @Test func cifrasCondensadas() {
        let cifras = EstiloTexto.cifras(64)
        #expect(cifras.peso == 780 && cifras.anchura == 75 && cifras.tamano == 64)
        #expect(EstiloTexto.mono.mono && EstiloTexto.mono.anchura == 87.5)
    }
}
