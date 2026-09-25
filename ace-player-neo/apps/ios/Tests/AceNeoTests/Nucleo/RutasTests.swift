import Foundation
import Testing

@testable import AceNeo

/* Rutas de la app (Rutas.swift, solo iOS): plazos de la web, repetibles, administración 0.8.1 y caché. */

struct RutasTests {
    /// `timeoutFor` de apps/web/src/api/client.ts (a8 §3.11.1).
    @Test func plazosDeLaWebPorRuta() {
        #expect(API.bootstrap.plazo == 12)
        #expect(API.agenda.plazo == 14)
        #expect(API.buscar("x").plazo == 15)
        #expect(API.comprobacion(id: "a").plazo == 5)
        #expect(API.reiniciarMotor.plazo == 20)
        #expect(API.sincronizarDirectorio(DirectorySyncBody(url: "https://a/b.m3u")).plazo == 50)
        #expect(API.stream(id: "a", visor: "v_x").plazo == 60)
        #expect(API.resolver(partido: "p").plazo == 20)
        #expect(API.resolver(partido: "p", rebuscar: true).plazo == 30)
        #expect(API.ping().plazo == 4)  // carrera de direcciones: diferencia consciente
        #expect(API.salud.plazo == 12)
        #expect(API.guardarPreferencias(PreferencesInput()).plazo == 12)
    }

    /// Solo los GET se repiten contra la otra dirección; las mutaciones nunca (a7 §4.1).
    @Test func soloLosGETSonRepetibles() {
        #expect(API.biblioteca.idempotente)
        #expect(!API.guardarPreferencias(PreferencesInput()).idempotente)
        #expect(!API.guardarAjustes(SettingsUpdateBody(sameChannelPolicy: .handoff)).idempotente)
        #expect(!API.resolver(partido: "p").idempotente)  // GET con efectos
    }

    /// Las cinco rutas que la 0.8.1 abre a la app (a9 §2), por /native.
    @Test func rutasDeAdministracion() throws {
        let base = try #require(URL(string: "http://umbrel.local:7792"))
        #expect(try API.salud.url(base: base).path() == "/native/api/v1/health")
        #expect(try API.dispositivos.url(base: base).path() == "/native/api/v1/devices")
        #expect(API.revocarDispositivo(id: "dev_iphone01").metodo == .delete)
        #expect(try API.revocarDispositivo(id: "dev_iphone01").url(base: base).path()
            == "/native/api/v1/devices/dev_iphone01")
        #expect(API.crearCodigo(PairingCreateBody()).metodo == .post)
        #expect(API.guardarAjustes(SettingsUpdateBody()).metodo == .put)
    }

    /// Caché como la web (a7 §3.1): los GET revalidan con el ETag, el resto no usa la caché.
    @Test func politicaDeCache() throws {
        let base = try #require(URL(string: "http://umbrel.local:7792"))
        #expect(try API.agenda.peticion(base: base, token: nil).cachePolicy == .reloadRevalidatingCacheData)
        #expect(try API.reiniciarMotor.peticion(base: base, token: nil).cachePolicy == .reloadIgnoringLocalCacheData)
    }

}
