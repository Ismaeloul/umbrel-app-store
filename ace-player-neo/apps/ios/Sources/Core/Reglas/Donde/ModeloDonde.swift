import Foundation

/* «Dónde se está reproduciendo» (where-playing/model.ts; a6 §6, a7 §11.9): lo que se enseña de cada
   sesión de `GET playback` y del SSE `playback.sessions`. Revalidado por M7 contra la web (antes era el
   `DondeSuena` rescatado en la poda). */

enum TipoAparato: String, Sendable {
    case ordenador, movil, tele

    var icono: NombreIcono {
        switch self {
        case .ordenador: .pantalla
        case .movil: .movil
        case .tele: .tv
        }
    }

    var palabra: String {
        switch self {
        case .ordenador: "Ordenador"
        case .movil: "Móvil"
        case .tele: "Tele"
        }
    }
}

enum EstadoVisor: String, Sendable {
    case reproduciendo, pausa, conectado

    var texto: String {
        switch self {
        case .reproduciendo: "Reproduciendo"
        case .pausa: "En pausa"
        case .conectado: "Conectado"
        }
    }

    var icono: NombreIcono {
        switch self {
        case .reproduciendo: .play
        case .pausa: .pause
        case .conectado: .senal
        }
    }
}

enum ModeloDonde {
    /// Nombre del aparato: el que manda el servidor (web: «Safari · iPhone»; app: el nombre del iPhone).
    static func nombre(_ v: SessionSummary.Viewer) -> String {
        if let nombre = v.deviceName?.trimmingCharacters(in: .whitespacesAndNewlines), !nombre.isEmpty { return nombre }
        return plataforma(v)
    }

    /// `PLATFORM_LABEL`: «Web», «App Ace Neo», «App antigua».
    static func plataforma(_ v: SessionSummary.Viewer) -> String {
        switch v.platform ?? v.client {
        case .web: "Web"
        case .ios: "App Ace Neo"
        case .legacy: "App antigua"
        case .desconocido: "Web"
        }
    }

    /// Ordenador, móvil o tele (`deviceKind`).
    static func tipo(_ v: SessionSummary.Viewer) -> TipoAparato {
        let nombre = v.deviceName ?? ""
        let plataforma = v.platform ?? v.client
        if contiene(nombre, palabras: ["Smart TV"]) { return .tele }
        if plataforma == .ios { return contiene(nombre, palabras: ["Mac", "MacBook", "iMac"]) ? .ordenador : .movil }
        if contiene(nombre, palabras: ["iPhone", "iPad", "iPod", "Android"]) { return .movil }
        if plataforma == .legacy { return .movil }
        return .ordenador
    }

    /// `\b(…)\b` sin distinguir mayúsculas.
    private static func contiene(_ texto: String, palabras: [String]) -> Bool {
        let bajo = texto.lowercased()
        for palabra in palabras {
            var resto = bajo[...]
            let buscada = palabra.lowercased()
            while let rango = resto.range(of: buscada) {
                let antes = rango.lowerBound == bajo.startIndex ? nil : bajo[bajo.index(before: rango.lowerBound)]
                let despues = rango.upperBound == bajo.endIndex ? nil : bajo[rango.upperBound]
                if !esLetra(antes) && !esLetra(despues) { return true }
                resto = bajo[rango.upperBound...]
            }
        }
        return false
    }

    private static func esLetra(_ c: Character?) -> Bool {
        guard let c else { return false }
        return c.isLetter || c.isNumber || c == "_"
    }

    /// Del último latido (`playState`).
    static func estado(_ v: SessionSummary.Viewer) -> EstadoVisor {
        switch v.playing {
        case true?: .reproduciendo
        case false?: .pausa
        case nil: .conectado
        }
    }

    /// `PROTOCOL_LABEL`.
    static func protocolo(_ s: SessionSummary) -> String {
        switch s.protocol {
        case .mpegts?: "MPEG-TS"
        case .hlsFmp4?: "HLS para iPhone"
        case .hls?: "HLS compartido"
        case .desconocido?, nil: s.mode == .progressive ? "MPEG-TS" : "HLS compartido"
        }
    }

    /// El título del servidor o «Canal <8>» (`sessionTitle`).
    static func titulo(_ s: SessionSummary) -> String {
        let titulo = (s.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return titulo.isEmpty ? "Canal \(s.hash.prefix(8))" : titulo
    }

    /// «1 dispositivo» / «2 dispositivos» (`countText`).
    static func cuenta(_ n: Int) -> String { n == 1 ? "1 dispositivo" : "\(n) dispositivos" }

    /// «20:30» en la hora del dispositivo; vacío si la fecha no vale (`openedClock`).
    static func desde(_ s: SessionSummary, calendario: Calendar = .current) -> String {
        TiemposSalud.leer(s.openedAt).map { TiemposSalud.reloj($0, calendario: calendario) } ?? ""
    }

    /// «2 dispositivos · HLS compartido · desde las 20:30».
    static func meta(_ s: SessionSummary, calendario: Calendar = .current) -> String {
        let hora = desde(s, calendario: calendario)
        let cola = hora.isEmpty ? "" : " · desde las \(hora)"
        return "\(cuenta(s.viewers.count)) · \(protocolo(s))\(cola)"
    }

    /// «Móvil · App Ace Neo».
    static func metaVisor(_ v: SessionSummary.Viewer) -> String { "\(tipo(v).palabra) · \(plataforma(v))" }

    /// ¿Es este aparato? (`isMine`: por el id del dispositivo).
    static func esEste(_ v: SessionSummary.Viewer, dispositivo: String?) -> Bool {
        guard let id = v.deviceId, let dispositivo, !id.isEmpty else { return false }
        return id == dispositivo
    }

    /// Solo las que tienen a alguien viendo, primero la de este aparato y luego la más reciente; y en cada
    /// una, este aparato el primero (`visibleSessions`).
    static func visibles(_ sesiones: [SessionSummary], dispositivo: String?) -> [SessionSummary] {
        let conVisores = sesiones.filter { !$0.viewers.isEmpty }.map { sesion -> SessionSummary in
            var copia = sesion
            copia.viewers = sesion.viewers.enumerated().sorted { a, b in
                let ea = esEste(a.element, dispositivo: dispositivo)
                let eb = esEste(b.element, dispositivo: dispositivo)
                return ea != eb ? ea : a.offset < b.offset
            }.map(\.element)
            return copia
        }
        return conVisores.enumerated().sorted { a, b in
            let ma = a.element.viewers.contains { esEste($0, dispositivo: dispositivo) }
            let mb = b.element.viewers.contains { esEste($0, dispositivo: dispositivo) }
            if ma != mb { return ma }
            if a.element.openedAt != b.element.openedAt { return a.element.openedAt > b.element.openedAt }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// Frase para VoiceOver (`summaryText`).
    static func resumen(_ sesiones: [SessionSummary]) -> String {
        guard !sesiones.isEmpty else { return "No se está reproduciendo nada." }
        return sesiones.map { "«\(titulo($0))» en \(cuenta($0.viewers.count))" }.joined(separator: "; ") + "."
    }
}

/// Lo que queda del `DondeSuena` rescatado en la poda (lo usa `FixturesTests`): ¿es este iPhone?, por el
/// id del dispositivo emparejado o por el visor.
enum DondeSuena {
    static func esEste(_ visor: SessionSummary.Viewer, dispositivo: String?, visorLocal: String?) -> Bool {
        if ModeloDonde.esEste(visor, dispositivo: dispositivo) { return true }
        if let id = visor.viewerId, let visorLocal, !id.isEmpty, id == visorLocal { return true }
        return false
    }
}
