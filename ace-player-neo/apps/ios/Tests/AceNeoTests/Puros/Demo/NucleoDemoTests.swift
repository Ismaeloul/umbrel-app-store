import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Piezas del núcleo de la demo que el golden no mira por sí solo: las filas de hashes de a7 §13.10-§13.11,
   el JSON propio (lectura y escritura como JSON.stringify), las variantes de la app (visor ajeno con
   -AceNeoDemo, 403 de la 0.8.0, historial de capturas, canjear el código) y los eventos del SSE simulado. */

#if DEBUG
    struct HashesDemoTests {
        /// a7 §13.10: «el test de Swift debe comprobar estas filas».
        @Test(arguments: [
            ("demo-1|Elcano", "0feeabf0888811b8dd55c807eef65f8d85fa4cce"),
            ("demo-1|Faro", "0b4d17a79e8dcc1bc6d94c1c040dcd910a49da8e"),
            ("demo-1|Norte", "e450210aee5337729f1b56ac4c1b252b3f747ff4"),
            ("demo-1|Vega", "e0885d7d8fd6952ef31c09773468ddaed47c4240"),
            ("demo-1|Tarifa", "affb6793a225a4f7c1d2baea4779840d88fbe1d1"),
            ("demo-1|Sur", "da287e2b6843ef7da024f0cbf98c7575937f3264"),
            ("demo-1|Poniente", "5b1f762a0e97f427f27ee9eec724f7af63f653a7"),
            ("demo-1|Levante", "f0cfcb6d3def983c13e79648c4f23d3fe9e60e35"),
            ("demo-5|Elcano", "d8050f93471d3e68fad98e00a8249a0c57c5f07e"),
            ("demo-4|Cierzo", "08cd9e42dbb5fbc0fd74fd6639d98d4a0669e732"),
            ("demo-12|Orión", "a77cefba6bfded1f1d92a0307b041bbaf617d7e3"),
            ("demo-2|Zapping HD", "627047d13bc0001443912355988da5a8ab2ec534"),
            ("demo-3|Atlas", "00a1589e5de325a713acf88c1b1ae492b6986d96"),
            ("demo-13|Atlas", "563060e11fa1d3179da71f36b67de2d64ec3df65"),
        ])
        func demoHash(_ caso: (String, String)) {
            #expect(HashesDemo.demoHash(caso.0) == caso.1)
        }

        /// a7 §13.11.
        @Test(arguments: [
            ("DAZN LaLiga", "80979d013c4a00aa41edb796bfef6e452f48a4cd"),
            ("DAZN 1 HD", "ebede4dced345c3820c16fed5eca45ddbaa581c8"),
            ("La 1", "0e01c8f2e02ce88a6267d25f28e3a2c10b54ac22"),
            ("Eurosport 2", "21074c17914385cee43c4e4843f49e614391660f"),
        ])
        func fakeHash(_ caso: (String, String)) {
            #expect(HashesDemo.fakeHash(caso.0) == caso.1)
        }

        @Test func azarSembradoComoElGenerador() {
            var azar = AleatorioDemo(semilla: 1)
            // xorshift32 desde 1: 270369 / 2^32 (el primer código de la demo sale «000062»).
            #expect(azar.siguiente() == 270_369.0 / 4_294_967_296)
        }
    }

    struct TextosDemoTests {
        /// Las marcas de la demo (a7 §5.1) hablan en lenguaje de la señal (wording.test.ts).
        @Test func sinJerga() {
            for texto in TextosDemo.todos { #expect(Redaccion.valido(texto), "«\(texto)»") }
            #expect(TextosDemo.todos.count == 14)
        }
    }

    struct JSONDemoTests {
        @Test func leeYEscribeComoJSONStringify() throws {
            let texto = #"{"a":1,"b":[true,false,null],"c":"«ñ»\n\"x\"","d":0.92,"e":-0,"f":1790188200000,"g":{}}"#
            let valor = try JSON.leer(texto)
            #expect(valor.cadena == #"{"a":1,"b":[true,false,null],"c":"«ñ»\n\"x\"","d":0.92,"e":0,"f":1790188200000,"g":{}}"#)
            #expect(valor["b"]?.lista?.first == .bool(true))
            #expect(JSON.numeroJS(1.5e-7) == "1.5e-7" && JSON.numeroJS(0.1) == "0.1" && JSON.numeroJS(4800) == "4800")
        }

        @Test func mezclarComoElOperadorDePropagacion() throws {
            let a = try JSON.leer(#"{"x":1,"y":2}"#)
            let b = try JSON.leer(#"{"y":3,"z":4}"#)
            #expect(a.mezclado(con: b).cadena == #"{"x":1,"y":3,"z":4}"#)
            #expect(a.igualEnDatos(try JSON.leer(#"{"y":2,"x":1}"#)))
        }

        @Test func isoExactoComoToISOString() {
            #expect(AgendaDemo.iso(1_790_269_201_350) == "2026-09-24T17:00:01.350Z")
            #expect(AgendaDemo.iso(0) == "1970-01-01T00:00:00.000Z")
            #expect(AgendaDemo.iso(951_782_400_000) == "2000-02-29T00:00:00.000Z")
        }
    }

    struct VariantesDemoTests {
        private let t0 = Date(timeIntervalSince1970: 1_790_269_200)

        private func pedir(_ estado: EstadoDemo, _ metodo: String, _ ruta: String, cuerpo: String? = nil) -> RespuestaDemo {
            RutasDemo.responder(
                PeticionDemo(metodo: metodo, ruta: "/native/api/v1/" + ruta, cuerpo: cuerpo.map { Data($0.utf8) }),
                estado: estado, ahora: t0)
        }

        @Test func conDemoElVisorIPhoneNoEsEsteIPhone() {
            let demo = pedir(EstadoDemo(modo: ModoDemo(demo: true), ahora: t0), "GET", "playback")
            let vivo = pedir(EstadoDemo(modo: ModoDemo(demo: false), ahora: t0), "GET", "playback")
            #expect(demo.json?.cadena.contains(RutasDemo.visorAjeno) == true)
            #expect(demo.json?.cadena.contains("dev_iphone01") == false)
            #expect(vivo.json?.cadena.contains("dev_iphone01") == true)
        }

        @Test func arranqueNativoConElIPhoneEmparejado() {
            let arranque = pedir(EstadoDemo(ahora: t0), "GET", "bootstrap").json
            #expect(arranque?["origin"] == "native")
            #expect(arranque?["device"]?["id"] == "dev_iphone01")
            #expect(arranque?["playback"]?["sessions"]?.lista?.count == 1)
            #expect(arranque?["features"]?["demoSchedule"] == .bool(true))
        }

        @Test func servidor080CierraLasRutasNuevas() {
            let estado = EstadoDemo(modo: ModoDemo(servidor080: true), ahora: t0)
            for (metodo, ruta) in [("GET", "health"), ("PUT", "settings"), ("POST", "pairing"), ("GET", "devices"), ("DELETE", "devices/x")] {
                let r = pedir(estado, metodo, ruta, cuerpo: "{}")
                #expect(r.estado == 403 && r.json?["error"]?["code"] == "origin_forbidden", "\(metodo) \(ruta)")
            }
            #expect(pedir(estado, "GET", "library").estado == 200)
        }

        @Test func canjearElCodigoDeLaDemo() {
            let estado = EstadoDemo(ahora: t0)
            let bueno = pedir(estado, "POST", "pairing/claim", cuerpo: #"{"code":"482913","name":"iPhone"}"#)
            #expect(bueno.estado == 201 && bueno.json?["token"]?.texto?.hasPrefix("dev_iphone01.") == true)
            let malo = pedir(estado, "POST", "pairing/claim", cuerpo: #"{"code":"000000"}"#)
            #expect(malo.estado == 401 && malo.json?["error"]?["code"] == "pairing_invalid")
            #expect(estado.eventos(despuesDe: 0).map(\.tipo) == ["devices.changed"])
        }

        @Test func historialDelRecorridoDeCapturas() {
            let estado = EstadoDemo(modo: ModoDemo(historialCapturas: true), ahora: t0)
            let historial = pedir(estado, "GET", "library").json?["history"]?.lista ?? []
            #expect(historial.compactMap { $0["title"]?.texto } == ["DAZN 1", "DAZN", "Canal de prueba"])
        }

        @Test func lasMutacionesAvisanAlSSESimulado() {
            let estado = EstadoDemo(modo: ModoDemo(demo: false), ahora: t0)
            _ = pedir(estado, "POST", "library", cuerpo: #"{"action":"delete","collection":"favorites","id":"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"}"#)
            _ = pedir(estado, "PUT", "preferences", cuerpo: #"{"leagues":[]}"#)
            _ = pedir(estado, "DELETE", "devices/dev_iphone01")
            let eventos = estado.eventos(despuesDe: 0)
            #expect(eventos.map(\.tipo) == ["state.changed", "state.changed", "devices.changed"])
            #expect(eventos.first?.trama.hasPrefix("id: 1\nevent: state.changed\ndata: {\"scopes\":[\"library\"]") == true)
            #expect(estado.eventos(despuesDe: 2).count == 1)
        }

        @Test func elComprobadorAvisaCadaPaso() {
            let estado = EstadoDemo(modo: ModoDemo(demo: false), ahora: t0)
            let r = RutasDemo.responder(
                PeticionDemo(metodo: "GET", ruta: "/native/api/v1/football/resolve", consulta: [("match", "demo-1"), ("channel", "DAZN")]),
                estado: estado, ahora: t0)
            #expect(r.json?["scan"]?["id"]?.texto != nil)
            let ms = AgendaDemo.ms(t0)
            estado.revisarTrabajos(ahora: ms)
            estado.revisarTrabajos(ahora: ms + 100)
            estado.revisarTrabajos(ahora: ms + 2700)
            let progresos = estado.eventos(despuesDe: 0).filter { $0.tipo == "scan.progress" }
            #expect(progresos.count == 2, "uno por paso distinto, sin repetir")
            estado.revisarTrabajos(ahora: ms + 60 * 60_000)
            let ultimo = estado.eventos(despuesDe: 0).last
            #expect(ultimo?.datos["status"] == "complete")
        }
    }
#endif
