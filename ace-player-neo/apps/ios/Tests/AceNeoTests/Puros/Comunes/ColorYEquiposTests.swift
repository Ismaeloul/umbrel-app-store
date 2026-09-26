import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* lib/color.ts, lib/teams.ts y ui/ChannelMark.tsx con los vectores del TypeScript real (vectores-comunes.json)
   y las filas de a7 §13.9 (tonos de canal de la demo). */

struct ColorTests {
    private let v = VectoresComunes.lote.color

    @Test func hexComoParseHexYRgbToHex() {
        for caso in v.hex {
            let rgb = ColorOKLab.desdeHex(caso.valor)
            #expect(casi(rgb, caso.rgb), "parseHex(\(caso.valor))")
            #expect(rgb.map(ColorOKLab.hex) == caso.hex, "rgbToHex(\(caso.valor))")
            #expect(casi(rgb.map(ColorOKLab.oklch), caso.oklch), "rgbToOklch(\(caso.valor))")
        }
    }

    @Test func oklchARgb() {
        for caso in v.oklch {
            let color = Oklch(l: caso.oklch.l, c: caso.oklch.c, h: caso.oklch.h)
            let rgb = ColorOKLab.rgb(color)
            #expect(casi(rgb, caso.rgb), "oklchToRgb(\(caso.oklch))")
            #expect(ColorOKLab.hex(rgb) == caso.hex)
            #expect(ColorOKLab.css(color, alfa: 0.5) == caso.css)
        }
    }

    @Test func leerOklch() {
        for caso in v.leerOklch {
            #expect(casi(ColorOKLab.leerOklch(caso.texto), caso.oklch), "parseOklch(\(caso.texto))")
        }
    }

    @Test func contrasteWCAG() {
        for caso in v.contraste {
            let a = ColorOKLab.desdeHex(caso.a)
            let b = ColorOKLab.desdeHex(caso.b)
            let valor = a.flatMap { x in b.map { ColorOKLab.contraste(x, $0) } }
            if let esperado = caso.contraste, let valor { #expect(casi(valor, esperado)) } else { #expect(valor == nil) }
        }
    }

    @Test func hashYTonoDelNombre() {
        for caso in v.hash { #expect(ColorOKLab.hashTexto(caso.nombre) == caso.hash, "hashText(\(caso.nombre))") }
        for caso in v.tonoDeNombre { #expect(ColorOKLab.tonoDeNombre(caso.nombre) == caso.tono, "hueFromName(\(caso.nombre))") }
        for caso in v.tonoVetado { #expect(ColorOKLab.tonoVetado(caso.tono) == caso.vetado, "isForbiddenHue(\(caso.tono))") }
        #expect(ColorOKLab.tonosPermitidos.count == 52)
    }

    @Test func luzDeEquipo() {
        for caso in v.luzEquipo {
            let luz = ColorOKLab.luzEquipo(primario: caso.primario, secundario: caso.secundario, oscuro: caso.oscuro)
            #expect(casi(luz, caso.luz), "teamLight(\(caso.primario), oscuro: \(caso.oscuro))")
        }
    }

    @Test func mezclaOKLabEnLosExtremos() {
        let oro = RGB(r: 1, g: 0.84, b: 0.04)
        let negro = RGB(r: 0, g: 0, b: 0)
        #expect(ColorOKLab.hex(ColorOKLab.mezclar(oro, negro, p: 1)) == ColorOKLab.hex(oro))
        #expect(ColorOKLab.hex(ColorOKLab.mezclar(oro, negro, p: 0)) == "#000000")
    }
}

struct TonoCanalTests {
    @Test func dorsalSiglaYTonoComoChannelMark() {
        for caso in VectoresComunes.lote.canal {
            #expect(casi(TonoCanal.tono(caso.nombre), caso.tono), "channelTone(\(caso.nombre))")
            #expect(TonoCanal.dorsal(caso.nombre) == caso.dorsal, "channelDorsal(\(caso.nombre))")
            #expect(TonoCanal.sigla(caso.nombre) == caso.sigla, "channelAbbrev(\(caso.nombre))")
        }
    }

    /// a7 §13.9: los tonos de los canales de la demo (OKLCH exacto).
    @Test(arguments: [
        ("DAZN 1", 0.46, 0.11, 200.0), ("M+ LaLiga", 0.46, 0.11, 355), ("DAZN", 0.46, 0.11, 10),
        ("Canal de prueba", 0.56, 0.13, 110), ("DAZN LaLiga", 0.46, 0.11, 120), ("M+ LaLiga 2", 0.46, 0.11, 180),
        ("M+ Liga de Campeones", 0.46, 0.11, 185), ("M+ Liga de Campeones 2", 0.46, 0.11, 175),
        ("Zapping", 0.46, 0.11, 340), ("La 1 HD", 0.46, 0.11, 355), ("GOL Play", 0.56, 0.13, 75),
        ("DAZN LaLiga 2", 0.56, 0.13, 90), ("Amazon Prime Video", 0.46, 0.11, 325), ("DAZN 1 HD", 0.46, 0.11, 125),
    ])
    func tonosDeLaDemo(_ caso: (String, Double, Double, Double)) {
        #expect(TonoCanal.tono(caso.0) == Oklch(l: caso.1, c: caso.2, h: caso.3))
    }

    @Test func tonoAltoSube012() {
        #expect(casi(TonoCanal.tonoAlto("DAZN 1").l, 0.58))
        #expect(TonoCanal.dorsalEsLetra("Eurosport") && !TonoCanal.dorsalEsLetra("DAZN 1"))
    }
}

struct EquiposTests {
    private let v = VectoresComunes.lote.equipos

    @Test func inicialesYCompeticion() {
        for caso in v.iniciales {
            #expect(Equipos.iniciales(caso.nombre, corto: caso.corto) == caso.iniciales, "teamInitials(\(caso.nombre))")
        }
        for caso in v.competicion {
            #expect(Equipos.competicionCorta(caso.nombre) == caso.corta, "competitionShort(\(caso.nombre))")
        }
    }

    @Test func tonoDelNombreYPaletas() {
        for caso in v.tonoNombre { #expect(casi(Equipos.tonoNombre(caso.nombre), caso.tono)) }
        for caso in v.paletas {
            let paleta = Equipos.paleta(
                nombre: caso.equipo.name, primario: caso.equipo.colors?.primary, secundario: caso.equipo.colors?.secondary)
            #expect(paleta.primario == caso.paleta.primary, "paletteOf(\(caso.equipo.name))")
            #expect(paleta.secundario == caso.paleta.secondary)
            #expect(paleta.origen.rawValue == caso.paleta.source)
        }
    }

    @Test func parVersus() {
        for caso in v.versus {
            let local = PaletaEquipo(
                primario: caso.local.primary, secundario: caso.local.secondary,
                origen: OrigenPaleta(rawValue: caso.local.source) ?? .api)
            let visitante = PaletaEquipo(
                primario: caso.visitante.primary, secundario: caso.visitante.secondary,
                origen: OrigenPaleta(rawValue: caso.visitante.source) ?? .api)
            #expect(casi(Equipos.distancia(local.primario, visitante.primario), caso.distancia))
            let par = Equipos.versus(local, visitante)
            let esperado = ParVersus(
                local: caso.par.home, visitante: caso.par.away, cambiado: caso.par.swapped, oscurecido: caso.par.darkened)
            #expect(par == esperado, "versusPair(\(local.primario), \(visitante.primario))")
        }
    }

    @Test func escudosSoloDeMismoOrigen() {
        #expect(Equipos.mismoOrigen("/api/v1/football/teams/1/crest") == "/api/v1/football/teams/1/crest")
        #expect(Equipos.mismoOrigen("//cdn.example.com/x.png") == nil)
        #expect(Equipos.mismoOrigen("https://example.com/x.png") == nil)
        #expect(Equipos.mismoOrigen(nil) == nil)
    }
}
