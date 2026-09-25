import Foundation

/* Registro de fallos y «Fuentes con fallos» de Ajustes › Salud (health/model.ts `CAUSES`, `CAUSE_INFO`,
   `describeEntry`, `metricsSentence`, `groupBySource`; health/DiagnosticsLog.tsx; a6 §9.4-§9.5). */

/// Qué quiere decir cada causa (`CauseInfo`).
struct InfoCausa: Hashable, Sendable {
    var palabra: String
    var icono: NombreIcono
    var ayuda: String
}

/// Fallos de las últimas 24 h de una fuente (`SourceGroup`).
struct GrupoFuente: Hashable, Sendable, Identifiable {
    var id: String
    var nombre: String
    var hash: String?
    var cuenta: Int
    var causas: [DiagnosticCause]
    var ultimo: DiagnosticEntry
}

enum RegistroSalud {
    /// Cuántos fallos se piden (`DIAG_LIMIT`).
    static let limite = 200
    /// Ventana de «Fuentes con fallos» (`DAY_MS`).
    static let dia: TimeInterval = 24 * 60 * 60

    /// Las causas en el orden en que se enseñan (`CAUSES`).
    static let causas: [DiagnosticCause] = [.engine, .source, .network, .codec, .client, .state]

    static func info(_ causa: DiagnosticCause) -> InfoCausa {
        switch causa {
        case .engine:
            InfoCausa(palabra: "Motor", icono: .motor,
                      ayuda: "El motor AceStream se cayó, no pudo abrir un canal o se reinició.")
        case .source:
            InfoCausa(palabra: "Fuente", icono: .senal,
                      ayuda: "La emisión no tenía pares, llegaba con muy poca entrada o se cortó.")
        case .network:
            InfoCausa(palabra: "Red", icono: .link,
                      ayuda: "Algo tardó demasiado o un servidor de fuera falló (listas, agenda o marcadores).")
        case .codec:
            InfoCausa(palabra: "Códec", icono: .tv,
                      ayuda: "El vídeo o el audio venían en un formato que no se pudo descodificar.")
        case .client:
            InfoCausa(palabra: "Reproductor", icono: .play,
                      ayuda: "Lo avisa un dispositivo: el reproductor falló, se bloqueó la reproducción automática o se perdió la conexión.")
        case .state, .desconocido:
            InfoCausa(palabra: "Datos guardados", icono: .aviso,
                      ayuda: "Un fichero guardado no se pudo leer y se apartó; se siguió con una copia.")
        }
    }

    /// Recuento de una causa en las 24 h.
    static func cuenta(_ causa: DiagnosticCause, en c: DiagnosticCounts) -> Int {
        switch causa {
        case .engine: c.engine
        case .source: c.source
        case .network: c.network
        case .codec: c.codec
        case .client: c.client
        case .state: c.state
        case .desconocido: 0
        }
    }

    static func total(_ c: DiagnosticCounts) -> Int { causas.reduce(0) { $0 + cuenta($1, en: c) } }

    /// Chips a la vista: las causas con fallos en 24 h y la elegida.
    static func causasVisibles(_ c: DiagnosticCounts?, elegida: DiagnosticCause?) -> [DiagnosticCause] {
        causas.filter { (causa: DiagnosticCause) -> Bool in causa == elegida || tiene(causa, c) }
    }

    private static func tiene(_ causa: DiagnosticCause, _ c: DiagnosticCounts?) -> Bool {
        guard let c else { return false }
        return cuenta(causa, en: c) > 0
    }

    /// Qué pasó, en una frase (`describeEntry`).
    static func describir(_ entrada: DiagnosticEntry) -> String {
        let mensaje = TiemposSalud.frase(entrada.message)
        if !mensaje.isEmpty { return mensaje }
        if entrada.metrics != nil { return "Resumen de una reproducción en un dispositivo." }
        if entrada.code != "internal_error", let conocido = ErrorCatalog.entries[entrada.code] { return conocido.message }
        return info(entrada.cause).ayuda
    }

    /// Métricas del reproductor en claro (`metricsSentence`).
    static func metricas(_ m: PlayerMetrics?) -> String? {
        guard let m else { return nil }
        var partes: [String] = []
        if let t = m.timeToFirstFrameMs { partes.append("imagen en \(TiemposSalud.segundos(t))") }
        if let t = m.remuxStartMs { partes.append("remux listo en \(TiemposSalud.segundos(t))") }
        if let cortes = m.rebuffers {
            let total = (m.rebufferMs ?? 0) > 0 ? " (\(TiemposSalud.segundos(m.rebufferMs ?? 0)) en total)" : ""
            partes.append("\(TiemposSalud.plural(cortes, "corte", "cortes"))\(total)")
        }
        if let r = m.reconnects { partes.append(TiemposSalud.plural(r, "reconexión", "reconexiones")) }
        if let l = m.liveLatencyS { partes.append("\(Int(l.rounded())) s por detrás del directo") }
        return partes.isEmpty ? nil : TiemposSalud.frase(partes.joined(separator: " · "))
    }

    /// «Por fuente» (`groupBySource`): fallos de las 24 h con hash o canal, de más a menos, 5 como mucho.
    static func porFuente(_ entradas: [DiagnosticEntry], ahora: Date, maximo: Int = 5) -> [GrupoFuente] {
        var grupos: [String: GrupoFuente] = [:]
        var orden: [String] = []
        for entrada in entradas {
            guard entrada.hash != nil || entrada.channel != nil else { continue }
            guard let cuando = TiemposSalud.leer(entrada.at), ahora.timeIntervalSince(cuando) <= dia else { continue }
            let clave = entrada.hash.map { "h:\($0)" } ?? "c:\(entrada.channel ?? "")"
            guard var grupo = grupos[clave] else {
                let nombre = nombreDe(entrada)
                grupos[clave] = GrupoFuente(id: clave, nombre: nombre, hash: entrada.hash, cuenta: 1,
                                            causas: [entrada.cause], ultimo: entrada)
                orden.append(clave)
                continue
            }
            grupo.cuenta += 1
            if !grupo.causas.contains(entrada.cause) { grupo.causas.append(entrada.cause) }
            if (TiemposSalud.leer(grupo.ultimo.at) ?? .distantPast) < cuando {
                grupo.ultimo = entrada
                if let canal = entrada.channel, !canal.isEmpty { grupo.nombre = canal }
            }
            grupos[clave] = grupo
        }
        let lista = orden.compactMap { grupos[$0] }
        let ordenada = lista.enumerated().sorted { a, b in
            if a.element.cuenta != b.element.cuenta { return a.element.cuenta > b.element.cuenta }
            let fa = TiemposSalud.leer(a.element.ultimo.at) ?? .distantPast
            let fb = TiemposSalud.leer(b.element.ultimo.at) ?? .distantPast
            if fa != fb { return fa > fb }
            return a.offset < b.offset
        }
        return Array(ordenada.map(\.element).prefix(maximo))
    }

    private static func nombreDe(_ entrada: DiagnosticEntry) -> String {
        if let canal = entrada.channel, !canal.isEmpty { return canal }
        return "Fuente \(String((entrada.hash ?? "").prefix(8)))"
    }

    /// Pie cuando hay más guardados que mostrados.
    static func pie(mostrados: Int, guardados: Int) -> String? {
        guard guardados > mostrados else { return nil }
        let cabeza = mostrados == 1 ? "Sale el más reciente" : "Salen los \(mostrados) más recientes"
        return "\(cabeza) de \(guardados) guardados."
    }

    /// Vacío del registro.
    static func vacio(causa: DiagnosticCause?) -> String {
        guard let causa else { return "Sin fallos registrados. Todo ha ido bien." }
        return "Sin fallos de «\(info(causa).palabra)» registrados."
    }
}
