import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Los carteles de fuente de Isma (26-sep, 15:30), calcados de origin/rediseno/iptv: `stripQualityMarks`
   (lista-real.test.ts), `channelDorsal` y `channelAbbrev` (ChannelMark.test.tsx), `posterNameOf`
   (SourcePoster.test.ts, sin el caso de IPTV, que la app aún no tiene) y el tipo «AceStream» de las listas. */

struct CalidadYDorsalTests {
    @Test func sinMarcasDeCalidadNiCodec() {
        #expect(CalidadNombre.sinMarcas("La 1 TVE 720p") == "La 1 TVE")
        #expect(CalidadNombre.sinMarcas("DAZN 1 1080p50 HEVC") == "DAZN 1")
        #expect(CalidadNombre.sinMarcas("M+ LaLiga TV 2 FHD") == "M+ LaLiga TV 2")
        #expect(CalidadNombre.sinMarcas("La 1 TVE 720p *") == "La 1 TVE")
        #expect(CalidadNombre.sinMarcas("Eurosport 4K / UHD") == "Eurosport")
        #expect(CalidadNombre.sinMarcas("1080p") == "1080p")
        #expect(CalidadNombre.esNumeroCalidad("720") && !CalidadNombre.esNumeroCalidad("24"))
    }

    @Test func dorsalNumeroOInicial() {
        #expect(TonoCanal.dorsal("DAZN 1") == "1")
        #expect(TonoCanal.dorsal("M+ Liga de Campeones 2") == "2")
        #expect(TonoCanal.dorsal("Eurosport") == "E")
        #expect(TonoCanal.dorsal("Ñoño TV") == "N")
        #expect(TonoCanal.dorsal("***") == "·")
    }

    @Test func dorsalSeSaltaResolucionCodecYFotogramas() {
        #expect(TonoCanal.dorsal("La 1 TVE 720p") == "1")
        #expect(TonoCanal.dorsal("La 1 TVE 720p *") == "1")
        #expect(TonoCanal.dorsal("La 1 TVE 720") == "1")
        #expect(TonoCanal.dorsal("DAZN 2 1080p") == "2")
        #expect(TonoCanal.dorsal("DAZN 2 1080i") == "2")
        #expect(TonoCanal.dorsal("DAZN 2 1080p50 H265") == "2")
        #expect(TonoCanal.dorsal("M+ LaLiga TV 3 2160") == "3")
        #expect(TonoCanal.dorsal("M+ LaLiga TV 3 x265 60fps") == "3")
        #expect(TonoCanal.dorsal("Eurosport 4K") == "E")
        #expect(TonoCanal.dorsal("Eurosport 8K") == "E")
        #expect(TonoCanal.dorsal("Movistar Plus+ 1080p H264") == "M")
        #expect(TonoCanal.dorsal("Canal 24 Horas 50 FPS") == "24")
        #expect(TonoCanal.dorsal("TV3 HD") == "3")
    }

    @Test func dorsalSeSaltaLaReservaYElTamano() {
        #expect(TonoCanal.dorsal("M. LALIGA 1 FHD (BK-2)") == "1")
        #expect(TonoCanal.dorsal("M. LALIGA HD (BK-1)") == "M")
        #expect(TonoCanal.dorsal("M. LALIGA [BK 2]") == "M")
        #expect(TonoCanal.dorsal("DAZN 2 BK-1") == "2")
        #expect(TonoCanal.dorsal("La 1 HD 1920x1080") == "1")
        #expect(TonoCanal.dorsal("DAZN 1 1280×720") == "1")
        #expect(TonoCanal.dorsal("Canal 24 Horas") == "24")
    }

    @Test func dorsalConLaLetraPegada() {
        #expect(TonoCanal.dorsal("DAZN F1") == "F1")
        #expect(TonoCanal.dorsal("SKY SPORTS F1 FHD") == "F1")
        #expect(TonoCanal.dorsal("M4 SPORT") == "M4")
        #expect(TonoCanal.dorsal("DAZN ACB 1") == "1")
    }

    @Test func siglaDeLaTesela() {
        #expect(TonoCanal.sigla("DAZN LaLiga") == "DAZN")
        #expect(TonoCanal.sigla("M+ Liga de Campeones 2") == "M+")
        #expect(TonoCanal.sigla("La 1 HD") == "LA 1")
        #expect(TonoCanal.sigla("Eurosport 1") == "EUROSP")
        #expect(TonoCanal.sigla("") == "")
        #expect(TonoCanal.sigla("DAZN ACB 1") == "DAZN ACB")
        #expect(TonoCanal.sigla("DAZN 1") == "DAZN")
        #expect(TonoCanal.sigla("DAZN F1") == "DAZN")
        #expect(TonoCanal.sigla("MOVISTAR PLUS +2") == "MOVIST")
        #expect(TonoCanal.sigla("LA LIGA 1") == "LA LIG")
    }

    private func entrada(_ titulo: String, sonda: SondaFuente? = nil) -> EntradaFuente {
        EntradaFuente(
            id: String(repeating: "1", count: 40), titulo: titulo, ih: false, origen: "m3u", listaId: "principal",
            canal: "", sonda: sonda)
    }

    @Test func nombreSinCalidadSiYaVaEnSuEtiqueta() {
        let medida = entrada("DAZN 2 1080p ** --> Faro", sonda: SondaFuente(estado: .working, rateKbps: 4200))
        #expect(NombreCartel.nombre(medida, ReglasFuentes.presentacion(medida, listas: [])) == "DAZN 2")
        let sinMedir = entrada("DAZN 2 1080p * --> Faro")
        #expect(NombreCartel.nombre(sinMedir, ReglasFuentes.presentacion(sinMedir, listas: [])) == "DAZN 2 1080p")
    }

    @Test func lasListasSonAceStream() {
        let e = entrada("M+ Liga de Campeones --> Prov1")
        let presentacion = ReglasFuentes.presentacion(e, listas: [])
        #expect(presentacion.tipo == "AceStream" && presentacion.etiqueta == "AceStream · Prov1")
    }
}
