import Foundation

// Rescatado en la poda (fase 0.2, b-arquitectura §1.11) de Features/Settings/DondeSuenaView.swift, sin
// cambiar el comportamiento. M7 lo revalida con los vectores de where-playing/model.ts.

/// Cómo se cuenta cada sesión y cada dispositivo de «Dónde se está
/// reproduciendo» (aparte de la vista para probarlo solo).
enum DondeSuena {
    /// ¿Es este iPhone? Por el id del dispositivo emparejado o por el visor.
    static func esEste(_ visor: SessionSummary.Viewer, dispositivo: String?, visorLocal: String?) -> Bool {
        if let id = visor.deviceId, let dispositivo, !id.isEmpty, id == dispositivo { return true }
        if let id = visor.viewerId, let visorLocal, !id.isEmpty, id == visorLocal { return true }
        return false
    }

    /// El nombre que se enseña: el que manda el servidor o uno por su plataforma.
    static func nombre(_ visor: SessionSummary.Viewer) -> String {
        if let nombre = visor.deviceName?.trimmingCharacters(in: .whitespacesAndNewlines), !nombre.isEmpty {
            return nombre
        }
        switch visor.platform ?? visor.client {
        case .ios: return "iPhone"
        case .web: return "Navegador"
        case .legacy: return "Versión anterior de la web"
        case .desconocido: return "Dispositivo"
        }
    }

    /// Ordenador o móvil (el nombre de la web dice «Safari · iPhone», «Chrome · Android»…).
    static func icono(_ visor: SessionSummary.Viewer) -> String {
        let plataforma = visor.platform ?? visor.client
        if plataforma == .ios { return "iphone" }
        let nombre = (visor.deviceName ?? "").lowercased()
        if nombre.contains("ipad") || nombre.contains("tablet") { return "ipad" }
        if nombre.contains("iphone") || nombre.contains("android") || nombre.contains("móvil") || nombre.contains("movil") {
            return "iphone"
        }
        if plataforma == .legacy { return "tv" }
        return "desktopcomputer"
    }

    /// Texto del tipo de vídeo de la sesión.
    static func protocolo(_ sesion: SessionSummary) -> String {
        switch sesion.protocol {
        case .hlsFmp4: return "HLS para iPhone"
        case .hls: return "HLS"
        case .mpegts: return "MPEG-TS"
        case .desconocido, .none:
            return sesion.mode == .progressive ? "MPEG-TS" : "HLS"
        }
    }

    /// Título del canal: el de la sesión, el conocido por la biblioteca o el principio del hash.
    static func titulo(_ sesion: SessionSummary, conocido: String?) -> String {
        if let titulo = sesion.title?.trimmingCharacters(in: .whitespacesAndNewlines), !titulo.isEmpty { return titulo }
        if let conocido, !conocido.isEmpty { return conocido }
        return "Canal \(sesion.hash.prefix(8))…"
    }

    /// Las de este iPhone primero; luego, las más recientes.
    static func ordenar(_ sesiones: [SessionSummary], dispositivo: String?, visorLocal: String?) -> [SessionSummary] {
        sesiones.enumerated().sorted { a, b in
            let aquiA = a.element.viewers.contains { esEste($0, dispositivo: dispositivo, visorLocal: visorLocal) }
            let aquiB = b.element.viewers.contains { esEste($0, dispositivo: dispositivo, visorLocal: visorLocal) }
            if aquiA != aquiB { return aquiA }
            if a.element.openedAt != b.element.openedAt { return a.element.openedAt > b.element.openedAt }
            return a.offset < b.offset
        }
        .map(\.element)
    }
}
