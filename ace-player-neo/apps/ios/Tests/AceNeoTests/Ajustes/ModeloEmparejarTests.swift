import Foundation
import Testing

@testable import AceNeo

/* La pantalla de emparejar (M7; a2 §22): estados de la cámara, QR ajeno, canje automático al leer un QR o pegar el
   enlace, errores con su efecto y la pausa de 60 s (del servidor o tras 5 fallos seguidos). Sin red ni cámara:
   el canje y la háptica son dobles; los plazos, cortos. */

@MainActor
enum SoporteAjustes {
    static let enlace = "aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792&c=482913"
    static let enlaceDoble =
        "aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792&u=http%3A%2F%2Fumbrel.tu-red.ts.net%3A7792&c=482913"
    static let plazos = ModeloEmparejar.Plazos(
        pausa: .milliseconds(150), vueltaCapsula: .milliseconds(150), ignorarTrasAjeno: .milliseconds(80),
        marcoRojo: .milliseconds(20))

    static func respuesta() throws -> PairingClaimResponse {
        try JSONDecoder().decode(PairingClaimResponse.self, from: Fixtures.datos("v1/pairingClaim.json"))
    }

    /// Espera a que se cumpla la condición (los modelos trabajan con tareas).
    static func esperar(_ condicion: () -> Bool, plazo: Duration = .seconds(3)) async -> Bool {
        let limite = ContinuousClock.now + plazo
        while ContinuousClock.now < limite {
            if condicion() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condicion()
    }
}

/// Lo que hizo el modelo con sus servicios.
@MainActor final class RegistroEmparejar {
    var canjes: [(ServerConfig, String)] = []
    var vibraciones: [TipoHaptico] = []
    var anuncios: [String] = []
    var emparejados: [String] = []
    var fallo: APIError?

    func servicios() -> ModeloEmparejar.Servicios {
        var s = ModeloEmparejar.Servicios(canjear: { [unowned self] (config: ServerConfig, codigo: String) in
            self.canjes.append((config, codigo))
            if let fallo = self.fallo { throw fallo }
            return try SoporteAjustes.respuesta()
        })
        s.vibrar = { [unowned self] (tipo: TipoHaptico) in self.vibraciones.append(tipo) }
        s.anunciar = { [unowned self] (texto: String) in self.anuncios.append(texto) }
        s.alEmparejar = { [unowned self] (_: PairingClaimResponse, _: [URL], host: String) in self.emparejados.append(host) }
        return s
    }
}

@MainActor
struct ModeloEmparejarTests {
    private func modelo(_ registro: RegistroEmparejar, guardadas: ServerConfig = ServerConfig()) -> ModeloEmparejar {
        ModeloEmparejar(servicios: registro.servicios(), guardadas: guardadas, plazos: SoporteAjustes.plazos)
    }

    @Test func estadosDeLaCamara() {
        let m = modelo(RegistroEmparejar())
        #expect(m.estadoCamara == .preparando)
        m.cambioCaptura(.activa)
        #expect(m.estadoCamara == .escaneando)
        m.cambioCaptura(.ocupada)
        #expect(m.estadoCamara == .ocupada)
        m.cambioCaptura(.sinPermiso)
        #expect(m.estadoCamara == .sinPermiso)
        #expect(m.estadoCamara.bloqueado)
        m.cambioCaptura(.restringida)
        #expect(m.estadoCamara == .restringida)
        m.cambioCaptura(.sinCamara)
        #expect(m.estadoCamara == .sinCamara)
    }

    @Test func unQRAjenoAvisaYVuelveAEscanear() async {
        let registro = RegistroEmparejar()
        let m = modelo(registro)
        m.cambioCaptura(.activa)
        #expect(m.leido("https://example.com") == false)
        #expect(m.estadoCamara == .qrAjeno)
        #expect(registro.vibraciones == [.error])
        #expect(registro.anuncios == [ReglasEmparejar.qrAjenoLargo])
        #expect(m.leido("otro texto") == false, "se ignoran lecturas un rato")
        #expect(registro.vibraciones.count == 1)
        #expect(await SoporteAjustes.esperar { m.estadoCamara == .escaneando })
        #expect(registro.canjes.isEmpty)
    }

    @Test func alLeerUnEnlaceSeEmparejaSolo() async throws {
        let registro = RegistroEmparejar()
        let m = modelo(registro)
        m.cambioCaptura(.activa)
        #expect(m.leido(SoporteAjustes.enlace))
        #expect(m.direccionCasa == "http://umbrel.local:7792")
        #expect(m.codigo == "482913")
        #expect(await SoporteAjustes.esperar { !registro.emparejados.isEmpty })
        #expect(registro.canjes.first?.0.lan?.absoluteString == "http://umbrel.local:7792")
        #expect(registro.canjes.first?.1 == "482913")
        #expect(registro.emparejados == ["umbrel.local"])
        #expect(m.estadoCamara == .emparejado(host: "umbrel.local"))
        #expect(m.hecho)
        #expect(registro.vibraciones == [.ligera, .exito])
        #expect(!m.camaraLeyendo)
    }

    @Test func pegarElEnlaceEnElCodigoEmpareja() async {
        let registro = RegistroEmparejar()
        let m = modelo(registro)
        m.codigo = SoporteAjustes.enlace
        #expect(await SoporteAjustes.esperar { registro.emparejados == ["umbrel.local"] })
    }

    @Test func elCodigoSoloAdmiteSeisCifras() {
        let m = modelo(RegistroEmparejar())
        m.codigo = "48 29-13 77"
        #expect(m.codigo == "482913")
    }

    @Test func codigoIncorrectoPoneLaFilaYElBorde() async {
        let registro = RegistroEmparejar()
        registro.fallo = .servidor(codigo: "pairing_invalid", estado: 401, mensaje: nil, requestId: nil)
        let m = modelo(registro, guardadas: ServerConfig(lan: URL(string: "http://umbrel.local:7792")))
        m.codigo = "111111"
        #expect(m.puedeEnviar)
        #expect(await m.emparejar() == false)
        #expect(m.fila == "El código no es correcto. Revísalo en la web y vuelve a intentarlo.")
        #expect(m.bordeCodigo)
        #expect(m.estadoCamara == .errorEmparejar)
        #expect(registro.vibraciones == [.error])
        #expect(m.peticionFila == 1)
        m.tocarCampo()
        #expect(m.fila == nil)
    }

    @Test func codigoCaducadoLoVacia() async {
        let registro = RegistroEmparejar()
        registro.fallo = .servidor(codigo: "pairing_expired", estado: 410, mensaje: nil, requestId: nil)
        let m = modelo(registro, guardadas: ServerConfig(lan: URL(string: "http://umbrel.local:7792")))
        m.codigo = "111111"
        await m.emparejar()
        #expect(m.codigo.isEmpty)
        #expect(m.fila == "El código ha caducado o ya se ha usado. Pide uno nuevo en la web.")
    }

    @Test func demasiadosIntentosPausaYSeReanuda() async {
        let registro = RegistroEmparejar()
        registro.fallo = .servidor(codigo: "pairing_rate_limited", estado: 429, mensaje: nil, requestId: nil)
        let m = modelo(registro, guardadas: ServerConfig(lan: URL(string: "http://umbrel.local:7792")))
        m.cambioCaptura(.activa)
        m.codigo = "111111"
        await m.emparejar()
        #expect(m.enPausa)
        #expect(m.estadoCamara == .pausa)
        #expect(!m.puedeEnviar)
        #expect(!m.camaraLeyendo)
        #expect(await m.emparejar() == false, "en pausa no se canjea")
        #expect(registro.canjes.count == 1)
        #expect(await SoporteAjustes.esperar { !m.enPausa })
        #expect(m.estadoCamara == .escaneando)
    }

    @Test func cincoFallosSeguidosPonenLaPausa() async {
        let registro = RegistroEmparejar()
        registro.fallo = .servidor(codigo: "pairing_invalid", estado: 401, mensaje: nil, requestId: nil)
        let m = modelo(registro, guardadas: ServerConfig(lan: URL(string: "http://umbrel.local:7792")))
        for _ in 0..<4 {
            m.codigo = "111111"
            await m.emparejar()
            #expect(!m.enPausa)
        }
        m.codigo = "111111"
        await m.emparejar()
        #expect(m.enPausa)
        #expect(registro.canjes.count == 5)
    }

    @Test func unaDireccionMalEscritaVaASuCampo() async {
        let registro = RegistroEmparejar()
        let m = modelo(registro)
        m.direccionTailscale = "ftp://x"
        m.codigo = "482913"
        #expect(await m.emparejar() == false)
        #expect(m.erroresCampo[.tailscale] == "La dirección no es válida. Ejemplo: http://umbrel.tu-red.ts.net:7792")
        #expect(registro.canjes.isEmpty)
        m.direccionTailscale = "umbrel.tu-red.ts.net:7792"
        #expect(m.erroresCampo[.tailscale] == nil)
    }

    @Test func unEnlaceDeFueraConVariasDireccionesRellenaLasDos() throws {
        let m = modelo(RegistroEmparejar())
        let url = try #require(URL(string: SoporteAjustes.enlaceDoble))
        let enlace = try #require(PairingLink(url: url))
        m.aplicar(enlace)
        #expect(m.direccionCasa == "http://umbrel.local:7792")
        #expect(m.direccionTailscale == "http://umbrel.tu-red.ts.net:7792")
        #expect(m.codigo == "482913")
    }

    @Test func alLeerLaCamaraSeParaEnElMismoTurno() {
        let m = modelo(RegistroEmparejar())
        m.cambioCaptura(.activa)
        #expect(m.camaraLeyendo)
        #expect(m.leido(SoporteAjustes.enlace))
        #expect(!m.camaraLeyendo, "la imagen queda congelada antes de que empiece el canje (a2 §22.3.1)")
    }

    @Test func trasUnFalloDeRedSePuedeReleerElMismoQR() async {
        let registro = RegistroEmparejar()
        registro.fallo = .sinServidor
        let m = modelo(registro)
        m.cambioCaptura(.activa)
        #expect(m.leido(SoporteAjustes.enlace))
        #expect(await SoporteAjustes.esperar { m.fila != nil })
        #expect(m.vecesReleer == 0)
        #expect(await SoporteAjustes.esperar { m.vecesReleer == 1 })
        #expect(m.estadoCamara == .escaneando)
        #expect(m.leido(SoporteAjustes.enlace))
        #expect(await SoporteAjustes.esperar { registro.canjes.count == 2 })
    }

    @Test func conUnCodigoMaloNoSeRelee() async {
        let registro = RegistroEmparejar()
        registro.fallo = .servidor(codigo: "pairing_invalid", estado: 401, mensaje: nil, requestId: nil)
        let m = modelo(registro)
        m.cambioCaptura(.activa)
        #expect(m.leido(SoporteAjustes.enlace))
        #expect(await SoporteAjustes.esperar { m.estadoCamara == .escaneando && m.fila != nil })
        try? await Task.sleep(for: .milliseconds(50))
        #expect(m.vecesReleer == 0)
    }

    @Test func lasDireccionesGuardadasSalenEscritas() {
        let m = modelo(RegistroEmparejar(), guardadas: ServerConfig(tailscale: URL(string: "http://umbrel.tu-red.ts.net:7792"),
                                                                     lan: URL(string: "http://umbrel.local:7792")))
        #expect(m.direccionCasa == "http://umbrel.local:7792")
        #expect(m.direccionTailscale == "http://umbrel.tu-red.ts.net:7792")
        #expect(!m.puedeEnviar)
        m.codigo = "482913"
        #expect(m.puedeEnviar)
    }
}
