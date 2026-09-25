import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Varias direcciones en el QR (a7 §8.9.1, a9 §3.4), la etiqueta de casa, los textos del cliente (a7 §3.3)
   y las URL de escudos y logos (a7 §2.5). Los plazos por ruta están en Nucleo/RutasTests (API no es [L]). */

struct ServidoresTests {
    @Test func unQRConDosDireccionesLasLeeTodas() throws {
        let texto = "aceneo://pair?u=http%3A%2F%2F192.168.1.10%3A7792&u=http%3A%2F%2Fumbrel.tail1234.ts.net%3A7792&c=482913"
        let enlace = try #require(PairingLink(texto: texto))
        #expect(enlace.servidores.map(\.absoluteString)
            == ["http://192.168.1.10:7792", "http://umbrel.tail1234.ts.net:7792"])
        #expect(enlace.servidor.absoluteString == "http://192.168.1.10:7792")  // la primera, como la 0.8.0
        #expect(enlace.codigo == "482913")
    }

    @Test func lasRepetidasYLasQueNoValenSeQuitan() throws {
        let texto = "aceneo://pair?u=ftp%3A%2F%2Fmal&u=http%3A%2F%2Fumbrel.local%3A7792&u=http%3A%2F%2Fumbrel.local%3A7792%2F&c=000123"
        let enlace = try #require(PairingLink(texto: texto))
        #expect(enlace.servidores.map(\.absoluteString) == ["http://umbrel.local:7792"])
        #expect(PairingLink(texto: "aceneo://pair?u=ftp%3A%2F%2Fmal&c=000123") == nil)
    }

    @Test func seGuardaLaPrimeraDeCadaTipo() throws {
        let urls = try [
            "http://umbrel.tail1234.ts.net:7792", "http://192.168.1.10:7792", "http://100.64.0.7:7792",
            "http://umbrel.local:7792",
        ].map { try #require(URL(string: $0)) }
        let config = ServerConfig(servidores: urls)
        #expect(config.tailscale?.absoluteString == "http://umbrel.tail1234.ts.net:7792")
        #expect(config.lan?.absoluteString == "http://192.168.1.10:7792")
        #expect(ServerConfig(servidores: []).vacia)
    }

    @Test func laRedDeCasaSeLlamaAsi() {
        #expect(ServerVia.lan.etiqueta == "Red de casa")
        #expect(ServerVia.tailscale.etiqueta == "Tailscale")
    }
}

struct TextosClienteTests {
    /// `CLIENT_ERRORS` de apps/web/src/api/errors.ts (a7 §3.3).
    @Test func textosDelCliente() {
        #expect(APIError.red(.notConnectedToInternet).mensaje
            == "No hay conexión con el Umbrel. Comprueba la red; la app seguirá reintentando.")
        #expect(APIError.red(.cannotConnectToHost).mensaje == APIError.red(.notConnectedToInternet).mensaje)
        #expect(APIError.red(.timedOut).mensaje
            == "El servidor tarda demasiado en responder. Vuelve a intentarlo en un momento.")
        #expect(APIError.formato("x").mensaje == "El servidor ha respondido algo que no se entiende.")
        #expect(APIError.describirFallo(CancellationError()) == APIError.red(.timedOut).mensaje)
        #expect(APIError.describirFallo(CocoaError(.fileNoSuchFile))
            == "Algo ha fallado en el servidor. Queda anotado en el registro.")
    }

    /// El `message` del servidor va primero; sin él, el catálogo (orden de errors.ts).
    @Test func elMensajeDelServidorVaPrimero() {
        #expect(APIError.servidor(codigo: "remux_timeout", estado: 504, mensaje: "otro texto", requestId: nil).mensaje
            == "otro texto")
        #expect(APIError.servidor(codigo: "remux_timeout", estado: 504, mensaje: nil, requestId: nil).mensaje
            == ErrorCatalog.mensaje(para: "remux_timeout"))
        #expect(APIError.servidor(codigo: "http_503", estado: 502, mensaje: "", requestId: nil).mensaje
            == "El servidor respondió con un error 503.")
    }

    /// `retryable`: sin red, plazo, 5xx o 429; los 4xx no.
    @Test func reintentable() {
        #expect(APIError.red(.timedOut).reintentable)
        #expect(APIError.red(.notConnectedToInternet).reintentable)
        #expect(APIError.servidorInalcanzable.reintentable)
        #expect(APIError.servidor(codigo: "engine_unavailable", estado: 503, mensaje: nil, requestId: nil).reintentable)
        #expect(APIError.servidor(codigo: "http_429", estado: 429, mensaje: nil, requestId: nil).reintentable)
        #expect(!APIError.servidor(codigo: "not_found", estado: 404, mensaje: nil, requestId: nil).reintentable)
        #expect(!APIError.necesitaEmparejar(codigo: nil).reintentable)
        #expect(!APIError.formato("x").reintentable)
        #expect(!APIError.cancelado.reintentable)
    }
}

struct RutaImagenTests {
    @Test func escudoDeLaAgendaConAnfitrionSimbolico() throws {
        let url = try #require(RutaImagen.url("/api/v1/football/teams/86/crest?v=abc"))
        #expect(url.absoluteString == "aceneo-servidor://servidor/native/api/v1/football/teams/86/crest?v=abc")
        let base = try #require(URL(string: "http://umbrel.tail1234.ts.net:7792"))
        #expect(RutaImagen.resolver(url, base: base)?.absoluteString
            == "http://umbrel.tail1234.ts.net:7792/native/api/v1/football/teams/86/crest?v=abc")
    }

    @Test func casosRaros() throws {
        #expect(RutaImagen.url(nil) == nil)
        #expect(RutaImagen.url("") == nil)
        #expect(RutaImagen.url("sin-barra") == nil)
        #expect(RutaImagen.url("https://cdn.x/y.png")?.absoluteString == "https://cdn.x/y.png")
        #expect(RutaImagen.url("/native/api/v1/a")?.absoluteString == "aceneo-servidor://servidor/native/api/v1/a")
        let otra = try #require(URL(string: "https://cdn.x/y.png"))
        let base = try #require(URL(string: "http://umbrel.local:7792"))
        #expect(RutaImagen.resolver(otra, base: base) == otra)
    }
}
