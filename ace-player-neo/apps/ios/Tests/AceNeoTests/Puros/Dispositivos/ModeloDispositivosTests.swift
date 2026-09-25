import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Ajustes › Dispositivos (M7): los casos de devices/model.test.ts de la web, la máquina de emparejar otro
   aparato (usePairing.ts), «Este iPhone», la nota de direcciones de la app y el menú de la fila. */

private func dispositivo(
    _ id: String = "dev_aaaa", nombre: String = "iPhone", plataforma: DevicePlatform = .ios,
    creado: String = "2026-09-01T10:00:00.000Z", visto: String? = nil, revocado: String? = nil
) -> Device {
    Device(id: id, name: nombre, platform: plataforma, createdAt: creado, lastSeenAt: visto, revokedAt: revocado)
}

struct ModeloDispositivosTests {
    let ahora = SoporteSalud.ahora
    let utc = SoporteSalud.utc

    @Test func ultimaVezEnClaro() {
        #expect(ModeloDispositivos.ultimaVez(dispositivo(), ahora: ahora) == "Aún no se ha conectado")
        #expect(ModeloDispositivos.ultimaVez(dispositivo(visto: SoporteSalud.iso(haceMs: 60_000)), ahora: ahora)
            == "Conectado ahora mismo")
        #expect(ModeloDispositivos.ultimaVez(dispositivo(visto: SoporteSalud.iso(haceMs: 12 * 60_000)), ahora: ahora)
            == "Visto hace 12 min")
        #expect(ModeloDispositivos.ultimaVez(dispositivo(visto: SoporteSalud.iso(haceMs: 5 * 86_400_000)), ahora: ahora,
                                             calendario: utc) == "Visto el 18 sept, a las 18:30")
        #expect(ModeloDispositivos.ultimaVez(dispositivo(visto: SoporteSalud.iso(haceMs: 30 * 3_600_000)), ahora: ahora,
                                             calendario: utc) == "Visto ayer, a las 12:30")
        #expect(ModeloDispositivos.emparejado(dispositivo(), calendario: utc) == "Emparejado el 1 sept 2026")
        #expect(ModeloDispositivos.revocado(dispositivo(revocado: "2026-09-23T10:00:00.000Z"), calendario: utc)
            == "Revocado el 23 sept 2026")
        #expect(!ModeloDispositivos.conectado(dispositivo(), ahora: ahora))
        #expect(ModeloDispositivos.conectado(dispositivo(visto: SoporteSalud.iso(haceMs: 60_000)), ahora: ahora))
        #expect(!ModeloDispositivos.conectado(dispositivo(visto: SoporteSalud.iso(haceMs: 3 * 60_000)), ahora: ahora))
    }

    @Test func activosPorUltimaConexionYRevocadosAparte() {
        let partes = ModeloDispositivos.partir([
            dispositivo("dev_viejo", visto: "2026-09-20T10:00:00.000Z"),
            dispositivo("dev_nuevo", visto: "2026-09-23T10:00:00.000Z"),
            dispositivo("dev_nunca", creado: "2026-09-22T10:00:00.000Z"),
            dispositivo("dev_fuera", revocado: "2026-09-21T10:00:00.000Z"),
        ])
        #expect(partes.activos.map(\.id) == ["dev_nuevo", "dev_nunca", "dev_viejo"])
        #expect(partes.revocados.map(\.id) == ["dev_fuera"])
    }

    @Test func esteIPhoneSiempreElPrimero() {
        let lista = [dispositivo("dev_otro"), dispositivo("dev_mio")]
        #expect(ModeloDispositivos.conEsteIPhone(lista, esteId: "dev_mio", delArranque: nil).map(\.id) == ["dev_mio", "dev_otro"])
        let arranque = dispositivo("dev_nuevo")
        #expect(ModeloDispositivos.conEsteIPhone(lista, esteId: "dev_nuevo", delArranque: arranque).map(\.id)
            == ["dev_nuevo", "dev_otro", "dev_mio"])
        #expect(ModeloDispositivos.conEsteIPhone(lista, esteId: nil, delArranque: nil).map(\.id) == ["dev_otro", "dev_mio"])
        #expect(ModeloDispositivos.capsulaEste(dispositivo(plataforma: .ipados)) == "Este iPad")
        #expect(ModeloDispositivos.capsulaEste(dispositivo()) == "Este iPhone")
    }

    @Test func codigoEnDosGruposCifraACifraYCuentaAtras() {
        #expect(ModeloDispositivos.agrupar("482913") == "482 913")
        #expect(ModeloDispositivos.deletrear("482913") == "4 8 2 9 1 3")
        #expect(ModeloDispositivos.cuentaAtras(300_000) == "5:00")
        #expect(ModeloDispositivos.cuentaAtras(299_001) == "5:00")
        #expect(ModeloDispositivos.cuentaAtras(59_000) == "0:59")
        #expect(ModeloDispositivos.cuentaAtras(-5) == "0:00")
    }

    @Test func plataformasEIconos() {
        #expect([DevicePlatform.ios, .ipados, .macos, .other].map(ModeloDispositivos.plataforma)
            == ["iPhone", "iPad", "Mac", "Otro dispositivo"])
        #expect([DevicePlatform.ios, .ipados, .macos, .other].map(ModeloDispositivos.icono) == [.movil, .movil, .pantalla, .link])
    }
}

struct NotaDireccionesTests {
    private let casa = URL(string: "http://umbrel.local:7792")
    private let tailscale = URL(string: "http://umbrel.tu-red.ts.net:7792")

    @Test func lasCuatroVariantes() {
        let ambas = NotaDirecciones.de(ServerConfig(tailscale: tailscale, lan: casa))
        #expect(ambas?.tipo == .ambas)
        #expect(ambas?.icono == .check)
        #expect(ambas?.texto == "El QR lleva las dos direcciones de tu Umbrel, http://umbrel.local:7792 y http://umbrel.tu-red.ts.net:7792: el otro iPhone podrá conectarse en casa y fuera, con Tailscale activo.")
        #expect(ambas?.trozos.filter(\.fuerte).map(\.texto) == ["http://umbrel.local:7792", "http://umbrel.tu-red.ts.net:7792"])
        let soloTailscale = NotaDirecciones.de(ServerConfig(tailscale: tailscale))
        #expect(soloTailscale?.texto == "El QR lleva la dirección de Tailscale, http://umbrel.tu-red.ts.net:7792: el otro iPhone podrá conectarse en casa y fuera, con Tailscale activo.")
        let soloCasa = NotaDirecciones.de(ServerConfig(lan: casa))
        #expect(soloCasa?.icono == .info)
        #expect(soloCasa?.texto == "El QR lleva la dirección de tu red de casa, http://umbrel.local:7792: fuera de ella no llegará. Para usarlo también fuera, crea el código desde la web abierta por Tailscale.")
        let bucle = NotaDirecciones.de(ServerConfig(lan: URL(string: "http://127.0.0.1:7792")))
        #expect(bucle?.aviso == true)
        #expect(bucle?.texto == "La dirección http://127.0.0.1:7792 solo existe en este aparato: otro iPhone no llegará. Crea el código desde la web del Umbrel (por ejemplo, http://umbrel.local:7792).")
        #expect(NotaDirecciones.de(ServerConfig()) == nil)
        #expect(NotaDirecciones.esBucle(URL(string: "http://[::1]:4196")!))
        #expect(NotaDirecciones.esBucle(URL(string: "http://localhost:7792")!))
        #expect(!NotaDirecciones.esBucle(URL(string: "http://192.168.1.188:7792")!))
    }

    @Test func cuerpoDelCodigoConLaActivaPrimero() {
        let config = ServerConfig(tailscale: tailscale, lan: casa)
        let cuerpo = CuerpoCodigo.de(activa: tailscale, config: config)
        #expect(cuerpo.baseUrl == "http://umbrel.tu-red.ts.net:7792")
        #expect(cuerpo.alternateBaseUrls == ["http://umbrel.local:7792"])
        let solo = CuerpoCodigo.de(activa: casa, config: ServerConfig(lan: casa))
        #expect(solo.baseUrl == "http://umbrel.local:7792")
        #expect(solo.alternateBaseUrls == nil)
        #expect(CuerpoCodigo.de(activa: nil, config: config).baseUrl == "http://umbrel.local:7792")
    }
}

struct MaquinaEmparejarOtroTests {
    private let ahora = SoporteSalud.ahora

    private func respuesta() throws -> PairingCreateResponse {
        try JSONDecoder().decode(PairingCreateResponse.self, from: Fixtures.datos("v1/pairingCreate.json"))
    }

    @Test func reposoCreandoCodigoYCaducado() throws {
        var m = MaquinaEmparejarOtro()
        #expect(m.fase == .reposo)
        m.empezar()
        #expect(m.fase == .creando)
        m.creado(try respuesta(), ahora: ahora, conocidos: ["dev_a"])
        #expect(m.hayCodigo)
        #expect(ModeloDispositivos.cuentaAtras(m.restante(ahora: ahora.addingTimeInterval(2))) == "4:58")
        #expect(abs(m.fraccion(ahora: ahora.addingTimeInterval(150)) - 0.5) < 0.0001)
        #expect(m.anuncio(nombre: nil) == "Código listo. Caduca en 5 minutos.")
        m.tic(ahora: ahora.addingTimeInterval(299))
        #expect(m.hayCodigo)
        m.tic(ahora: ahora.addingTimeInterval(300))
        #expect(m.fase == .caducado)
        #expect(m.anuncio(nombre: nil) == "El código ha caducado.")
    }

    @Test func emparejadoPorLaListaYPorElSSE() throws {
        var m = MaquinaEmparejarOtro()
        m.creado(try respuesta(), ahora: ahora, conocidos: nil)
        m.lista(["dev_a", "dev_b"])  // la primera lista es la referencia
        #expect(m.hayCodigo)
        m.lista(["dev_a", "dev_b", "dev_c"])
        #expect(m.fase == .emparejado(dispositivo: "dev_c"))
        #expect(m.anuncio(nombre: "iPad de Ana") == "«iPad de Ana» ya está emparejado.")
        #expect(m.anuncio(nombre: nil) == "Dispositivo emparejado.")

        var s = MaquinaEmparejarOtro()
        s.creado(try respuesta(), ahora: ahora, conocidos: ["dev_a"])
        s.evento(DevicesChangedData(reason: .revoked, deviceId: "dev_z"))
        #expect(s.hayCodigo)
        s.evento(DevicesChangedData(reason: .paired, deviceId: "dev_a"))
        #expect(s.hayCodigo)
        s.evento(DevicesChangedData(reason: .paired, deviceId: "dev_z"))
        #expect(s.fase == .emparejado(dispositivo: "dev_z"))
    }

    @Test func falloYCancelar() {
        var m = MaquinaEmparejarOtro()
        m.empezar()
        m.fallar("El servidor ha tardado demasiado en responder.")
        #expect(m.fase == .fallo("El servidor ha tardado demasiado en responder."))
        m.cancelar()
        #expect(m.fase == .reposo)
        #expect(m.restante(ahora: ahora) == 0)
    }
}

struct OpcionesDispositivoTests {
    @Test func menuYBotones() {
        #expect(OpcionesDispositivo.revocar(armado: false).map(\.titulo) == ["Revocar el acceso"])
        #expect(OpcionesDispositivo.revocar(armado: true).map(\.titulo) == ["Revocar ya"])
        #expect(OpcionesDispositivo.olvidar(armado: false).map(\.titulo) == ["Olvidar este iPhone"])
        #expect(OpcionesDispositivo.olvidar(armado: true).first?.peligro == true)
        #expect(OpcionesDispositivo.botonOlvidar(armado: true) == "¿Olvidar? Pulsa otra vez")
        #expect(OpcionesDispositivo.etiquetaRevocar("iPad", armado: true) == "¿Revocar? Pulsa otra vez para revocar iPad")
        #expect(OpcionesDispositivo.revocadoBien("iPad") == "«iPad» ya no puede entrar. Si lo quieres de vuelta, emparéjalo otra vez.")
    }
}
