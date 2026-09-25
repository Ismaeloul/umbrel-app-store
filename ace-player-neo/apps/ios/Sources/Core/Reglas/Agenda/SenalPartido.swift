import Foundation

/* Señal de un partido en la agenda (M5; a3 §7.2): `signalFromPreheat`, `signalFromScan`, la ventana del
   precalentado y la decisión de `useMatchSignal` (agenda/domain.ts y data.ts), puras. */

/// `MatchSignal`: estado del medidor, etiqueta propia opcional y la frase larga.
struct SenalPartido: Equatable, Sendable {
    var estado: EstadoSenal
    /// Otra palabra: «Sin señal · reintento 20:51», «Sin fuentes», «Sin comprobar».
    var etiqueta: String?
    /// Frase para VoiceOver y el escenario («3 de 6 fuentes verificadas»).
    var resumen: String
}

/// Qué hace falta para decidir la señal de una tarjeta.
enum PeticionSenal: Equatable, Sendable {
    /// Sin cápsula (sin canales, terminado o fuera de las 6 h).
    case ninguna
    /// Una señal ya decidida (SSE o «Pendiente»).
    case fija(SenalPartido)
    /// Dentro de la ventana: hay que mirar el precalentado del servidor.
    case precalentado
}

enum SenalesPartido {
    /// Ventana del precalentado: de 45 min antes a 120 min después del inicio (`PREHEAT_*`).
    static let antesMs: Double = 45 * 60_000
    static let despuesMs: Double = 120 * 60_000
    /// «Pendiente» solo para lo que empieza en las próximas 6 h.
    static let pendienteMs: Double = 6 * 3_600_000
    /// Sin SSE, el precalentado se vuelve a pedir cada 30 s (data.ts).
    static let sondeoSinTiempoReal: Double = 30

    private static func fuentes(_ n: Int) -> String { n == 1 ? "1 fuente" : "\(n) fuentes" }

    /// `inPreheatWindow`.
    static func enVentana(_ partido: FootballMatch, ahora: Date) -> Bool {
        guard let start = partido.start else { return false }
        let ms = ahora.timeIntervalSince1970 * 1000
        let inicio = Double(start)
        return ms >= inicio - antesMs && ms <= inicio + despuesMs
    }

    /// `signalFromPreheat`.
    static func desdePrecalentado(_ precalentado: PreheatPublic?) -> SenalPartido {
        guard let p = precalentado else {
            return SenalPartido(estado: .pending, resumen: "Pendiente: se comprueban 45 min antes del partido")
        }
        switch p.status {
        case .ready:
            return p.playable > 0
                ? SenalPartido(estado: .ok, resumen: "\(p.playable) de \(fuentes(p.total > 0 ? p.total : p.playable)) verificadas")
                : SenalPartido(estado: .fail, resumen: "Sin señal en \(fuentes(p.total))")
        case .scanning:
            return p.playable > 0
                ? SenalPartido(estado: .ok, resumen: "\(p.playable) de \(fuentes(p.total)) verificadas, sigue comprobando")
                : SenalPartido(estado: .checking, resumen: "Comprobando: \(p.checked) de \(fuentes(p.total)) probadas")
        case .resolving:
            return SenalPartido(estado: .checking, resumen: "Buscando fuentes para el partido")
        case .discovered:
            return SenalPartido(estado: .pending, resumen: "\(fuentes(p.candidateCount)) encontradas, sin comprobar todavía")
        case .noSources:
            return SenalPartido(estado: .fail, etiqueta: "Sin fuentes", resumen: "No hay fuentes para este partido")
        case .scannerOffline:
            return SenalPartido(
                estado: .pending, etiqueta: "Sin comprobar", resumen: "El comprobador no está disponible ahora")
        case .failed, .desconocido:
            return SenalPartido(estado: .fail, resumen: "No se pudo comprobar la señal")
        }
    }

    /// `signalFromScan`: lo que llega por SSE (`scan.progress` con `matchId`). nil si no aporta.
    static func desdeComprobacion(_ progreso: ScanProgressData) -> SenalPartido? {
        if progreso.status == .cancelled { return nil }
        if progreso.playable > 0 {
            let total = progreso.total > 0 ? progreso.total : progreso.playable
            return SenalPartido(estado: .ok, resumen: "\(progreso.playable) de \(fuentes(total)) verificadas")
        }
        if progreso.status == .queued || progreso.status == .running {
            return SenalPartido(
                estado: .checking, resumen: "Comprobando: \(progreso.checked) de \(fuentes(progreso.total)) probadas")
        }
        if let reintento = FechasAgenda.hora(iso: progreso.retryAt) {
            return SenalPartido(
                estado: .fail, etiqueta: "Sin señal · reintento \(reintento)",
                resumen: "Sin señal en \(fuentes(progreso.total)). Reintento a las \(reintento)")
        }
        return SenalPartido(estado: .fail, resumen: "Sin señal en \(fuentes(progreso.total))")
    }

    /// `useMatchSignal`: sin canales o terminado → nada; lo del SSE manda; fuera de la ventana, «Pendiente»
    /// solo si empieza en las próximas 6 h; dentro, el precalentado.
    static func peticion(
        _ partido: FootballMatch, ahora: Date, terminado: Bool, comprobacion: ScanProgressData?
    ) -> PeticionSenal {
        guard !partido.channels.isEmpty, !terminado else { return .ninguna }
        if let comprobacion, let senal = desdeComprobacion(comprobacion) { return .fija(senal) }
        guard enVentana(partido, ahora: ahora) else {
            guard let start = partido.start else { return .ninguna }
            let falta = Double(start) - ahora.timeIntervalSince1970 * 1000
            return falta > 0 && falta <= pendienteMs ? .fija(desdePrecalentado(nil)) : .ninguna
        }
        return .precalentado
    }

    /// Mientras se pide el precalentado (`isLoading`).
    static let consultando = SenalPartido(estado: .checking, resumen: "Consultando la señal…")

    /// La palabra de la cápsula (cards.ts `signalWord`): «Señal» con fuentes verificadas; la etiqueta manda.
    static func palabra(_ senal: SenalPartido) -> String {
        if let etiqueta = senal.etiqueta { return etiqueta }
        switch senal.estado {
        case .ok: return "Señal"
        case .weak: return "Floja"
        case .fail: return "Sin señal"
        case .checking: return "Comprobando"
        case .pending: return "Pendiente"
        }
    }
}
