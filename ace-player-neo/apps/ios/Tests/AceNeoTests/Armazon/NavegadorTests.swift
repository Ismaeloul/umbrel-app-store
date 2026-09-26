import Foundation
import Testing

@testable import AceNeo

/* Navegación del armazón (Armazon/Navegador.swift; b-arquitectura §2.4.1 y §3.5; a2 §2.1-§2.2, app/router.tsx).
   M4. */

@MainActor
struct NavegadorTests {
    @Test func arrancaEnLaAgenda() {
        let nav = Navegador()
        #expect(nav.pestana == .agenda && nav.capa == nil)
        #expect(nav.visitadas == [.agenda])
        #expect(nav.destinoVisible == .agenda)
        #expect(!nav.teatroVisible)
    }

    @Test func irALaMismaRutaNoHaceNada() {
        let nav = Navegador()
        nav.ir(.canales(nil))
        let sentido = nav.sentido
        nav.ir(.canales(.favoritos))  // la pestaña de Canales recordada es Favoritos: la misma ruta
        #expect(nav.sentido == sentido)
        #expect(nav.pestana == .canales)
    }

    @Test func sentidoPorProfundidad() {
        let nav = Navegador()
        nav.ir(.canales(nil))
        #expect(nav.sentido == .adelante)
        nav.ir(.ajustes(nil))
        #expect(nav.sentido == .adelante)
        nav.ir(.buscar(q: nil))
        #expect(nav.sentido == .atras)
        nav.ir(.partido(id: "demo-1"), desde: .tarjeta(partido: "demo-1"))
        #expect(nav.sentido == .adelante)
        #expect(nav.origenApertura == .tarjeta(partido: "demo-1"))
    }

    @Test func lasVisitadasQuedanVivas() {
        let nav = Navegador()
        nav.ir(.ajustes(nil))
        nav.ir(.agenda)
        #expect(nav.visitadas == [.agenda, .ajustes])
    }

    @Test func tocarLaActivaSubeSinHaptica() {
        let haptica = Haptica()
        let nav = Navegador()
        nav.haptica = haptica
        nav.tocarPestana(.agenda)
        nav.tocarPestana(.agenda)
        #expect(nav.subirArriba[.agenda] == 2)
        #expect(nav.pestana == .agenda)
        #expect(haptica.pulso.n == 0)
    }

    @Test func tocarOtraCambiaConSeleccion() {
        let haptica = Haptica()
        let nav = Navegador()
        nav.haptica = haptica
        nav.tocarPestana(.buscar)
        #expect(nav.pestana == .buscar)
        #expect(haptica.pulso.n == 1 && haptica.pulso.tipo == .seleccion)
        #expect(nav.subirArriba[.buscar] == nil)
    }

    @Test func tocarUnaPestanaConLaCapaEncimaLaQuita() {
        let nav = Navegador()
        nav.ir(.sistema)
        nav.tocarPestana(.agenda)
        #expect(nav.capa == nil)
        #expect(nav.subirArriba[.agenda] == nil)
    }

    @Test func atrasQuitaLaCapaYSinCapaVaALaAgenda() {
        let nav = Navegador()
        nav.ir(.canales(nil))
        nav.ir(.partido(id: "demo-3"))
        #expect(nav.teatroVisible && nav.pestana == .canales)
        nav.atras()
        #expect(nav.capa == nil && nav.pestana == .canales && nav.sentido == .atras)
        #expect(nav.origenApertura == .ninguno)
        nav.atras()
        #expect(nav.pestana == .agenda)
        nav.atras()  // en la agenda sin capa: nada
        #expect(nav.pestana == .agenda && nav.capa == nil)
    }

    @Test func pestanaDeAjustesSinSeccionDesdeLaBarra() {
        let nav = Navegador()
        nav.ir(.ajustes(.salud))
        #expect(nav.seccionAjustes == .salud && nav.peticionSeccion == 1)
        #expect(nav.destinoVisible == .ajustes(.salud))
        nav.ir(.agenda)
        nav.tocarPestana(.ajustes)  // navRoute('ajustes') = { seccion: null }
        #expect(nav.seccionAjustes == nil && nav.peticionSeccion == 1)
    }

    @Test func pedirLaMismaSeccionOtraVezNoDesplaza() {
        let nav = Navegador()
        nav.ir(.ajustes(.motor))
        nav.ir(.ajustes(.motor))
        #expect(nav.peticionSeccion == 1)
        nav.ir(.ajustes(.salud))
        #expect(nav.peticionSeccion == 2)
    }

    @Test func recuerdaLaPestanaDeCanalesYLaBusqueda() {
        let nav = Navegador()
        nav.ir(.canales(.listas))
        nav.ir(.buscar(q: "dazn"))
        nav.ir(.agenda)
        #expect(nav.destino(de: .canales) == .canales(.listas))
        #expect(nav.destino(de: .buscar) == .buscar(q: "dazn"))
    }

    @Test func deUnTeatroAOtro() {
        let nav = Navegador()
        nav.ir(.partido(id: "a"), desde: .heroe(partido: "a"))
        nav.ir(.canal(hash: String(repeating: "a", count: 40)))
        #expect(nav.capa == .canal(hash: String(repeating: "a", count: 40)))
        #expect(nav.origenApertura == .ninguno)
        #expect(nav.pestana == .agenda)
    }
}
