import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Pantalla de emparejar este iPhone (M7; a2 §22-§23.3): cápsula y marco de cada estado de la cámara,
   errores del canje, código, host y direcciones del enlace. */

struct ReglasEmparejarTests {
    @Test func capsulaDeCadaEstado() {
        #expect(ReglasEmparejar.capsula(.preparando)?.texto == "Preparando la cámara…")
        #expect(ReglasEmparejar.capsula(.escaneando)?.texto == "Apunta al QR de la web: Ajustes › Dispositivos")
        #expect(ReglasEmparejar.capsula(.qrAjeno)?.tinta == .ambar)
        #expect(ReglasEmparejar.capsula(.emparejando(host: "umbrel.local"))?.texto == "Emparejando con umbrel.local…")
        #expect(ReglasEmparejar.capsula(.emparejando(host: "umbrel.local"))?.ruedita == true)
        #expect(ReglasEmparejar.capsula(.emparejado(host: "umbrel.local"))?.texto == "Emparejado con umbrel.local")
        #expect(ReglasEmparejar.capsula(.errorEmparejar)?.texto == "No se pudo emparejar")
        #expect(ReglasEmparejar.capsula(.pausa)?.icono == .clock)
        #expect(ReglasEmparejar.capsula(.ocupada)?.texto == "La cámara la está usando otra app")
        #expect(ReglasEmparejar.capsula(.sinPermiso) == nil)
    }

    /// Partida de capsulaDeCadaEstado: junta pasaba de los 400 ms de tipar (CI 36230463114).
    @Test func marcoDeCadaEstado() {
        #expect(ReglasEmparejar.marco(.qrAjeno) == .rojo)
        #expect(ReglasEmparejar.marco(.emparejado(host: "x")) == .verde)
        #expect(ReglasEmparejar.marco(.pausa) == .oroApagado)
        #expect(ReglasEmparejar.marco(.sinCamara) == .oculto)
        #expect(EstadoCamara.restringida.bloqueado)
        #expect(!EstadoCamara.escaneando.bloqueado)
    }

    @Test func bloqueSinCamara() {
        #expect(ReglasEmparejar.sinCamara(.sinPermiso)?.titulo == "Sin permiso para la cámara")
        #expect(ReglasEmparejar.sinCamara(.sinPermiso)?.abrirAjustes == true)
        #expect(ReglasEmparejar.sinCamara(.restringida)?.titulo == "La cámara está bloqueada")
        #expect(ReglasEmparejar.sinCamara(.sinCamara)?.texto == "Escribe el código y la dirección aquí debajo.")
        #expect(ReglasEmparejar.sinCamara(.escaneando) == nil)
    }

    @Test func erroresDelCanje() {
        let invalido = ReglasEmparejar.fallo(.servidor(codigo: "pairing_invalid", estado: 401, mensaje: nil, requestId: nil))
        #expect(invalido.texto == "El código no es correcto. Revísalo en la web y vuelve a intentarlo.")
        #expect(invalido.bordeCodigo && !invalido.vaciarCodigo && !invalido.pausa)
        let caducado = ReglasEmparejar.fallo(.servidor(codigo: "pairing_expired", estado: 410, mensaje: nil, requestId: nil))
        #expect(caducado.texto == "El código ha caducado o ya se ha usado. Pide uno nuevo en la web.")
        #expect(caducado.vaciarCodigo)
        let muchos = ReglasEmparejar.fallo(.servidor(codigo: "pairing_rate_limited", estado: 429, mensaje: nil, requestId: nil))
        #expect(muchos.texto == "Demasiados intentos. Espera un minuto y vuelve a probar.")
        #expect(muchos.pausa)
        #expect(ReglasEmparejar.fallo(.servidorInalcanzable).texto
            == "No se encuentra el servidor ni por Tailscale ni por la red local. Comprueba que Tailscale está conectado o que estás en casa.")
        #expect(ReglasEmparejar.fallo(.noEsAcePlayerNeo).texto
            == "Esa dirección responde, pero no es un Ace Player Neo. Revisa la dirección y el puerto (normalmente, el 7792).")
        #expect(ReglasEmparejar.fallo(.versionIncompatible(2)).texto
            == "El servidor usa la versión 2 de la API y esta app no la entiende. Actualiza la app o el servidor.")
    }

    @Test func codigoHostYEnlace() {
        #expect(ReglasEmparejar.filtrarCodigo("48 29-13x9") == "482913")
        #expect(ReglasEmparejar.filtrarCodigo("١٢٣456") == "456")
        #expect(ReglasEmparejar.esEnlace("  aceneo://pair?u=x&c=482913"))
        #expect(!ReglasEmparejar.esEnlace("482913"))
        #expect(ReglasEmparejar.host(URL(string: "http://umbrel.local:7792")!) == "umbrel.local")
        #expect(ReglasEmparejar.host(URL(string: "http://192.168.1.188:7792")!) == "192.168.1.188")
        let enlace = URL(string: "aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792&u=http%3A%2F%2Fumbrel.tu-red.ts.net%3A7792&c=482913")!
        let servidores = ReglasEmparejar.servidores(de: enlace)
        #expect(servidores.map(\.absoluteString) == ["http://umbrel.local:7792", "http://umbrel.tu-red.ts.net:7792"])
        let huecos = ReglasEmparejar.huecos(servidores)
        #expect(huecos.casa?.absoluteString == "http://umbrel.local:7792")
        #expect(huecos.tailscale?.absoluteString == "http://umbrel.tu-red.ts.net:7792")
    }

    @Test func direccionesDeLosCampos() {
        let bien = ReglasEmparejar.direcciones(casa: "umbrel.local:7792", tailscale: "")
        #expect(bien.config.lan?.absoluteString == "http://umbrel.local:7792")
        #expect(bien.config.tailscale == nil)
        #expect(bien.errores.isEmpty)
        let mal = ReglasEmparejar.direcciones(casa: "ftp://x", tailscale: "http://")
        #expect(mal.errores[.casa] == "La dirección no es válida. Ejemplo: http://umbrel.local:7792")
        #expect(mal.errores[.tailscale] == "La dirección no es válida. Ejemplo: http://umbrel.tu-red.ts.net:7792")
    }

    @Test func avisoDeAccesoPerdido() {
        #expect(ReglasEmparejar.avisoAcceso(.dispositivoRetirado)
            == "Se ha retirado el acceso de este dispositivo. Vuelve a emparejarlo desde la web.")
        #expect(ReglasEmparejar.avisoAcceso(.noAutorizado)
            == "Este dispositivo no está emparejado o su acceso ha caducado. Vuelve a emparejarlo.")
        #expect(ReglasEmparejar.avisoAcceso(.revocadoDesdeOtro)
            == "Este iPhone se ha revocado desde otro dispositivo. Para volver, emparéjalo otra vez desde la web.")
        #expect(ReglasEmparejar.avisoAcceso(.llaveroIlegible)
            == "El token guardado en el Llavero no se puede leer. Vuelve a emparejar la app.")
        #expect(ReglasEmparejar.avisoAcceso(.olvidadoAqui) == nil)
    }
}
