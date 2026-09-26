import Foundation
import Testing

@testable import AceNeo

/* Reglas del escenario por el ancho del vídeo (b-arquitectura §3.7: 369/419/479/579 y compacto) con las medidas
   de la web (a4 §4.1, §5.4, §6.2, §18, §18.1). */

private func variante(_ video: Double, ventana: Double? = nil, inmersivo: Bool = false) -> VarianteEscenario {
    VarianteEscenario(anchoVideo: video, anchoVentana: ventana ?? video, inmersivo: inmersivo)
}

struct VarianteEscenarioTests {
    @Test func minutoTrasMarcadorDesde370() {
        #expect(!variante(369).minutoTrasMarcador)
        #expect(variante(370).minutoTrasMarcador)
        #expect(variante(375).minutoTrasMarcador)  // iPhone mini y SE: el minuto se ve (a4 §4.1)
    }

    @Test func prefijoDelDirectoDesde420() {
        #expect(!variante(419).prefijoDirecto)
        #expect(variante(420).prefijoDirecto)
        #expect(!variante(390).prefijoDirecto)  // vertical: solo «−34 s»
        #expect(variante(844).prefijoDirecto)
    }

    @Test func marcadorAnchoDesde480() {
        #expect(!variante(479).marcadorAncho)
        #expect(variante(480).marcadorAncho)
        #expect(!variante(480).mensajeGrande)
        #expect(variante(481).mensajeGrande)
    }

    @Test func detenerEnFilaDesde580FueraDeCompacto() {
        #expect(!variante(579, ventana: 844).detenerEnFila)
        #expect(variante(580, ventana: 844).detenerEnFila)
        #expect(!variante(667, ventana: 667, inmersivo: true).detenerEnFila)  // SE en horizontal: compacto (a4 §18.1)
        #expect(variante(812, ventana: 812, inmersivo: true).detenerEnFila)  // 13 mini en horizontal (a4 §18.2)
    }

    @Test func compacto() {
        let vertical = variante(390)
        #expect(vertical.compacto && vertical.minimizarVisible && !vertical.capsulaCanal)
        #expect(vertical.deslizarAbajoMinimiza)
        #expect(vertical.subidaEstado == 60)
        let se = variante(667, inmersivo: true)
        #expect(se.compacto && se.minimizarVisible && !se.deslizarAbajoMinimiza)
        #expect(se.subidaEstado == 60)
        let horizontal = variante(844, inmersivo: true)
        #expect(!horizontal.compacto && horizontal.capsulaCanal && !horizontal.minimizarVisible)
        #expect(horizontal.subidaEstado == 64)
    }

    @Test func rellenoDeLosControles() {
        #expect(variante(390).rellenoControles(Margenes()) == Margenes(arriba: 8, izquierda: 8, abajo: 8, derecha: 8))
        let seguras = Margenes(arriba: 0, izquierda: 47, abajo: 21, derecha: 47)
        let esperado = Margenes(arriba: 12, izquierda: 47, abajo: 21, derecha: 47)
        #expect(variante(844, inmersivo: true).rellenoControles(seguras) == esperado)
        #expect(variante(667, inmersivo: true).rellenoControles(Margenes()) == Margenes(arriba: 12, izquierda: 12, abajo: 12, derecha: 12))
    }

    @Test func anchosDelBotonDirecto() {
        #expect(variante(390).anchoDirecto(.behind) == 82)
        #expect(variante(667).anchoDirecto(.behind) == 164.3)
        #expect(variante(390).anchoDirecto(.resume) == 112.7)
        #expect(variante(390).anchoDirecto(.live) == 95.7)
    }

    /// Con AirPlay y «Reanudar» la fila de abajo no cabe a 375: el Directo pasa a solo icono; a 390 cabe.
    @Test func directoSoloIconoConAirPlay() {
        let reanudar = variante(375).anchoDirecto(.resume)
        #expect(variante(375).directoSoloIcono(anchoDirecto: reanudar, airPlay: true))
        #expect(!variante(375).directoSoloIcono(anchoDirecto: reanudar, airPlay: false))
        #expect(!variante(390).directoSoloIcono(anchoDirecto: reanudar, airPlay: true))
        #expect(!variante(375).directoSoloIcono(anchoDirecto: variante(375).anchoDirecto(.live), airPlay: true))
    }
}
