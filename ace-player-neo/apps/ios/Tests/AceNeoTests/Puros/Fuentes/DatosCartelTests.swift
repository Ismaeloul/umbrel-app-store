import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Las líneas de debajo del cartel (web 613f80e): `posterDetailOf` con los casos del bloque «la frase del cartel, solo
   si no repite el estado» de model.test.ts, y `posterTagsOf` con los de SourcePoster.test.ts (sin los de IPTV, que
   la app no tiene). */

struct DatosCartelTests {
    private func frase(_ palabra: String?, _ detalle: String?) -> String? {
        DatosCartel.frase(palabra: palabra, detalle: detalle)
    }

    @Test func noSaleSiRepiteLaPalabraDelEstado() {
        #expect(frase("Verificada", "verificada") == nil)
        #expect(frase("Comprobando", "comprobando") == nil)
        #expect(frase("Sin señal", "sin senal") == nil)
        #expect(frase("Sin señal", "SIN SEÑAL.") == nil)
        #expect(frase("70% disponible", "70%  disponible") == nil)
        #expect(frase("Verificada", "  ") == nil)
        #expect(frase("Verificada", nil) == nil)
    }

    @Test func saleCuandoDiceAlgoMas() {
        #expect(frase("Comprobando", "probándose en el segundo motor") == "probándose en el segundo motor")
        #expect(frase("Sin comprobar", "disponibilidad sin medir") == "disponibilidad sin medir")
        #expect(frase("Comprobando", "comprobando en pantalla") == "comprobando en pantalla")
        #expect(frase("Pendiente", "en cola") == "en cola")
        #expect(frase("Floja", "señal detectada · vídeo sin confirmar") == "señal detectada · vídeo sin confirmar")
        #expect(frase("Verificada", "reproduciendo ahora") == "reproduciendo ahora")
        #expect(frase("", "en cola") == "en cola")
    }

    @Test func siEmpiezaRepitiendoElEstadoQuedaLoNuevo() {
        #expect(frase("Sin señal", "sin señal; reintento a las 21:30") == "reintento a las 21:30")
        #expect(frase("Verificada", "verificada · ") == nil)
    }

    private func entrada(sonda: SondaFuente? = nil, origen: String = "m3u", titulo: String = "M+ Liga de Campeones --> Prov1")
        -> EntradaFuente
    {
        EntradaFuente(
            id: String(repeating: "1", count: 40), titulo: titulo, ih: false, origen: origen, listaId: nil,
            canal: "M+ Liga de Campeones", sonda: sonda)
    }

    @Test func conLasFrasesDeVerdadDelModelo() {
        let e = entrada()
        func mostrada(_ estado: ScanCandidateState?, _ motivo: String = "") -> String? {
            let efectivo = Efectivo(estado: estado, motivo: motivo, reportada: false)
            return frase(ReglasFuentes.senal(efectivo, e).palabra, ReglasFuentes.detalle(efectivo, e))
        }
        #expect(mostrada(.working) == nil)
        #expect(mostrada(.failed) == nil)
        #expect(mostrada(.checking) == "probándose en el segundo motor")
        #expect(mostrada(.checking, "player_check") == "comprobando en pantalla")
        #expect(mostrada(.queued) == "en cola")
        #expect(mostrada(nil) == "disponibilidad sin medir")
    }

    private func etiquetas(_ e: EntradaFuente) -> [DatosCartel.Etiqueta] {
        DatosCartel.etiquetas(e, ReglasFuentes.presentacion(e, listas: []))
    }

    @Test func calidadCodecYTipoCadaUnoEnSuEtiqueta() {
        let e = entrada(sonda: SondaFuente(estado: .working, rateKbps: 4200, codec: "hevc"))
        #expect(etiquetas(e) == [
            DatosCartel.Etiqueta(clase: .calidad, texto: "1080p"),
            DatosCartel.Etiqueta(clase: .calidad, texto: "HEVC"),
            DatosCartel.Etiqueta(clase: .tipo, texto: "M3U"),
        ])
    }

    @Test func sinMedirSoloElTipo() {
        #expect(etiquetas(entrada()) == [DatosCartel.Etiqueta(clase: .tipo, texto: "M3U")])
    }

    @Test func elTipoNoSeRepiteSiYaVaEnLaTesela() {
        let guardada = entrada(origen: "saved", titulo: "M+ Liga de Campeones")
        #expect(etiquetas(guardada).isEmpty)
    }

    @Test func unaEtiquetaPorDatoDeCalidad() {
        #expect(ReglasFuentes.etiquetasCalidad(nil).isEmpty)
        #expect(ReglasFuentes.etiquetasCalidad(SondaFuente(estado: .working, streamKbps: 4800, codec: "hevc")) == ["1080p", "HEVC"])
        #expect(ReglasFuentes.etiquetasCalidad(SondaFuente(estado: .working, rateKbps: 2400)) == ["720p"])
        #expect(ReglasFuentes.etiquetasCalidad(SondaFuente(estado: .working, codec: "hev1")) == ["HEVC"])
        #expect(ReglasFuentes.calidad(SondaFuente(estado: .working, streamKbps: 4800, codec: "hevc")) == "1080p · HEVC")
    }
}
