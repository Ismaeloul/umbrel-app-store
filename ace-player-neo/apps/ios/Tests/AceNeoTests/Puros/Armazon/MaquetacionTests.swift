import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Fórmulas del armazón (Core/Reglas/Maquetacion/Maquetacion.swift) con los seis tamaños de §1.10 y las
   medidas de la web (a2 §3.1 con zonas a 0, a2 §3.2 con el iPhone 16, a2 §16.1-§16.6 en horizontal,
   a4 §19.1). Escrito en la fase 0.3a (I0); M4 lo amplía. */

private func maquetacion(_ ancho: Double, _ alto: Double, arriba: Double = 0, izquierda: Double = 0,
                         abajo: Double = 0, derecha: Double = 0) -> Maquetacion {
    Maquetacion(ancho: ancho, alto: alto,
                seguras: Margenes(arriba: arriba, izquierda: izquierda, abajo: abajo, derecha: derecha))
}

/// Los seis tamaños (§1.10): 16e vertical, SE vertical, 13 mini vertical, 17 Pro vertical, 16e horizontal y
/// SE horizontal, con sus zonas seguras.
private let vertical390 = Maquetacion.referencia
private let se375 = maquetacion(375, 667, arriba: 20)
private let mini375 = maquetacion(375, 812, arriba: 50, abajo: 34)
private let pro402 = maquetacion(402, 874, arriba: 62, abajo: 34)
private let horizontal844 = maquetacion(844, 390, izquierda: 47, abajo: 21, derecha: 47)
private let se667 = maquetacion(667, 375)

private func casi(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 1e-9 }

struct MaquetacionTests {
    @Test func tiposDePantalla() {
        #expect([vertical390, se375, mini375, pro402, se667].allSatisfy { $0.tipo == .movil })
        #expect(horizontal844.tipo == .tableta)
        #expect(maquetacion(812, 375).tipo == .tableta)  // 13 mini en horizontal (a4 §18.2)
        #expect(se667.telefonoHorizontal && horizontal844.telefonoHorizontal)
        #expect(!vertical390.telefonoHorizontal && !vertical390.horizontal)
        #expect(se375.estrecho380 && !vertical390.estrecho380)
    }

    /// a2 §3.1: 390×844 con las zonas a 0, como las capturas de la web.
    @Test func coordenadasMedidasEnLaWeb() {
        let web = maquetacion(390, 844)
        #expect(web.marcoBarraInferior == Marco(x: 12, y: 770, ancho: 366, alto: 64))
        #expect(web.celdaBarra == 88)
        #expect(web.marcoMini() == Marco(x: 12, y: 688, ancho: 366, alto: 74))
        #expect(844 - web.bordeInferiorToasts(barra: true, mini: false) == 750)
        #expect(844 - web.bordeInferiorToasts(barra: true, mini: true) == 666)
        #expect(web.anchoToasts == 366)
        #expect(web.altoVelo(mini: false) == 100 && web.altoVelo(mini: true) == 180)
    }

    /// a2 §3.2: iPhone 16 (393×852, safeT 59, safeB 34).
    @Test func formulasConZonasSeguras() {
        let m = maquetacion(393, 852, arriba: 59, abajo: 34)
        #expect(m.marcoBarraInferior.y == 744)
        #expect(m.marcoMini().y == 662)
        #expect(m.bordeInferiorToasts(barra: true, mini: false) == 128)
        #expect(m.bordeInferiorToasts(barra: true, mini: true) == 212)
        #expect(m.bordeInferiorToasts(barra: false, mini: false) == 46)
        #expect(m.altoVelo(mini: false) == 134 && m.altoVelo(mini: true) == 214)
        #expect(m.rellenoInferiorContenido(mini: false, teatro: false) == 136)
        #expect(m.rellenoInferiorContenido(mini: true, teatro: false) == 216)
        #expect(m.rellenoInferiorContenido(mini: true, teatro: true) == 62)
        #expect(m.rellenoSuperiorCabecera(agenda: true) == 79)
    }

    @Test func referenciaDe390() {
        let m = vertical390
        #expect(m.marcoMini() == Marco(x: 12, y: 654, ancho: 366, alto: 74))
        #expect(m.marcoVideoMini() == Marco(x: 22, y: 664, ancho: 96, alto: 54))
        #expect(m.altoHeroe == 500)
        #expect(m.rellenoIzquierdo == 16 && m.rellenoDerecho == 16)
        #expect(!m.toastsALaDerecha)
    }

    @Test func verticalesPequenosYGrandes() {
        #expect(casi(se375.altoHeroe, 400.2))
        #expect(se375.rellenoSuperiorCabecera(agenda: true) == 40)
        #expect(se375.marcoBarraInferior == Marco(x: 12, y: 593, ancho: 351, alto: 64))
        #expect(mini375.marcoBarraInferior.y == 704)
        #expect(mini375.marcoMini().y == 622)
        #expect(pro402.altoHeroe == 500)
        #expect(pro402.marcoBarraInferior == Marco(x: 12, y: 766, ancho: 378, alto: 64))
        #expect(pro402.celdaBarra == 91)
    }

    /// a2 §16.6.1: iPhone SE en horizontal, maquetación móvil con las zonas a 0.
    @Test func seEnHorizontal() {
        let m = se667
        #expect(m.marcoBarraInferior == Marco(x: 12, y: 301, ancho: 643, alto: 64))
        #expect(m.celdaBarra == 157.25)
        #expect(m.marcoMini() == Marco(x: 12, y: 219, ancho: 643, alto: 74))
        #expect(m.anchoToasts == 420)
        #expect(375 - m.bordeInferiorToasts(barra: true, mini: false) == 281)
        #expect(375 - m.bordeInferiorToasts(barra: true, mini: true) == 197)
        #expect(m.rellenoInferiorContenido(mini: false, teatro: false) == 102)
        #expect(m.rellenoInferiorContenido(mini: true, teatro: false) == 182)
        #expect(m.rellenoSuperiorCabecera(agenda: true) == 20)
        #expect(m.altoHeroe == 360)
        #expect(m.barraInferior(teatroVisible: false, inmersivo: false, emparejando: false))
        #expect(m.inmersivo(teatroVisible: true, forzado: false))
    }

    /// a2 §16.1-§16.3 y a4 §19.1: 844×390, maquetación «tableta»; la app suma safeL (§0.4).
    @Test func horizontalDe844() {
        let m = horizontal844
        #expect(m.altoBarraSuperior == 64)
        #expect(m.marcoMini() == Marco(x: 63, y: 279, ancho: 440, alto: 74))
        #expect(m.anchoToasts == 420)
        #expect(m.toastsALaDerecha)
        #expect(m.bordeInferiorToasts(barra: false, mini: false) == 41)
        #expect(m.bordeInferiorToasts(barra: false, mini: true) == 125)
        #expect(m.rellenoInferiorContenido(mini: false, teatro: false) == 53)
        #expect(m.rellenoInferiorContenido(mini: true, teatro: false) == 141)
        #expect(m.rellenoSuperiorCabecera(agenda: true) == 76)
        #expect(m.rellenoSuperiorCabecera(agenda: false) == 88)
        #expect(m.rellenoIzquierdo == 63 && m.rellenoDerecho == 63)
    }

    /// Capturas de la web a 844×390 con las zonas a 0: mini de x 16 a 456 con el borde en 374; toasts
    /// con el borde en 370 sin mini.
    @Test func horizontalMedidoEnLaWeb() {
        let web = maquetacion(844, 390)
        let mini = web.marcoMini()
        #expect(mini.x == 16 && mini.x + mini.ancho == 456 && mini.y + mini.alto == 374)
        #expect(390 - web.bordeInferiorToasts(barra: false, mini: false) == 370)
        #expect(maquetacion(1000, 390).bordeInferiorToasts(barra: false, mini: true) == 20)
    }

    @Test func barrasEInmersivo() {
        #expect(vertical390.barraInferior(teatroVisible: false, inmersivo: false, emparejando: false))
        #expect(!vertical390.barraInferior(teatroVisible: true, inmersivo: false, emparejando: false))
        #expect(!vertical390.barraInferior(teatroVisible: false, inmersivo: false, emparejando: true))
        #expect(!vertical390.barraSuperior(inmersivo: false, emparejando: false))
        #expect(horizontal844.barraSuperior(inmersivo: false, emparejando: false))
        #expect(!horizontal844.barraSuperior(inmersivo: true, emparejando: false))
        #expect(!horizontal844.barraInferior(teatroVisible: false, inmersivo: false, emparejando: false))
        #expect(!vertical390.inmersivo(teatroVisible: true, forzado: false))
        #expect(vertical390.inmersivo(teatroVisible: false, forzado: true))
        #expect(horizontal844.inmersivo(teatroVisible: true, forzado: false))
        #expect(!horizontal844.inmersivo(teatroVisible: false, forzado: false))
    }
}
