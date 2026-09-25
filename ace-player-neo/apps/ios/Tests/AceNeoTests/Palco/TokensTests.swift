import Foundation
import SwiftUI
import Testing
import UIKit

@testable import AceNeo

/* TokensTests (b-arquitectura §3.1): cada color de Palco, resuelto en claro y en oscuro, es el hex de la web que
   dejó generar-tokens.mjs en Vectores/vectores-tokens.json (a1 §2.1-2.3). */

private struct ValorToken: Decodable {
    let hex: String
    let alfa: Double
}

private struct EntradaToken: Decodable {
    let nombre: String
    let claro: ValorToken
    let oscuro: ValorToken
}

@MainActor
struct TokensTests {
    private func entradas() throws -> [EntradaToken] {
        try JSONDecoder().decode([EntradaToken].self, from: Vectores.datos("vectores-tokens"))
    }

    /// Los cuatro canales (0…255) y el alfa de un color resuelto con un estilo.
    private func canales(_ color: Color, _ estilo: UIUserInterfaceStyle) -> (Int, Int, Int, Double) {
        let resuelto = UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: estilo))
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        _ = resuelto.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()), Double(a))
    }

    private func esperado(_ valor: ValorToken) -> (Int, Int, Int, Double) {
        let n = Int(valor.hex.dropFirst(), radix: 16) ?? -1
        return ((n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF, valor.alfa)
    }

    @Test func elCatalogoTieneTodosLosTokensDeLaWeb() throws {
        let nombres = Set(Palco.catalogo.map(\.nombre))
        let web = try entradas()
        #expect(web.count >= 40)
        for entrada in web {
            #expect(nombres.contains(entrada.nombre), "Falta \(entrada.nombre) en Palco")
        }
    }

    @Test func cadaTokenEsElHexDeLaWebEnClaroYOscuro() throws {
        let porNombre = Dictionary(uniqueKeysWithValues: Palco.catalogo.map { ($0.nombre, $0.color) })
        for entrada in try entradas() {
            guard let color = porNombre[entrada.nombre] else { continue }
            for (estilo, valor) in [(UIUserInterfaceStyle.light, entrada.claro), (.dark, entrada.oscuro)] {
                let propio = canales(color, estilo)
                let web = esperado(valor)
                #expect(propio.0 == web.0 && propio.1 == web.1 && propio.2 == web.2,
                        "\(entrada.nombre) \(estilo == .dark ? "oscuro" : "claro"): \(propio) ≠ \(valor.hex)")
                #expect(abs(propio.3 - web.3) < 0.002, "\(entrada.nombre): alfa \(propio.3) ≠ \(web.3)")
            }
        }
    }

    @Test func islaOscuraDaLosValoresOscurosAunqueLaAppEsteEnClaro() {
        // `.islaOscura()` = `colorScheme .dark` en el subárbol: el color dinámico resuelve la rama oscura.
        let okEnIsla = canales(Palco.okInk, .dark)
        #expect(okEnIsla.0 == 0x35 && okEnIsla.1 == 0xC7 && okEnIsla.2 == 0x59)
    }

    @Test func cristalYSolidos() {
        #expect(canales(CristalPalco.solido(.regular), .light).0 == 0xFA)
        #expect(canales(CristalPalco.solido(.video), .light).0 == 0x0F)
        #expect(canales(PalcoMezcla.liveCapsula, .dark).0 == 0xD1)
    }

    @Test func medidasDeLaWeb() {
        #expect(S.s1 == 4 && S.s12 == 48 && S.gutter == 16 && S.tap == 44)
        #expect(R.xl == 24 && R.l == 18 && R.m == 14 && R.s == 10 && R.xs == 6)
        #expect(R.interiorTarjeta(24, relleno: 16) == 8 && R.interiorTarjeta(18, relleno: 12) == 6)
        #expect(Capa.barra == 40 && Capa.mini == 41 && Capa.avisos == 60 && Capa.inmersivo == 100)
        #expect(Alturas.mini == 72 && Alturas.barra == 64)
    }

    @Test func sombrasConExtensionNegativa() {
        let s1 = SombraPalco.s1.capas
        #expect(s1.count == 2 && s1[1].expansion == -16 && s1[1].desenfoque == 24 && s1[1].y == 8)
        let s2 = SombraPalco.s2.capas
        #expect(s2.count == 1 && s2[0].expansion == -20 && s2[0].y == 20 && s2[0].desenfoque == 60)
        #expect(SombraPalco.video.capas[0].expansion == -8)
    }

    @Test func ondaDeDirecto() {
        let inicio = Movimiento.onda(0, maxima: 2.4)
        #expect(abs(inicio.escala - 1) < 0.001 && abs(inicio.opacidad - 0.75) < 0.001)
        let fin = Movimiento.onda(1.5, maxima: 2.4)  // pasado el 70 % de 2 s
        #expect(fin.escala == 2.4 && fin.opacidad == 0)
        #expect(abs(Movimiento.curvaSalida(1) - 1) < 0.001 && abs(Movimiento.curvaSalida(0)) < 0.001)
        #expect(Movimiento.escalonado(3) == 3 * 0.036 && Movimiento.escalonado(40) == 10 * 0.036)
    }
}
