import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Geometría de la transición tarjeta → teatro (Core/Reglas/Transicion/GeometriaVuelo.swift; b-arquitectura §3.5,
   a2 §2.4 y §11). M4. */

private func casi(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 1e-9 }

private let ventana = Marco(x: 0, y: 0, ancho: 390, alto: 844)
/// Una tarjeta de la agenda (a3: carril de 300 a 16 del borde).
private let tarjeta = Marco(x: 16, y: 600, ancho: 300, alto: 170)

struct GeometriaVueloTests {
    @Test func marcoIntermedio() {
        let medio = GeometriaVuelo.marco(desde: tarjeta, hasta: ventana, progreso: 0.5)
        #expect(casi(medio.x, 8) && casi(medio.y, 300) && casi(medio.ancho, 345) && casi(medio.alto, 507))
        #expect(GeometriaVuelo.marco(desde: tarjeta, hasta: ventana, progreso: 0) == tarjeta)
        #expect(GeometriaVuelo.marco(desde: tarjeta, hasta: ventana, progreso: 1) == ventana)
    }

    @Test func zoomEmpiezaEnLaTarjetaYAcabaEnLaIdentidad() {
        let inicio = GeometriaVuelo.zoom(origen: tarjeta, destino: ventana, progreso: 0)
        #expect(casi(inicio.escala, 300.0 / 390.0))
        // La esquina superior izquierda de la ventana cae en la de la tarjeta; el ancho, en el de la tarjeta.
        #expect(casi(inicio.dx, 16) && casi(inicio.dy, 600))
        #expect(casi(390 * inicio.escala, 300))
        #expect(GeometriaVuelo.zoom(origen: tarjeta, destino: ventana, progreso: 1) == .identidad)
    }

    @Test func zoomSinTamanoNoRompe() {
        let vacio = Marco(x: 0, y: 0, ancho: 0, alto: 0)
        #expect(GeometriaVuelo.zoom(origen: tarjeta, destino: vacio, progreso: 0) == .identidad)
        #expect(GeometriaVuelo.zoom(origen: vacio, destino: ventana, progreso: 0) == .identidad)
    }

    @Test func muelleQueSePasaDeUno() {
        // El muelle estándar rebasa a 1,006 (a1 §7.1): el marco sigue la cuenta; el radio no baja de 0.
        let pasado = GeometriaVuelo.marco(desde: tarjeta, hasta: ventana, progreso: 1.006)
        #expect(pasado.ancho > 390)
        #expect(GeometriaVuelo.radio(inicial: 14, progreso: 1.006) == 0)
    }

    @Test func radioDeLasEsquinas() {
        #expect(GeometriaVuelo.radio(inicial: 14, progreso: 0) == 14)
        #expect(casi(GeometriaVuelo.radio(inicial: 24, progreso: 0.5), 12))
        #expect(GeometriaVuelo.radio(inicial: 24, progreso: 1) == 0)
        #expect(GeometriaVuelo.radio(inicial: 18, progreso: -0.2) == 18)
        #expect(GeometriaVuelo.radioOrigen(heroe: false, mini: false) == 14)
        #expect(GeometriaVuelo.radioOrigen(heroe: true, mini: false) == 24)
        #expect(GeometriaVuelo.radioOrigen(heroe: false, mini: true) == 18)
    }

    @Test func contenidoDeLaTarjetaSeFundeEnLaPrimeraMitad() {
        #expect(GeometriaVuelo.opacidadContenidoTarjeta(0) == 1)
        #expect(casi(GeometriaVuelo.opacidadContenidoTarjeta(0.25), 0.5))
        #expect(GeometriaVuelo.opacidadContenidoTarjeta(0.5) == 0)
        #expect(GeometriaVuelo.opacidadContenidoTarjeta(0.9) == 0)
        #expect(GeometriaVuelo.opacidadContenidoTarjeta(-1) == 1)
    }

    @Test func pestanaDeDebajoConElBorde() {
        #expect(GeometriaVuelo.entradaPestanaConBorde(dx: 0, ancho: 390) == -16)
        #expect(casi(GeometriaVuelo.entradaPestanaConBorde(dx: 195, ancho: 390), -8))
        #expect(GeometriaVuelo.entradaPestanaConBorde(dx: 390, ancho: 390) == 0)
        #expect(GeometriaVuelo.entradaPestanaConBorde(dx: 800, ancho: 390) == 0)
        #expect(GeometriaVuelo.entradaPestanaConBorde(dx: 100, ancho: 0) == -16)
        #expect(GeometriaVuelo.arrastreBorde(-30) == 0 && GeometriaVuelo.arrastreBorde(42) == 42)
    }

    @Test func entradaDeVista() {
        #expect(GeometriaVuelo.entradaVista(.adelante, reducido: false) == 16)
        #expect(GeometriaVuelo.entradaVista(.atras, reducido: false) == -16)
        #expect(GeometriaVuelo.entradaVista(.adelante, reducido: true) == 0)
        #expect(GeometriaVuelo.entradaVista(.atras, reducido: true) == 0)
    }

    @Test func soltarElBordeComoLaWeb() {
        // a2 §2.4: vuelve con dx ≥ 0,35·ancho o (vx ≥ 450 y dx ≥ 24).
        #expect(GeometriaVuelo.vuelveConElBorde(dx: 137, vx: 0, ancho: 390))
        #expect(!GeometriaVuelo.vuelveConElBorde(dx: 136, vx: 0, ancho: 390))
        #expect(GeometriaVuelo.vuelveConElBorde(dx: 24, vx: 450, ancho: 390))
        #expect(!GeometriaVuelo.vuelveConElBorde(dx: 23, vx: 900, ancho: 390))
    }
}
