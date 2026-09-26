import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Lo vertical manda: un carril o un pan horizontal solo se quedan lo claramente horizontal (prueba de Isma). */

struct EjeGestoTests {
    @Test func loClaramenteHorizontalEsHorizontal() {
        #expect(EjeGesto.horizontal(dx: 30, dy: 0))
        #expect(EjeGesto.horizontal(dx: -24, dy: 12))
        #expect(EjeGesto.horizontal(dx: 12, dy: 10))
    }

    @Test func loSobreTodoVerticalYLaDiagonalVanALaPagina() {
        #expect(!EjeGesto.horizontal(dx: 2, dy: 20))
        #expect(!EjeGesto.horizontal(dx: 10, dy: 10))
        #expect(!EjeGesto.horizontal(dx: 11, dy: 10))
        #expect(!EjeGesto.horizontal(dx: 0, dy: 0))
    }

    @Test func sinRecorridoMandaLaVelocidad() {
        #expect(EjeGesto.horizontal(dx: 0, dy: 0, vx: 600, vy: 100))
        #expect(!EjeGesto.horizontal(dx: 0, dy: 0, vx: 100, vy: 600))
    }
}
