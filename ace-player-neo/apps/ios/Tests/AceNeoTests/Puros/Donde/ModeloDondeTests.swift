import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* «Dónde se está reproduciendo» (M7): los casos de where-playing/model.test.ts de la web. */

private let momento = "2026-09-23T18:30:00.000Z"

private func visor(
    _ id: String = "v_pc", dispositivo: String? = "web_pc", nombre: String? = "Chrome · Windows",
    plataforma: ClientKind = .web, reproduciendo: Bool? = true
) -> SessionSummary.Viewer {
    SessionSummary.Viewer(client: plataforma, deviceId: dispositivo, lastBeatAt: momento, viewerId: id,
                          deviceName: nombre, platform: plataforma, playing: reproduciendo)
}

private func sesion(
    _ id: String = "s_uno", abierta: String = momento, visores: [SessionSummary.Viewer] = [visor()],
    titulo: String? = "DAZN 1", protocolo: StreamProtocol? = .mpegts
) -> SessionSummary {
    SessionSummary(id: id, hash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", mode: .progressive, openedAt: abierta,
                   viewers: visores, title: titulo, protocolo: protocolo)
}

struct ModeloDondeTests {
    @Test(arguments: [
        (ClientKind.web, "Chrome · Windows", TipoAparato.ordenador),
        (ClientKind.web, "Safari · Mac", TipoAparato.ordenador),
        (ClientKind.web, "Safari · iPhone", TipoAparato.movil),
        (ClientKind.web, "Chrome · Android", TipoAparato.movil),
        (ClientKind.web, "Navegador · Smart TV", TipoAparato.tele),
        (ClientKind.web, "Navegador", TipoAparato.ordenador),
        (ClientKind.ios, "iPhone de Isma", TipoAparato.movil),
        (ClientKind.ios, "MacBook de Isma", TipoAparato.ordenador),
        (ClientKind.legacy, "App antigua (0.6)", TipoAparato.movil),
    ])
    func tipoDeAparato(_ plataforma: ClientKind, _ nombre: String, _ esperado: TipoAparato) {
        #expect(ModeloDonde.tipo(visor(nombre: nombre, plataforma: plataforma)) == esperado)
    }

    @Test func estadoTituloYCuenta() {
        #expect(ModeloDonde.estado(visor(reproduciendo: true)) == .reproduciendo)
        #expect(ModeloDonde.estado(visor(reproduciendo: false)) == .pausa)
        #expect(ModeloDonde.estado(visor(reproduciendo: nil)) == .conectado)
        #expect(EstadoVisor.pausa.texto == "En pausa")
        #expect(ModeloDonde.titulo(sesion(titulo: "DAZN 1")) == "DAZN 1")
        #expect(ModeloDonde.titulo(sesion(titulo: "  ")) == "Canal a1b2c3d4")
        #expect(ModeloDonde.cuenta(1) == "1 dispositivo")
        #expect(ModeloDonde.cuenta(3) == "3 dispositivos")
        #expect(ModeloDonde.desde(sesion(abierta: "ayer")) == "")
        #expect(ModeloDonde.meta(sesion(protocolo: .hls), calendario: SoporteSalud.utc)
            == "1 dispositivo · HLS compartido · desde las 18:30")
        #expect(ModeloDonde.metaVisor(visor(nombre: "iPhone de Isma", plataforma: .ios)) == "Móvil · App Ace Neo")
    }

    @Test func resumenParaLectores() {
        #expect(ModeloDonde.resumen([]) == "No se está reproduciendo nada.")
        #expect(ModeloDonde.resumen([sesion()]) == "«DAZN 1» en 1 dispositivo.")
    }

    @Test func quitaLasVaciasYPoneEsteAparatoPrimero() {
        let lista = ModeloDonde.visibles([
            sesion("s_vacia", visores: []),
            sesion("s_otra", abierta: "2026-09-23T19:00:00.000Z"),
            sesion("s_mia", visores: [visor("v_ios", dispositivo: "dev_x", plataforma: .ios),
                                      visor("v_mio", dispositivo: "dev_mio", plataforma: .ios)]),
        ], dispositivo: "dev_mio")
        #expect(lista.map(\.id) == ["s_mia", "s_otra"])
        #expect(lista.first?.viewers.map(\.viewerId) == ["v_mio", "v_ios"])
        #expect(ModeloDonde.visibles([], dispositivo: "dev_mio").isEmpty)
    }

    @Test func conElEjemploDeAceShared() throws {
        let estado = try JSONDecoder().decode(PlaybackStatus.self, from: Fixtures.datos("v1/playbackStatus.json"))
        let lista = ModeloDonde.visibles(estado.sessions, dispositivo: "dev_iphone01")
        #expect(lista.first?.viewers.first?.deviceName == "iPhone de Isma")
        #expect(DondeSuena.esEste(try #require(lista.first?.viewers.first), dispositivo: "dev_iphone01", visorLocal: nil))
    }
}
