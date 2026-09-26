import Foundation
import Testing

@testable import AceNeo

/* Avisos de «Directo» y «−30 s» decididos después de medir, como player/runtime.ts › goLive y back. */

struct AvisosSaltoTests {
    private let ventana = VentanaDirecto(inicio: 100, fin: 160)

    @Test func medirDirecto() {
        // Colchón equilibrado: min(8, max(1,2, 60 × 0,25)) = 8 → objetivo 152.
        let medida = MedidaDirecto.medir(ventana: ventana, actual: 140, modo: .balanced)
        #expect(medida == MedidaDirecto(objetivo: 152, detras: 12))
        #expect(MedidaDirecto.medir(ventana: ventana, actual: 158, modo: .balanced)?.detras == 0)
        #expect(MedidaDirecto.medir(ventana: nil, actual: 140, modo: .balanced) == nil)
    }

    @Test func directoEnElBorde() {
        #expect(ReglasSalto.enBorde(nil))
        #expect(ReglasSalto.enBorde(MedidaDirecto(objetivo: 152, detras: 1.25)))
        #expect(!ReglasSalto.enBorde(MedidaDirecto(objetivo: 152, detras: 1.3)))
        #expect(ReglasSalto.avisoEnBorde(sonaba: true).texto == "Ya estabas en el directo")
        let reanudado = ReglasSalto.avisoEnBorde(sonaba: false)
        #expect(reanudado == AvisoSalto(texto: "Directo reanudado", tono: .ok, icono: .directo))
    }

    @Test func directoTrasSaltar() {
        let antes = MedidaDirecto(objetivo: 152, detras: 20)
        let llego = ReglasSalto.avisoTrasSaltar(antes: antes, despues: MedidaDirecto(objetivo: 152, detras: 0.4))
        #expect(llego == AvisoSalto(texto: "De vuelta al directo", tono: .ok, icono: .directo))
        let noSeMovio = ReglasSalto.avisoTrasSaltar(antes: antes, despues: MedidaDirecto(objetivo: 152, detras: 20))
        #expect(noSeMovio == AvisoSalto(texto: "La señal no deja saltar más adelante", tono: .warn, icono: .aviso))
        #expect(ReglasSalto.avisoTrasSaltar(antes: antes, despues: nil).tono == .warn)
        // Recupera terreno de verdad aunque no llegue al borde: cuenta como hecho.
        #expect(ReglasSalto.llego(antes: antes, despues: MedidaDirecto(objetivo: 152, detras: 6)))
    }

    @Test func retrocesoSinVentanaOSinImagen() {
        #expect(ReglasSalto.planRetroceso(ventana: nil, actual: 140) == .avisar(ReglasSalto.sinImagen))
        #expect(ReglasSalto.sinImagen.texto == "Todavía no hay imagen guardada para retroceder")
        #expect(ReglasSalto.planRetroceso(ventana: ventana, actual: 101.2) == .avisar(ReglasSalto.noHayMas))
        #expect(ReglasSalto.noHayMas.texto == "No hay más imagen guardada hacia atrás")
    }

    @Test func retrocesoConLosSegundosReales() {
        #expect(ReglasSalto.planRetroceso(ventana: ventana, actual: 150) == .saltar(real: 30))
        // Solo quedan 12 s guardados (con el medio segundo de margen del reproductor).
        #expect(ReglasSalto.planRetroceso(ventana: ventana, actual: 112.5) == .saltar(real: 12))
        #expect(ReglasSalto.avisoRetrocedido(12).texto == "Retrocedido 12 s · pulsa DIRECTO para volver")
        #expect(ReglasSalto.avisoRetrocedido(12.5).texto == "Retrocedido 13 s · pulsa DIRECTO para volver")
        #expect(ReglasSalto.avisoRetrocedido(30).icono == .back)
    }

    @Test func retrocesoHecho() {
        #expect(ReglasSalto.retrocedio(antes: 150, despues: 120.3, real: 30))
        #expect(!ReglasSalto.retrocedio(antes: 150, despues: 150, real: 30))
        #expect(!ReglasSalto.retrocedio(antes: 150, despues: .nan, real: 30))
    }
}
