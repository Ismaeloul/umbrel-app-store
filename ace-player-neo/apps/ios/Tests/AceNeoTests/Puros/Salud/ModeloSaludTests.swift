import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Ajustes › Salud (M7): los casos de health/model.test.ts de la web, con el ejemplo `health` de
   @ace/shared y el mismo «ahora» (2026-09-23T18:30:00Z), en un calendario UTC fijo. */

enum SoporteSalud {
    static let ahora = TiemposSalud.leer("2026-09-23T18:30:00.000Z") ?? Date(timeIntervalSince1970: 0)
    static var utc: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? c.timeZone
        return c
    }
    static func salud() throws -> HealthResponse {
        try JSONDecoder().decode(HealthResponse.self, from: Fixtures.datos("v1/health.json"))
    }
    static func iso(haceMs ms: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: ahora.addingTimeInterval(-ms / 1000))
    }
    static func entrada(
        at: String? = nil, causa: DiagnosticCause = .source, codigo: String = "source_no_peers",
        mensaje: String = "La fuente no tiene pares.", hash: String? = nil, canal: String? = nil,
        metricas: PlayerMetrics? = nil
    ) -> DiagnosticEntry {
        DiagnosticEntry(
            id: UUID().uuidString, at: at ?? iso(haceMs: 60_000), cause: causa, code: codigo, message: mensaje,
            hash: hash, channel: canal, deviceId: nil, sessionId: nil, requestId: nil, metrics: metricas)
    }
}

struct PalabrasSaludTests {
    @Test func etiquetasDeLa0659YLasNuevas() {
        let estados = ["ready", "warming", "discovered", "scanning", "degraded", "stale", "model_missing", "offline",
                       "disabled", "empty"]
        #expect(estados.map(ModeloSalud.palabra) == [
            "Listo", "Preparando", "Preparado", "Comprobando", "Con avisos", "Copia anterior", "Falta el modelo",
            "Sin conexión", "Desactivado", "Vacío",
        ])
        #expect(ModeloSalud.palabra("restarting") == "Reiniciándose")
        #expect(ModeloSalud.palabra("lo-que-sea") == "Desconocido")
    }

    @Test func formasDeCadaEstado() {
        #expect(ModeloSalud.senal("ready") == .ok)
        for s in ["degraded", "warming", "model_missing", "stale", "restarting"] { #expect(ModeloSalud.senal(s) == .weak) }
        for s in ["offline", "failed", "empty"] { #expect(ModeloSalud.senal(s) == .fail) }
        #expect(ModeloSalud.senal("disabled") == .pending)
        #expect(ModeloSalud.senal("unknown") == .checking)
    }

    @Test func resumenDelMotor() {
        #expect(ResumenMotor.de(.online) == ResumenMotor(texto: "Motor en línea", tono: .ok))
        #expect(ResumenMotor.de(.restarting).texto == "Motor arrancando…")
        #expect(ResumenMotor.de(.offline).tono == .fail)
        #expect(ResumenMotor.de(nil).texto == "Motor: comprobando…")
        #expect(ResumenMotor.de(.online, fallo: true).texto == "Motor sin respuesta")
    }
}

struct RejillaSaludTests {
    @Test func losOchoServiciosConSuDetalle() throws {
        let filas = ModeloSalud.filas(try SoporteSalud.salud(), motorEnVivo: nil, ahora: SoporteSalud.ahora,
                                      calendario: SoporteSalud.utc)
        #expect(filas.map(\.nombre) == ["Backend", "Motor principal", "Segundo motor", "IA local", "Agenda",
                                        "Directorios M3U", "Datos guardados", "Reproducción"])
        let por = Dictionary(uniqueKeysWithValues: filas.map { ($0.id, $0) })
        #expect(por[.backend]?.detalle == "v0.7.0 · 1 h activo")
        #expect(por[.engine]?.detalle == "Aceptando reproducción · versión 3.2.3")
        #expect(por[.scanner]?.detalle == "0 trabajos · 0 en cola")
        #expect(por[.ai]?.detalle == "Sin configurar")
        #expect(por[.ai]?.palabra == "Desactivado")
        #expect(por[.agenda]?.detalle == "120 partidos · 3 preparados")
        #expect(por[.directories]?.detalle == "2 canales · 1 lista")
        #expect(por[.playback]?.detalle == "1 sesión · 2 visores")
        #expect(por[.playback]?.nota == "2 conexiones en tiempo real · 1 en remux (iPhone).")
        #expect(por[.playback]?.notaAviso == false)
        #expect(por[.engine]?.notaAviso == true)
    }

    @Test func elMotorEnVivoMandaSobreLaFoto() throws {
        let salud = try SoporteSalud.salud()
        var vivo = salud.components.engine
        vivo.status = .offline
        vivo.online = false
        let motor = ModeloSalud.filas(salud, motorEnVivo: vivo, ahora: SoporteSalud.ahora).first { $0.id == .engine }
        #expect(motor?.palabra == "Sin conexión")
        #expect(motor?.senal == .fail)
        #expect(motor?.detalle == "No responde")
    }

    @Test func avisosDelMotor() throws {
        var motor = try SoporteSalud.salud().components.engine
        #expect(ModeloSalud.notaMotor(motor, ahora: SoporteSalud.ahora) == nil)
        motor.autoRestarts.lastHour = 2
        #expect(ModeloSalud.notaMotor(motor, ahora: SoporteSalud.ahora) == "2 de 3 reinicios automáticos en la última hora.")
        motor.autoRestarts = EngineStatus.AutoRestarts(
            lastHour: 3, max: 3, nextAllowedAt: "2026-09-23T18:50:00.000Z", exhausted: true)
        #expect(ModeloSalud.notaMotor(motor, ahora: SoporteSalud.ahora, calendario: SoporteSalud.utc)
            == "Ya se ha reiniciado solo 3 veces en una hora: no lo volverá a hacer hasta las 18:50.")
        motor.autoRestarts.nextAllowedAt = "2026-09-23T18:00:00.000Z"
        #expect(ModeloSalud.notaMotor(motor, ahora: SoporteSalud.ahora)
            == "Ya se ha reiniciado solo 3 veces en una hora: no lo volverá a hacer.")
    }

    @Test func fugasIASinModeloAgendaViejaYDatosRecuperados() throws {
        var h = try SoporteSalud.salud()
        h.components.scanner.leakedSessionsLastHour = 2
        h.components.scanner.activeJobs = 1
        h.components.scanner.queue = 4
        h.components.ai = HealthResponse.Components.AI(status: "model_missing", model: "embeddinggemma")
        h.components.agenda.status = "stale"
        h.components.state = HealthResponse.Components.State(status: "recovered", recoveredFrom: "state.json.bak")
        let por = Dictionary(uniqueKeysWithValues: ModeloSalud.filas(
            h, motorEnVivo: nil, ahora: SoporteSalud.ahora, calendario: SoporteSalud.utc).map { ($0.id, $0) })
        #expect(por[.scanner]?.detalle == "1 trabajo · 4 en cola")
        #expect(por[.scanner]?.nota == "2 sesiones sin cerrar en la última hora.")
        #expect(por[.ai]?.detalle == "Falta embeddinggemma")
        #expect(por[.agenda]?.palabra == "Copia anterior")
        #expect(por[.agenda]?.detalle == "120 partidos · 3 preparados · de las 18:30")
        #expect(por[.state]?.palabra == "Recuperado")
        #expect(por[.state]?.detalle == "Se usó una copia (state.json.bak)")
    }
}

struct ResumenSaludTests {
    @Test func fraseYDatosDeLa0659() throws {
        let h = try SoporteSalud.salud()
        let r = ModeloSalud.resumen(h, filas: ModeloSalud.filas(h, motorEnVivo: nil, ahora: SoporteSalud.ahora),
                                    calendario: SoporteSalud.utc)
        #expect(r.tono == .ok)
        #expect(r.titular == "Todo funciona.")
        #expect(r.hechos == ["1 fuente en cuarentena", "4 correcciones aprendidas", "comprobado 18:30"])
    }

    @Test func conAvisosConUnoCaidoYConVarios() throws {
        var h = try SoporteSalud.salud()
        h.warnings = [HealthResponse.Warning(code: "x", message: "Algo")]
        #expect(ModeloSalud.resumen(h, filas: ModeloSalud.filas(h, motorEnVivo: nil, ahora: SoporteSalud.ahora)).titular
            == "Todo funciona, con avisos.")
        var caido = h.components.engine
        caido.status = .offline
        let uno = ModeloSalud.resumen(h, filas: ModeloSalud.filas(h, motorEnVivo: caido, ahora: SoporteSalud.ahora))
        #expect(uno.tono == .fail)
        #expect(uno.titular == "Motor principal: sin conexión.")
        h.components.directories = HealthResponse.Components.Directories(status: "empty", total: 0, channels: 0)
        #expect(ModeloSalud.resumen(h, filas: ModeloSalud.filas(h, motorEnVivo: caido, ahora: SoporteSalud.ahora)).titular
            == "Hay 2 servicios con problemas.")
    }
}

struct TiemposSaludTests {
    @Test func tiempoActivoSegundosYCuando() {
        #expect(TiemposSalud.tiempoActivo(59) == "0 min")
        #expect(TiemposSalud.tiempoActivo(3600) == "1 h")
        #expect(TiemposSalud.tiempoActivo(3 * 3600 + 5 * 60) == "3 h 5 min")
        #expect(TiemposSalud.tiempoActivo(5 * 86400) == "5 días")
        #expect(TiemposSalud.segundos(2300) == "2,3 s")
        #expect(TiemposSalud.segundos(800) == "0,8 s")
        #expect(TiemposSalud.segundos(4000) == "4 s")
        let utc = SoporteSalud.utc
        let ahora = SoporteSalud.ahora
        #expect(TiemposSalud.cuando(SoporteSalud.iso(haceMs: 10_000), ahora: ahora, calendario: utc).relativo == "ahora mismo")
        #expect(TiemposSalud.cuando(SoporteSalud.iso(haceMs: 5 * 60_000), ahora: ahora, calendario: utc).relativo == "hace 5 min")
        #expect(TiemposSalud.cuando(SoporteSalud.iso(haceMs: 3 * 3_600_000), ahora: ahora, calendario: utc).relativo == "hace 3 h")
        #expect(TiemposSalud.cuando(SoporteSalud.iso(haceMs: 30 * 3_600_000), ahora: ahora, calendario: utc).relativo == "ayer")
        #expect(TiemposSalud.cuando(SoporteSalud.iso(haceMs: 5 * 86_400_000), ahora: ahora, calendario: utc).relativo == "18 sept")
        let malo = TiemposSalud.cuando("no-es-fecha", ahora: ahora, calendario: utc)
        #expect(malo.hora == "—" && malo.relativo == "")
    }
}

struct RegistroSaludTests {
    @Test func lasSeisCausasEnSuOrden() {
        #expect(RegistroSalud.causas == [.engine, .source, .network, .codec, .client, .state])
        #expect(RegistroSalud.causas.map { RegistroSalud.info($0).palabra }
            == ["Motor", "Fuente", "Red", "Códec", "Reproductor", "Datos guardados"])
    }

    @Test func describeElFallo() {
        #expect(RegistroSalud.describir(SoporteSalud.entrada(mensaje: "el comprobador pudo dejar una sesión abierta"))
            == "El comprobador pudo dejar una sesión abierta")
        #expect(!RegistroSalud.describir(SoporteSalud.entrada(causa: .engine, codigo: "engine_unavailable", mensaje: "")).isEmpty)
        #expect(RegistroSalud.describir(SoporteSalud.entrada(causa: .client, codigo: "raro", mensaje: ""))
            .hasPrefix("Lo avisa un dispositivo"))
        #expect(RegistroSalud.describir(SoporteSalud.entrada(
            causa: .client, codigo: "player_metrics", mensaje: "", metricas: PlayerMetrics(rebuffers: 0)))
            == "Resumen de una reproducción en un dispositivo.")
    }

    @Test func metricasEnClaro() {
        #expect(RegistroSalud.metricas(nil) == nil)
        let m = PlayerMetrics(timeToFirstFrameMs: 2300, rebuffers: 2, rebufferMs: 4100, reconnects: 1, liveLatencyS: 14.2)
        #expect(RegistroSalud.metricas(m) == "Imagen en 2,3 s · 2 cortes (4,1 s en total) · 1 reconexión · 14 s por detrás del directo")
    }

    @Test func porFuente() {
        let a = String(repeating: "a", count: 40)
        let grupos = RegistroSalud.porFuente([
            SoporteSalud.entrada(hash: a, canal: "DAZN 1"),
            SoporteSalud.entrada(at: SoporteSalud.iso(haceMs: 30_000), causa: .client, hash: a, canal: "DAZN 1 HD"),
            SoporteSalud.entrada(canal: "Teledeporte"),
            SoporteSalud.entrada(at: SoporteSalud.iso(haceMs: 25 * 3_600_000), hash: String(repeating: "b", count: 40)),
            SoporteSalud.entrada(causa: .engine),
        ], ahora: SoporteSalud.ahora)
        #expect(grupos.map(\.nombre) == ["DAZN 1 HD", "Teledeporte"])
        #expect(grupos.map(\.cuenta) == [2, 1])
        #expect(grupos.first?.causas == [.source, .client])
        let c = String(repeating: "c", count: 40)
        #expect(RegistroSalud.porFuente([SoporteSalud.entrada(hash: c)], ahora: SoporteSalud.ahora).first?.nombre == "Fuente cccccccc")
    }

    @Test func chipsPieYVacio() throws {
        let cuentas = try SoporteSalud.salud().diagnostics.counts24h
        #expect(RegistroSalud.total(cuentas) == 7)
        #expect(RegistroSalud.causasVisibles(cuentas, elegida: nil) == [.engine, .source, .codec, .client])
        #expect(RegistroSalud.causasVisibles(cuentas, elegida: .network) == [.engine, .source, .network, .codec, .client])
        #expect(RegistroSalud.pie(mostrados: 200, guardados: 480) == "Salen los 200 más recientes de 480 guardados.")
        #expect(RegistroSalud.pie(mostrados: 1, guardados: 3) == "Sale el más reciente de 3 guardados.")
        #expect(RegistroSalud.pie(mostrados: 3, guardados: 3) == nil)
        #expect(RegistroSalud.vacio(causa: .engine) == "Sin fallos de «Motor» registrados.")
    }
}
