import Foundation

/* Lógica pura de Ajustes › Salud del sistema y del motor (health/model.ts y `summarizeEngine` de
   api/hooks.ts; a6 §9-§10, a7 §11.10). Textos literales de la web. */

// MARK: - Motor

/// El tono del resumen del motor (`EngineSummary.tone`): `idle` = neutro.
enum TonoMotor: String, Sendable { case ok, weak, fail, idle }

/// `summarizeEngine` (api/hooks.ts): la palabra del motor de la cabecera y de Ajustes › Motor.
struct ResumenMotor: Hashable, Sendable {
    var texto: String
    var tono: TonoMotor

    static func de(_ estado: EngineState?, fallo: Bool = false) -> ResumenMotor {
        if fallo { return ResumenMotor(texto: "Motor sin respuesta", tono: .fail) }
        switch estado {
        case .online?: return ResumenMotor(texto: "Motor en línea", tono: .ok)
        case .restarting?: return ResumenMotor(texto: "Motor arrancando…", tono: .weak)
        case .offline?: return ResumenMotor(texto: "Motor apagado", tono: .fail)
        default: return ResumenMotor(texto: "Motor: comprobando…", tono: .idle)
        }
    }
}

// MARK: - Servicios

enum ServicioSalud: String, CaseIterable, Sendable {
    case backend, engine, scanner, ai, agenda, directories, state, playback
}

/// Una tarjeta de la rejilla de servicios (`ServiceRow`).
struct FilaServicio: Hashable, Sendable, Identifiable {
    var id: ServicioSalud
    var nombre: String
    var icono: NombreIcono
    var estado: String
    var senal: EstadoSenal
    var palabra: String
    var detalle: String
    var nota: String?
    /// `true`: la nota es un aviso (ámbar); `false`: un dato más (gris).
    var notaAviso: Bool
}

/// El resumen de arriba (`HealthSummary`).
struct ResumenSalud: Hashable, Sendable {
    enum Tono: String, Sendable { case ok, weak, fail }
    var tono: Tono
    var titular: String
    var hechos: [String]
}

enum ModeloSalud {
    /// Palabra de cada estado (`STATUS_LABEL`); otro: «Desconocido».
    static func palabra(_ estado: String) -> String {
        switch estado {
        case "ready", "online": "Listo"
        case "warming": "Preparando"
        case "discovered": "Preparado"
        case "scanning", "unknown": "Comprobando"
        case "degraded": "Con avisos"
        case "stale": "Copia anterior"
        case "model_missing": "Falta el modelo"
        case "offline": "Sin conexión"
        case "disabled": "Desactivado"
        case "empty": "Vacío"
        case "restarting": "Reiniciándose"
        case "recovered": "Recuperado"
        case "idle": "En reposo"
        case "busy": "En uso"
        default: "Desconocido"
        }
    }

    /// Forma del estado (`statusSignal`).
    static func senal(_ estado: String) -> EstadoSenal {
        switch estado {
        case "ready", "online", "busy": .ok
        case "warming", "degraded", "stale", "model_missing", "restarting", "recovered", "discovered": .weak
        case "offline", "failed", "empty": .fail
        case "unknown", "scanning": .checking
        default: .pending
        }
    }

    /// Detalle del motor (`engineDetail`).
    static func detalleMotor(_ motor: EngineStatus) -> String {
        let version = motor.engineVersion.map { " · versión \($0)" } ?? ""
        switch motor.status {
        case .online: return "Aceptando reproducción\(version)"
        case .restarting: return "Arrancando…"
        case .unknown: return "Aún sin comprobar"
        default: return "No responde"
        }
    }

    /// Aviso del cupo de reinicios automáticos (`engineNote`).
    static func notaMotor(_ motor: EngineStatus, ahora: Date, calendario: Calendar = .current) -> String? {
        let auto = motor.autoRestarts
        if auto.exhausted {
            var cuando = ""
            if let siguiente = TiemposSalud.leer(auto.nextAllowedAt), siguiente > ahora {
                cuando = " hasta las \(TiemposSalud.reloj(siguiente, calendario: calendario))"
            }
            return "Ya se ha reiniciado solo \(auto.max) veces en una hora: no lo volverá a hacer\(cuando)."
        }
        if auto.lastHour > 0 { return "\(auto.lastHour) de \(auto.max) reinicios automáticos en la última hora." }
        return nil
    }

    private static func fila(
        _ id: ServicioSalud, _ nombre: String, _ icono: NombreIcono, _ estado: String, _ detalle: String,
        nota: String? = nil, aviso: Bool = true
    ) -> FilaServicio {
        FilaServicio(
            id: id, nombre: nombre, icono: icono, estado: estado, senal: senal(estado), palabra: palabra(estado),
            detalle: detalle, nota: nota, notaAviso: aviso)
    }

    /// La rejilla por servicio (`serviceRows`). El motor, del estado en vivo si se tiene.
    static func filas(
        _ salud: HealthResponse, motorEnVivo: EngineStatus?, ahora: Date, calendario: Calendar = .current
    ) -> [FilaServicio] {
        let c = salud.components
        let motor = motorEnVivo ?? c.engine
        return [
            fila(.backend, "Backend", .info, c.backend.status,
                 "v\(salud.version) · \(TiemposSalud.tiempoActivo(salud.uptimeSeconds)) activo"),
            fila(.engine, "Motor principal", .motor, motor.status.rawValue, detalleMotor(motor),
                 nota: notaMotor(motor, ahora: ahora, calendario: calendario)),
            filaSegundoMotor(c.scanner),
            fila(.ai, "IA local", .learn, c.ai.status, detalleIA(c.ai)),
            filaAgenda(c.agenda, calendario: calendario),
            fila(.directories, "Directorios M3U", .list, c.directories.status,
                 "\(TiemposSalud.plural(c.directories.channels, "canal", "canales")) · \(TiemposSalud.plural(c.directories.total, "lista", "listas"))"),
            fila(.state, "Datos guardados", .check, c.state.status, detalleDatos(c.state)),
            filaReproduccion(c.playback, conexiones: c.events.connections),
        ]
    }

    private static func filaSegundoMotor(_ s: HealthResponse.Components.Scanner) -> FilaServicio {
        let fugas = s.leakedSessionsLastHour
        let nota: String? = fugas > 0 ? "\(TiemposSalud.plural(fugas, "sesión", "sesiones")) sin cerrar en la última hora." : nil
        return fila(.scanner, "Segundo motor", .senal, s.status.rawValue,
                    "\(TiemposSalud.plural(s.activeJobs, "trabajo", "trabajos")) · \(s.queue) en cola", nota: nota)
    }

    private static func detalleIA(_ ai: HealthResponse.Components.AI) -> String {
        switch ai.status {
        case "disabled": return "Sin configurar"
        case "model_missing": return "Falta \(ai.model.isEmpty ? "el modelo" : ai.model)"
        case "offline": return "Ollama no responde"
        default: return ai.model.isEmpty ? "Modelo no disponible" : ai.model
        }
    }

    private static func filaAgenda(_ a: HealthResponse.Components.Agenda, calendario: Calendar) -> FilaServicio {
        var desde = ""
        if a.status == "stale", let generada = TiemposSalud.leer(a.generatedAt) {
            desde = " · de las \(TiemposSalud.reloj(generada, calendario: calendario))"
        }
        let preparados = "\(a.preheated) \(a.preheated == 1 ? "preparado" : "preparados")"
        return fila(.agenda, "Agenda", .agenda, a.status,
                    "\(TiemposSalud.plural(a.matches, "partido", "partidos")) · \(preparados)\(desde)")
    }

    private static func detalleDatos(_ s: HealthResponse.Components.State) -> String {
        switch s.status {
        case "ready": return "Leídos sin problemas"
        case "recovered": return "Se usó una copia\(s.recoveredFrom.map { " (\($0))" } ?? "")"
        default: return "Se arrancó sin ellos: hay ficheros apartados"
        }
    }

    private static func filaReproduccion(_ p: HealthResponse.Components.Playback, conexiones: Int) -> FilaServicio {
        let sonando = p.sessions > 0
        let detalle = sonando
            ? "\(TiemposSalud.plural(p.sessions, "sesión", "sesiones")) · \(TiemposSalud.plural(p.viewers, "visor", "visores"))"
            : "Nada sonando ahora"
        let remux = p.remuxSessions > 0 ? " · \(p.remuxSessions) en remux (iPhone)" : ""
        let nota = "\(TiemposSalud.plural(conexiones, "conexión", "conexiones")) en tiempo real\(remux)."
        return fila(.playback, "Reproducción", .play, sonando ? "busy" : "idle", detalle, nota: nota, aviso: false)
    }

    /// El resumen (`healthSummary`).
    static func resumen(_ salud: HealthResponse, filas: [FilaServicio], calendario: Calendar = .current) -> ResumenSalud {
        let fallan = filas.filter { $0.senal == .fail }
        let flojas = filas.filter { $0.senal == .weak }
        var tono = ResumenSalud.Tono.ok
        var titular = "Todo funciona."
        if fallan.count == 1, let unica = fallan.first {
            tono = .fail
            titular = unica.estado == "empty" ? "\(unica.nombre): no hay nada guardado." : "\(unica.nombre): sin conexión."
        } else if fallan.count > 1 {
            tono = .fail
            titular = "Hay \(fallan.count) servicios con problemas."
        } else if !flojas.isEmpty || !salud.warnings.isEmpty {
            tono = .weak
            titular = "Todo funciona, con avisos."
        }
        let comprobado = TiemposSalud.leer(salud.checkedAt).map { TiemposSalud.reloj($0, calendario: calendario) } ?? "—"
        let hechos = [
            TiemposSalud.plural(salud.reports.quarantined, "fuente en cuarentena", "fuentes en cuarentena"),
            TiemposSalud.plural(salud.reports.learningCount, "corrección aprendida", "correcciones aprendidas"),
            "comprobado \(comprobado)",
        ]
        return ResumenSalud(tono: tono, titular: titular, hechos: hechos)
    }
}
