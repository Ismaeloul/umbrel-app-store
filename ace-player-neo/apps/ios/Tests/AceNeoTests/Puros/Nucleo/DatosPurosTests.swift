import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Datos puros de §2.1.4 (Core/Reglas/Datos): esperas del SSE, identidad, capacidades y relojes. Escrito en
   la fase 0.3a (I0); M1 lo reparte en EsperaSSETests, IdentidadTests, CapacidadesTests y RelojTests y añade
   EfectosEventoTests cuando rellene la tabla de a7 §6.3-6.4. */

struct EsperaSSETests {
    /// a7 §6.2: 3, 6, 12, 24, 48, 60, 60… s; un intento ≤ 0 cuenta como el primero.
    @Test func esperasDeLaWeb() {
        let esperas = (0...8).map { EsperaSSE.espera(intento: $0) }
        #expect(esperas == [3, 3, 6, 12, 24, 48, 60, 60, 60])
        #expect(EsperaSSE.espera(intento: 1000) == 60)
    }
}

struct IdentidadTests {
    /// a7 §7: `<deviceId>.<secreto>` → `deviceId`.
    @Test func idDelToken() {
        #expect(IdentidadDispositivo.id(token: "dev_abc.s3cr3t.con.puntos") == "dev_abc")
        #expect(IdentidadDispositivo.id(token: "sinpunto") == "sinpunto")
        #expect(IdentidadDispositivo.id(token: "") == nil)
    }
}

struct CapacidadesTests {
    @Test func soloCierraOriginForbidden() {
        var capacidades = Capacidades()
        #expect(!capacidades.servidorViejo)
        capacidades.registrar("unauthorized", en: .health)
        capacidades.registrar("device_revoked", en: .devicesList)
        #expect(!capacidades.servidorViejo)
        capacidades.registrar("origin_forbidden", en: .settingsUpdate)
        #expect(capacidades.servidorViejo && capacidades.cerradas == [.settingsUpdate])
        capacidades.olvidar()
        #expect(!capacidades.servidorViejo)
    }

    /// a9 §2: las cinco rutas que la 0.8.1 abre a la app (sin `healthLive`, §0.0 punto 2).
    @Test func rutasDeAdministracion() {
        #expect(RutaAdministracion.allCases.map(\.rawValue)
            == ["health", "settingsUpdate", "pairingCreate", "devicesList", "deviceRevoke"])
    }
}

struct RelojTests {
    @Test func relojDesplazadoAvanzaConElDeVerdad() {
        let inicio = Date(timeIntervalSince1970: 1_790_000_000)
        let reloj = RelojDesplazado(inicio: inicio, arranque: Date().addingTimeInterval(-60))
        let pasado = reloj.ahora.timeIntervalSince(inicio)
        #expect(pasado >= 60 && pasado < 70)
    }

    @Test func relojDelSistema() {
        #expect(abs(RelojSistema().ahora.timeIntervalSinceNow) < 5)
    }
}

struct RutasConsultaTests {
    /// Un evento que la app no conoce no provoca nada (a7 §6.3: se ignora sin romper la conexión).
    @Test func eventoDesconocidoNoHaceNada() {
        #expect(EfectosEvento.de(.desconocido(type: "x")).isEmpty)
        #expect(RutaConsulta.allCases.count == 16)
    }
}
