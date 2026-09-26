import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Ajustes › Listas y Tu fútbol (M7): los casos de directories/DirectoriesSection.test.tsx y del
   `preferenceSummary` de SettingsView.tsx. */

private func lista(
    tipo: WebSourceType = .html, cuenta: Int = 12, sincronizada: String? = "2026-09-23T18:30:00.000Z",
    falloEn: String? = "2026-09-23T19:00:00.000Z", fallo: String? = "http_429"
) -> WebSourceSummary {
    WebSourceSummary(id: "s2", name: "Respaldo", url: "https://example.com/r.html", type: tipo, count: cuenta,
                     syncedAt: sincronizada, lastErrorAt: falloEn, lastError: fallo)
}

struct ModeloListasTests {
    @Test func motivoCortoDelUltimoFallo() {
        #expect(ModeloListas.motivo("http_429") == "el servidor limita las descargas (429)")
        #expect(ModeloListas.motivo("http_503") == "el servidor respondió 503")
        #expect(ModeloListas.motivo("fetch_timeout") == "el servidor no respondió a tiempo")
        #expect(ModeloListas.motivo("empty_directory") == "la lista llegó vacía")
        #expect(ModeloListas.motivo("dns_failed") == "no se resolvió el dominio")
        #expect(ModeloListas.motivo("ipfs_not_found") == "la lista ya no está en esa dirección de IPFS")
        #expect(ModeloListas.motivo("ipfs_bad_block") == "la red IPFS no entregó la lista")
        #expect(ModeloListas.motivo("raro") == "no se pudo descargar la lista")
        #expect(ModeloListas.motivo(nil) == "no se pudo descargar la lista")
    }

    @Test func lineaDeLaTarjeta() {
        let utc = SoporteSalud.utc
        #expect(ModeloListas.meta(lista(falloEn: nil), calendario: utc) == "HTML · 12 canales · 23 sept, 18:30")
        #expect(ModeloListas.meta(lista(), calendario: utc)
            == "HTML · 12 canales · el servidor limita las descargas (429) · se conserva la copia de 23 sept, 18:30")
        #expect(ModeloListas.meta(lista(sincronizada: nil, falloEn: nil)) == "HTML · 12 canales · sin sincronizar")
        #expect(ModeloListas.meta(lista(tipo: .m3u, cuenta: 1, falloEn: nil), calendario: utc) == "M3U · 1 canal · 23 sept, 18:30")
    }

    @Test func erroresDelCatalogoDemoYRespaldo() {
        func servidor(_ codigo: String, _ estado: Int) -> APIError {
            .servidor(codigo: codigo, estado: estado, mensaje: nil, requestId: nil)
        }
        #expect(ModeloListas.mensajeError(servidor("private_url", 400))
            == "Por seguridad, las direcciones de tu red local están bloqueadas. Usa una lista publicada en internet.")
        #expect(ModeloListas.mensajeError(servidor("source_limit", 409)) == "Ya tienes 8 directorios. Elimina uno antes de añadir otro.")
        #expect(ModeloListas.mensajeError(servidor("http_429", 502))
            == "Ese servidor limita las descargas (429). Vuelve a intentarlo en unos minutos.")
        #expect(ModeloListas.mensajeError(servidor("ipfs_bad_cid", 502))
            == "La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.")
        #expect(ModeloListas.mensajeError(servidor("demo_unsupported", 409)) == ModeloListas.mensajeDemo)
        #expect(ModeloListas.mensajeError(servidor("internal_error", 500)) == ModeloListas.errorGenerico)
        #expect(ModeloListas.mensajeError(nil) == ModeloListas.errorGenerico)
        #expect(ModeloListas.mensajeError(.red(.timedOut)) == "El servidor ha tardado demasiado en responder.")
    }

    @Test func pistaDeLaRedLocal() {
        for url in ["http://192.168.1.10/l.m3u", "http://umbrel.local/x", "http://10.0.0.2", "http://[::1]:8080/",
                    "http://nas/lista"] {
            #expect(ModeloListas.pareceLocal(url), "\(url)")
        }
        for url in ["https://example.com/lista.m3u", "https://ipfs.io/ipns/abc", "no es url"] {
            #expect(!ModeloListas.pareceLocal(url), "\(url)")
        }
        #expect(ModeloListas.esHttp("https://example.com/l.m3u"))
        #expect(!ModeloListas.esHttp("example.com/l.m3u"))
        #expect(!ModeloListas.esHttp("ftp://example.com/l.m3u"))
    }
}

struct ResumenGustosTests {
    private func gustos(_ l: Int, _ e: Int, _ n: Int) -> Preferences {
        Preferences(onboardingComplete: true, country: "Spain", leagues: Array(repeating: "x", count: l),
                    teams: Array(repeating: "y", count: e), nationalities: Array(repeating: "z", count: n))
    }

    @Test func fraseDeLaWeb() {
        #expect(ResumenGustos.frase(nil) == "Personaliza la agenda con tus ligas, equipos y nacionalidades.")
        #expect(ResumenGustos.frase(gustos(0, 0, 0)) == "Personaliza la agenda con tus ligas, equipos y nacionalidades.")
        #expect(ResumenGustos.frase(gustos(2, 1, 0)) == "Tu agenda prioriza 2 ligas y 1 equipo.")
        #expect(ResumenGustos.frase(gustos(2, 3, 1)) == "Tu agenda prioriza 2 ligas, 3 equipos y 1 nacionalidad.")
        #expect(ResumenGustos.frase(gustos(0, 0, 4)) == "Tu agenda prioriza 4 nacionalidades.")
    }
}
