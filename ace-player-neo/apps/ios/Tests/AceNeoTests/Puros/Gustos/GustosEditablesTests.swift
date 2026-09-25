import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Casos de apps/web/src/features/preferences/model.test.ts portados a Swift Testing (M5). */

@Suite struct ModeloGustosTests {
    private func preferencias(ligas: [String] = [], equipos: [String] = [], nacionalidades: [String] = [], pais: String = "")
        -> Preferences
    {
        Preferences(onboardingComplete: false, country: pais, leagues: ligas, teams: equipos, nationalities: nacionalidades)
    }

    @Test func catalogo() {
        #expect(TipoGusto.ligas.sugerencias.count == 9)
        #expect(TipoGusto.equipos.sugerencias.count == 12)
        #expect(TipoGusto.nacionalidades.sugerencias.count == 14)
        #expect(ModeloGustos.bandera("España") == "🇪🇸")
        #expect(ModeloGustos.bandera("Japón") == "🌍")
        #expect(TipoGusto.nacionalidades.explicacion == "Selecciones y fútbol de los países que sigues.")
        #expect(TipoGusto.ligas.textoLleno == "Has llegado al máximo de 12 ligas.")
    }

    @Test func limpieza() {
        #expect(ModeloGustos.limpiar(["  Real  Madrid ", "real madrid", "", "Barça"], tipo: .equipos) == ["Real Madrid", "Barça"])
        #expect(ModeloGustos.limpiar((0..<30).map { "Equipo \($0)" }, tipo: .equipos).count == 24)
        #expect(ModeloGustos.limpiar([String(repeating: "x", count: 100)], tipo: .ligas).first?.count == 60)
        #expect(ModeloGustos.limpiar(nil, tipo: .ligas).isEmpty)
        #expect(ModeloGustos.valorPropio(" a ", tipo: .equipos) == nil)
        #expect(ModeloGustos.valorPropio("  Getafe  CF ", tipo: .equipos) == "Getafe CF")
        #expect(ModeloGustos.valorPropio(String(repeating: "y", count: 90), tipo: .nacionalidades)?.count == 60)
    }

    @Test func borrador() {
        let borrador = ModeloGustos.borrador(preferencias(ligas: ["LaLiga"], nacionalidades: ["España"]))
        let marcado = ModeloGustos.alternar(borrador, .equipos, "Inter")
        #expect(marcado.teams == ["Inter"])
        #expect(ModeloGustos.alternar(marcado, .equipos, "Inter").teams.isEmpty)
        #expect(ModeloGustos.hayAlguno(borrador))
        #expect(!ModeloGustos.hayAlguno(.vacios))
    }

    @Test func listaLlena() {
        let llena = GustosFutbol(leagues: (0..<12).map { "Liga \($0)" })
        #expect(ModeloGustos.alternar(llena, .ligas, "Serie A") == llena)
        #expect(ModeloGustos.anadir(llena, .ligas, "Eredivisie") == ResultadoAnadir(borrador: llena, anadido: nil, lleno: true))
    }

    @Test func anadirMarcaElQueYaExiste() {
        let primero = ModeloGustos.anadir(.vacios, .equipos, "real madrid")
        #expect(primero.borrador.teams == ["Real Madrid"])
        let propio = ModeloGustos.anadir(primero.borrador, .equipos, "Getafe")
        #expect(propio.borrador.teams == ["Real Madrid", "Getafe"])
        #expect(ModeloGustos.chips(.equipos, propio.borrador).last == "Getafe")
        #expect(ModeloGustos.anadir(propio.borrador, .equipos, "GETAFE").borrador.teams.count == 2)
        #expect(ModeloGustos.anadir(.vacios, .nacionalidades, "Japón").borrador.nationalities == ["Japón"])
        #expect(ModeloGustos.anadir(.vacios, .equipos, "x") == ResultadoAnadir(borrador: .vacios, anadido: nil, lleno: false))
    }

    @Test func resumen() {
        #expect(ModeloGustos.resumen(.vacios) == "Personaliza la agenda con tus ligas, equipos y nacionalidades.")
        #expect(
            ModeloGustos.resumen(GustosFutbol(leagues: ["LaLiga"], teams: ["A", "B"], nationalities: ["España"]))
                == "Tu agenda prioriza 1 liga, 2 equipos y 1 nacionalidad.")
        #expect(ModeloGustos.resumen(GustosFutbol(nationalities: ["A", "B"])) == "Tu agenda prioriza 2 nacionalidades.")
    }

    @Test func guardarYSeguir() {
        let cuerpo = ModeloGustos.cuerpo(preferencias(pais: "Spain"), GustosFutbol(leagues: ["LaLiga"]))
        #expect(cuerpo == PreferencesInput(onboardingComplete: true, country: "Spain", leagues: ["LaLiga"], teams: [], nationalities: []))
        #expect(ModeloGustos.cuerpo(nil, .vacios).country == "Spain")

        let mias = preferencias(ligas: ["LaLiga"], equipos: ["Barcelona"])
        #expect(ModeloGustos.equipoSeguido(mias, "FC Barcelona") == "Barcelona")
        #expect(ModeloGustos.equipoSeguido(mias, "Barcelona SC") == nil)
        #expect(ModeloGustos.ligaSeguida(mias, "La Liga EA Sports") == "LaLiga")
        #expect(ModeloGustos.alternarSeguir(mias, .equipos, "FC Barcelona")?.teams == [])
        #expect(ModeloGustos.alternarSeguir(mias, .equipos, "Girona")?.teams == ["Barcelona", "Girona"])
        #expect(ModeloGustos.alternarSeguir(mias, .ligas, "LaLiga")?.leagues == [])
        let llena = preferencias(ligas: ["LaLiga"], equipos: (0..<24).map { "Equipo \($0)" })
        #expect(ModeloGustos.alternarSeguir(llena, .equipos, "Girona") == nil)
    }
}
