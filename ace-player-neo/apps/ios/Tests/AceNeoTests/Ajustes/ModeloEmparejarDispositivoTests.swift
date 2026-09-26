import Foundation
import Testing

@testable import AceNeo

/* Emparejar otro aparato desde Ajustes › Dispositivos (M7; a6 §8.1, §8.10.7; usePairing.ts): reposo → código →
   emparejado / caducado / error, con la lista, el SSE `devices.changed` y el aviso una sola vez por aparato; el
   403 de un servidor 0.8.0. El reloj y la petición son dobles. */

@MainActor final class RegistroCodigos {
    var ahora = TiemposSalud.leer("2026-09-23T18:30:00.000Z") ?? Date(timeIntervalSince1970: 0)
    var fallo: APIError?
    var creados = 0
    var cerrados: [APIError] = []
    var emparejados: [String] = []

    func servicios() -> ModeloEmparejarDispositivo.Servicios {
        var s = ModeloEmparejarDispositivo.Servicios(
            crear: { [unowned self] in
                self.creados += 1
                if let fallo = self.fallo { throw fallo }
                return try JSONDecoder().decode(PairingCreateResponse.self, from: Fixtures.datos("v1/pairingCreate.json"))
            },
            ahora: { [unowned self] in self.ahora })
        s.cerrado = { [unowned self] (fallo: APIError) in self.cerrados.append(fallo) }
        s.emparejado = { [unowned self] (nombre: String) in self.emparejados.append(nombre) }
        return s
    }
}

private func dispositivo(_ id: String, _ nombre: String) -> Device {
    Device(id: id, name: nombre, platform: .ios, createdAt: "2026-09-01T10:00:00.000Z", lastSeenAt: nil, revokedAt: nil)
}

@MainActor
struct ModeloEmparejarDispositivoTests {
    @Test func codigoYCuentaAtrasHastaCaducar() async {
        let registro = RegistroCodigos()
        let m = ModeloEmparejarDispositivo(servicios: registro.servicios())
        #expect(m.fase == .reposo)
        m.crear()
        #expect(m.fase == .creando)
        #expect(await SoporteAjustes.esperar { m.hayCodigo })
        #expect(ModeloDispositivos.cuentaAtras(m.restante) == "5:00")
        registro.ahora = registro.ahora.addingTimeInterval(2)
        m.tic()
        #expect(ModeloDispositivos.cuentaAtras(m.restante) == "4:58")
        registro.ahora = registro.ahora.addingTimeInterval(298)
        m.tic()
        #expect(m.fase == .caducado)
    }

    @Test func emparejadoPorLaListaConAvisoUnaVez() async {
        let registro = RegistroCodigos()
        let m = ModeloEmparejarDispositivo(servicios: registro.servicios())
        let antes = [dispositivo("dev_a", "iPhone de Isma")]
        m.lista(antes, nombres: { _ in nil })
        m.crear()
        #expect(await SoporteAjustes.esperar { m.hayCodigo })
        let despues = antes + [dispositivo("dev_b", "iPad de Ana")]
        let nombres: (String) -> String? = { (id: String) in despues.first { $0.id == id }?.name }
        m.lista(despues, nombres: nombres)
        #expect(m.fase == .emparejado(dispositivo: "dev_b"))
        #expect(registro.emparejados == ["iPad de Ana"])
        #expect(m.nombreEmparejado(nombres) == "iPad de Ana")
        m.lista(despues, nombres: nombres)
        #expect(registro.emparejados.count == 1, "una vez por aparato")
    }

    @Test func emparejadoPorElSSEEsperaAlNombre() async {
        let registro = RegistroCodigos()
        let m = ModeloEmparejarDispositivo(servicios: registro.servicios())
        m.lista([dispositivo("dev_a", "iPhone de Isma")], nombres: { _ in nil })
        m.crear()
        #expect(await SoporteAjustes.esperar { m.hayCodigo })
        m.evento(DevicesChangedData(reason: .paired, deviceId: "dev_c"), nombres: { _ in nil })
        #expect(m.fase == .emparejado(dispositivo: "dev_c"))
        #expect(registro.emparejados.isEmpty, "sin nombre todavía no hay aviso")
        m.lista([dispositivo("dev_a", "iPhone de Isma"), dispositivo("dev_c", "iPhone de Leo")],
                nombres: { (id: String) in id == "dev_c" ? "iPhone de Leo" : nil })
        #expect(registro.emparejados == ["iPhone de Leo"])
    }

    @Test func servidorViejoCierraLaSeccion() async {
        let registro = RegistroCodigos()
        registro.fallo = .servidor(codigo: "origin_forbidden", estado: 403, mensaje: nil, requestId: nil)
        let m = ModeloEmparejarDispositivo(servicios: registro.servicios())
        m.crear()
        #expect(await SoporteAjustes.esperar { m.fase == .fallo(AvisoVersion.base) })
        #expect(registro.cerrados.first?.codigo == "origin_forbidden")
    }

    @Test func otroFalloEnseñaElMotivoYSeCancela() async {
        let registro = RegistroCodigos()
        registro.fallo = .red(.timedOut)
        let m = ModeloEmparejarDispositivo(servicios: registro.servicios())
        m.crear()
        #expect(await SoporteAjustes.esperar { m.fase == .fallo("El servidor tarda demasiado en responder. Vuelve a intentarlo en un momento.") })
        #expect(registro.cerrados.isEmpty)
        m.cancelar()
        #expect(m.fase == .reposo)
    }
}

/// El QR dibujado en el iPhone (a6 §8.10.5): módulos de `qrcode` (versión 4 → 37, versión 6 → 45) con 2 de margen.
struct QRPalcoTests {
    @Test func unaDireccionSonTreintaYSieteModulos() {
        let qr = QRPalco(enlace: "aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792&c=482913")
        #expect(qr.lado == 37)
        #expect(qr.matriz.first?.contains(true) == false, "margen blanco arriba")
        #expect(qr.matriz[1].contains(true) == false)
        #expect(qr.matriz[2][2], "esquina del patrón de posición")
        #expect(qr.matriz.allSatisfy { $0.count == 37 })
    }

    @Test func dosDireccionesSonCuarentaYCincoModulos() {
        let enlace = "aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792&u=http%3A%2F%2Fumbrel.tu-red.ts.net%3A7792&c=482913"
        #expect(QRPalco(enlace: enlace).lado == 45)
    }

    @Test func recorteYMargen() {
        let m: [[Bool]] = [[false, false, false], [false, true, false], [false, false, false]]
        #expect(QRPalco.recortar(m) == [[true]])
        #expect(QRPalco.conMargen([[true]], margen: 2).count == 5)
        #expect(QRPalco.conMargen([[true]], margen: 2)[2][2])
    }
}
