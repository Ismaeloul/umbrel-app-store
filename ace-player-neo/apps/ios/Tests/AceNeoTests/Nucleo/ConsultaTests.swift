import Foundation
import Synchronization
import Testing

@testable import AceNeo

/* Consulta (b-arquitectura §2.5.1; a7 §4, apps/web/src/api/query.ts), sin red: frescura con y sin SSE,
   reintentos a 1 s y 2 s solo si el error es reintentable, una sola petición en vuelo, invalidar con y
   sin observadores, volver a primer plano y escrituras directas. */

private struct RelojFijo: Reloj {
    let ahora: Date
}

/// Lo que va pasando dentro de `pedir` (entre tareas).
private final class Registro: Sendable {
    let llamadas = Contador()
}

@MainActor
private func consulta(
    _ politica: PoliticaConsulta = .porDefecto, fallos: [APIError] = [], espera: Duration = .zero,
    registro: Registro = Registro()
) -> Consulta<Int> {
    let nueva = Consulta<Int>(politica) {
        let n = registro.llamadas.sumar()
        if espera > .zero { try await Task.sleep(for: espera) }
        if n <= fallos.count { throw fallos[n - 1] }
        return n
    }
    nueva.esperarReintento = { _ in }
    return nueva
}

@MainActor
struct ConsultaTests {
    let t0 = Date(timeIntervalSince1970: 1_790_000_000)

    /// ∞ con el SSE abierto (solo invalidan los eventos) y 30 s sin él (a7 §4.1).
    @Test func frescuraPorDefecto() async {
        let c = consulta()
        c.reloj = RelojFijo(ahora: t0)
        #expect(c.caducada(tiempoRealAbierto: true, ahora: t0))  // sin datos, siempre
        await c.refrescar()
        #expect(!c.caducada(tiempoRealAbierto: true, ahora: t0.addingTimeInterval(86_400)))
        #expect(!c.caducada(tiempoRealAbierto: false, ahora: t0.addingTimeInterval(29)))
        #expect(c.caducada(tiempoRealAbierto: false, ahora: t0.addingTimeInterval(30)))
    }

    /// Agenda 10 min (con y sin SSE), marcadores 5 s, búsqueda 60 s (a7 §4.2).
    @Test func frescuraDeLasExcepciones() async {
        let agenda = consulta(.agenda)
        agenda.reloj = RelojFijo(ahora: t0)
        await agenda.refrescar()
        #expect(!agenda.caducada(tiempoRealAbierto: true, ahora: t0.addingTimeInterval(599)))
        #expect(agenda.caducada(tiempoRealAbierto: true, ahora: t0.addingTimeInterval(600)))
        let marcadores = consulta(.marcadores)
        marcadores.reloj = RelojFijo(ahora: t0)
        await marcadores.refrescar()
        #expect(marcadores.caducada(tiempoRealAbierto: true, ahora: t0.addingTimeInterval(5)))
        #expect(PoliticaConsulta.busqueda.reintentos == 0)
        #expect(PoliticaConsulta.busqueda.frescuraSinTiempoReal == .seconds(60))
    }

    /// Dos reintentos (3 intentos), a 1 s y 2 s, solo si el error es reintentable.
    @Test func reintentaLosReintentables() async {
        let registro = Registro()
        let c = consulta(fallos: [.red(.timedOut), .servidor(codigo: "x", estado: 503, mensaje: nil, requestId: nil)],
            registro: registro)
        let esperas = Esperas()
        c.esperarReintento = { n in esperas.anotar(n) }
        await c.refrescar()
        #expect(registro.llamadas.actual == 3)
        #expect(c.datos == 3)
        #expect(c.error == nil)
        #expect(esperas.todas == [0, 1])
    }

    @Test func laEsperaDeLosReintentosEsLaDeLaWeb() async throws {
        // `retryDelay: min(8000, 1000 × 2^n)`: 1 s y 2 s. Se mide la primera sin esperarla entera.
        let c = Consulta<Int> { 1 }
        let inicio = ContinuousClock.now
        let tarea = Task { try await c.esperarReintento(0) }
        try await Task.sleep(for: .milliseconds(300))
        tarea.cancel()
        _ = try? await tarea.value
        #expect(ContinuousClock.now - inicio < .seconds(1))
    }

    @Test func unCuatrocientosNoSeReintenta() async {
        let registro = Registro()
        let c = consulta(fallos: [.servidor(codigo: "not_found", estado: 404, mensaje: nil, requestId: nil)],
            registro: registro)
        await c.refrescar()
        #expect(registro.llamadas.actual == 1)
        #expect(c.datos == nil)
        #expect(c.error?.codigo == "not_found")
    }

    @Test func sinReintentosEnLaBusqueda() async {
        let registro = Registro()
        let c = consulta(.busqueda, fallos: [.red(.timedOut)], registro: registro)
        await c.refrescar()
        #expect(registro.llamadas.actual == 1)
        #expect(c.error == .red(.timedOut))
    }

    /// Un fallo con datos conserva los datos (TanStack también) y deja el error al lado.
    @Test func unFalloConDatosLosConserva() async {
        let c = consulta(fallos: [])
        await c.refrescar()
        #expect(c.datos == 1)
        let rota = Consulta<Int>(PoliticaConsulta(reintentos: 0)) { throw APIError.red(.timedOut) }
        rota.escribir(7)
        await rota.refrescar()
        #expect(rota.datos == 7)
        #expect(rota.error == .red(.timedOut))
    }

    @Test func unaSolaPeticionEnVuelo() async {
        let registro = Registro()
        let c = consulta(espera: .milliseconds(80), registro: registro)
        async let a: Void = c.refrescar()
        async let b: Void = c.asegurar(tiempoRealAbierto: false)
        async let d: Void = c.refrescar()
        _ = await (a, b, d)
        #expect(registro.llamadas.actual == 1)
        #expect(c.datos == 1)
        #expect(!c.cargando)
    }

    @Test func asegurarNoPideSiEstaFresca() async {
        let registro = Registro()
        let c = consulta(registro: registro)
        await c.asegurar(tiempoRealAbierto: true)
        await c.asegurar(tiempoRealAbierto: true)
        #expect(registro.llamadas.actual == 1)
    }

    /// Sin nadie mirando, invalidar solo caduca; mirándola, vuelve a pedir.
    @Test func invalidarConYSinObservadores() async {
        let registro = Registro()
        let c = consulta(registro: registro)
        await c.refrescar()
        c.invalidar()
        #expect(c.caducada(tiempoRealAbierto: true, ahora: Date()))
        try? await Task.sleep(for: .milliseconds(50))
        #expect(registro.llamadas.actual == 1)
        c.empezarAMirar()
        c.invalidar()
        #expect(await llegaA { registro.llamadas.actual == 2 })
        #expect(await llegaA { c.datos == 2 })
        c.dejarDeMirar()
        #expect(c.observadores == 0)
    }

    /// Al volver a primer plano (`refetchOnWindowFocus`): según la política y solo si está caducada.
    @Test func alVolverActiva() async {
        let registro = Registro()
        let c = consulta(registro: registro)  // .soloSinTiempoReal
        c.empezarAMirar()
        await c.refrescar()
        c.volverActiva(tiempoRealAbierto: false)  // fresca: nada
        c.invalidar()
        #expect(await llegaA { registro.llamadas.actual == 2 })
        c.reloj = RelojFijo(ahora: Date().addingTimeInterval(60))
        c.volverActiva(tiempoRealAbierto: true)  // con SSE: nada
        try? await Task.sleep(for: .milliseconds(50))
        #expect(registro.llamadas.actual == 2)
        c.volverActiva(tiempoRealAbierto: false)
        #expect(await llegaA { registro.llamadas.actual == 3 })

        let marcadores = consulta(.marcadores)  // .nunca
        marcadores.empezarAMirar()
        await marcadores.refrescar()
        marcadores.reloj = RelojFijo(ahora: Date().addingTimeInterval(60))
        marcadores.volverActiva(tiempoRealAbierto: false)
        try? await Task.sleep(for: .milliseconds(50))
        #expect(marcadores.datos == 1)

        let agenda = consulta(.agenda)  // .siempre, también con SSE
        agenda.empezarAMirar()
        await agenda.refrescar()
        agenda.reloj = RelojFijo(ahora: Date().addingTimeInterval(700))
        agenda.volverActiva(tiempoRealAbierto: true)
        #expect(await llegaA { agenda.datos == 2 })
    }

    @Test func escriturasDirectas() async {
        let c = consulta()
        c.reloj = RelojFijo(ahora: t0)
        var escritos: [Int] = []
        c.alEscribir = { escritos.append($0) }
        c.modificar { $0 += 1 }  // sin datos, nada
        #expect(c.datos == nil)
        c.escribir(10)
        #expect(c.actualizadaEn == t0)
        c.reloj = RelojFijo(ahora: t0.addingTimeInterval(100))
        c.modificar { $0 += 1 }
        #expect(c.datos == 11)
        #expect(c.actualizadaEn == t0)  // no cambia la frescura
        #expect(escritos == [10, 11])
    }

    /// Lo guardado en disco se ve al momento pero está caducado.
    @Test func pintarEnFrio() async {
        let registro = Registro()
        let c = consulta(registro: registro)
        c.pintarEnFrio(99)
        #expect(c.datos == 99)
        #expect(c.caducada(tiempoRealAbierto: true, ahora: Date()))
        await c.asegurar(tiempoRealAbierto: true)
        #expect(registro.llamadas.actual == 1)
        #expect(c.datos == 1)
        c.pintarEnFrio(5)  // ya hay datos: no pisa
        #expect(c.datos == 1)
    }

    /// Vaciar (olvidar este iPhone) tira lo que estuviera en vuelo.
    @Test func vaciarTiraLaRespuestaEnVuelo() async {
        let c = consulta(espera: .milliseconds(100))
        let tarea = Task { await c.refrescar() }
        try? await Task.sleep(for: .milliseconds(20))
        c.vaciar()
        await tarea.value
        try? await Task.sleep(for: .milliseconds(150))
        #expect(c.datos == nil)
        #expect(!c.cargando)
    }

    @Test func alFallarAvisa() async {
        let c = consulta(fallos: [.servidor(codigo: "origin_forbidden", estado: 403, mensaje: nil, requestId: nil)])
        var fallos: [String?] = []
        c.alFallar = { fallos.append($0.codigo) }
        await c.refrescar()
        #expect(fallos == ["origin_forbidden"])
    }
}

/// Las esperas de los reintentos que se piden.
private final class Esperas: Sendable {
    private let lista = Mutex<[Int]>([])
    func anotar(_ n: Int) { lista.withLock { $0.append(n) } }
    var todas: [Int] { lista.withLock { $0 } }
}
