import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Navegación pura (Core/Reglas/Navegacion/Destino.swift): pestañas, `?vista=` de ida y vuelta con las
   reglas de routes.ts › parseVista, profundidad y sentido (a2 §2.1-§2.2). Escrito en la fase 0.3a (I0);
   M4 lo amplía. */

private let hashCanal = "b71e44d0a9c3f2e18d7b6a5c4e3f2a1b0c9f2a31"

private let destinosFijos: [Destino] = [
    .agenda, .canales(nil), .buscar(q: nil), .buscar(q: "dazn"), .buscar(q: "liga/segunda"), .ajustes(nil),
    .partido(id: "demo-1"), .partido(id: "401:abc~x.y_z"), .canal(hash: hashCanal), .sistema,
]
private let destinosCanales: [Destino] = PestanaCanales.allCases.map { Destino.canales($0) }
private let destinosAjustes: [Destino] = SeccionAjustes.allCases.map { Destino.ajustes($0) }
private let destinos: [Destino] = destinosFijos + destinosCanales + destinosAjustes

/// Entradas de `?vista=` y lo que sale (nil = la web caería en la agenda por no entenderla).
private let lecturas: [(String, Destino?)] = [
    ("", .agenda),
    ("  /agenda/ ", .agenda),
    ("AGENDA", .agenda),
    ("biblioteca", .canales(nil)),
    ("biblioteca/otra", .canales(nil)),
    ("Ajustes/dispositivos", .ajustes(.dispositivos)),
    ("ajustes/servidor", .ajustes(nil)),
    ("buscar/", .buscar(q: nil)),
    ("partido/canal/" + hashCanal.uppercased(), .canal(hash: hashCanal)),
    ("partido/canal/xyz", nil),
    ("partido/canal", nil),
    ("partido", nil),
    ("partido/", nil),
    ("partido/a b", nil),
    ("partido/" + String(repeating: "a", count: 121), nil),
    ("partido/" + String(repeating: "a", count: 120), .partido(id: String(repeating: "a", count: 120))),
    ("sistema", .sistema),
    ("nada", nil),
]

struct DestinoTests {
    @Test(arguments: destinos)
    func vistaDeIdaYVuelta(_ destino: Destino) {
        #expect(Destino(vista: destino.vista) == destino)
    }

    @Test(arguments: lecturas)
    func leeComoParseVista(_ vista: String, _ esperado: Destino?) {
        #expect(Destino(vista: vista) == esperado)
    }

    @Test func vistasComoLaWeb() {
        #expect(Destino.canales(nil).vista == "biblioteca")
        #expect(Destino.canales(.recientes).vista == "biblioteca/recientes")
        #expect(Destino.ajustes(.acerca).vista == "ajustes/acerca")
        #expect(Destino.canal(hash: hashCanal).vista == "partido/canal/" + hashCanal)
    }

    @Test func pestanasEnSuOrden() {
        #expect(Pestana.allCases.map(\.rawValue) == ["agenda", "biblioteca", "buscar", "ajustes"])
        #expect(Pestana.allCases.map(\.indice) == [0, 1, 2, 3])
        #expect(Pestana.allCases.map(\.titulo) == ["Agenda", "Canales", "Buscar", "Ajustes"])
        #expect(Pestana.allCases.map(\.icono) == [.agenda, .biblioteca, .buscar, .ajustes])
    }

    @Test func pestanaYTeatroDeCadaDestino() {
        #expect(Destino.canales(.listas).pestana == .canales)
        #expect(Destino.buscar(q: "x").pestana == .buscar)
        #expect(Destino.partido(id: "a").pestana == nil)
        #expect(Destino.sistema.pestana == nil)
        #expect(Destino.partido(id: "a").esTeatro)
        #expect(Destino.canal(hash: hashCanal).esTeatro)
        #expect(!Destino.agenda.esTeatro)
        #expect(!Destino.sistema.esTeatro)
    }

    @Test func profundidadComoRouteDepth() {
        let profundidades = [Destino.agenda, .canales(nil), .buscar(q: nil), .ajustes(nil), .partido(id: "a"),
                             .canal(hash: hashCanal), .sistema].map(\.profundidad)
        #expect(profundidades == [0, 1, 2, 3, 10, 10, 11])
    }

    @Test func sentidoDeLaTransicion() {
        #expect(Sentido.entre(.agenda, .canales(nil)) == .adelante)
        #expect(Sentido.entre(.ajustes(nil), .buscar(q: nil)) == .atras)
        #expect(Sentido.entre(.agenda, .partido(id: "a")) == .adelante)
        #expect(Sentido.entre(.partido(id: "a"), .agenda) == .atras)
        #expect(Sentido.entre(.partido(id: "a"), .canal(hash: hashCanal)) == .adelante)
        #expect(Sentido.entre(.agenda, .agenda) == .adelante)
    }
}
