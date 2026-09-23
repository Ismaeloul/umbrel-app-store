import SwiftUI
import UIKit

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

/// Ajustes → «Dónde se está reproduciendo»: cada sesión abierta en el motor
/// con su canal y los dispositivos que la ven (ordenador o móvil, nombre,
/// «Este dispositivo», reproduciendo o en pausa). En tiempo real: el evento
/// `playback.sessions` por SSE y, de respaldo, se pregunta cada 20 s.
struct SeccionDondeSuena: View {
    @Environment(AppModel.self) private var modelo

    var body: some View {
        let sesiones = DondeSuena.ordenar(
            modelo.sesiones, dispositivo: modelo.dispositivoId, visorLocal: modelo.reproductor.visor)
        Section {
            if sesiones.isEmpty {
                HStack(spacing: 12) {
                    Image(systemName: modelo.sesionesCargadas ? "play.slash" : "hourglass")
                        .font(.title3)
                        .foregroundStyle(Tinta.texto3)
                        .frame(width: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(modelo.sesionesCargadas ? "No se está reproduciendo nada" : "Mirando…")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Tinta.texto)
                        Text("Cuando algo suene en el ordenador o en el móvil, saldrá aquí.")
                            .font(.caption)
                            .foregroundStyle(Tinta.texto2)
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("sesiones-vacio")
            } else {
                ForEach(sesiones) { sesion in
                    FilaSesion(sesion: sesion)
                }
            }
        } header: {
            HStack(spacing: 6) {
                Text("Dónde se está reproduciendo")
                if !sesiones.isEmpty {
                    Circle()
                        .fill(Tinta.okTinta)
                        .frame(width: 7, height: 7)
                        .accessibilityHidden(true)
                }
            }
            .accessibilityIdentifier("cabecera-donde-suena")
        } footer: {
            Text("En tiempo real: los ordenadores y móviles que están viendo algo en tu Ace Player Neo.")
        }
        .animation(Muelle.estandar, value: sesiones.map(\.id))
    }
}

/// Una sesión: su canal y los dispositivos que la ven.
struct FilaSesion: View {
    @Environment(AppModel.self) private var modelo
    let sesion: SessionSummary

    var body: some View {
        let titulo = DondeSuena.titulo(sesion, conocido: modelo.tituloConocido(sesion.hash))
        let aqui = sesion.viewers.contains {
            DondeSuena.esEste($0, dispositivo: modelo.dispositivoId, visorLocal: modelo.reproductor.visor)
        }
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                LogoCanal(titulo: titulo, tamano: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(titulo)
                        .font(.headline)
                        .foregroundStyle(Tinta.texto)
                        .lineLimit(2)
                    Text(detalle)
                        .font(.caption)
                        .foregroundStyle(Tinta.texto2)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 4)
                if !aqui {
                    Button {
                        modelo.reproducirCanal(CanalReproducible(id: sesion.hash, titulo: titulo, origen: "sesion"))
                        withAnimation(Muelle.heroe) { modelo.reproductor.expandir() }
                    } label: {
                        Text("Ver aquí")
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityLabel("Ver \(titulo) en este iPhone")
                }
            }
            ForEach(Array(sesion.viewers.enumerated()), id: \.offset) { _, visor in
                FilaVisor(visor: visor)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sesion-\(sesion.id)")
    }

    private var detalle: String {
        var partes = [DondeSuena.protocolo(sesion)]
        if let desde = FechaISO.parse(sesion.openedAt) {
            partes.append("desde las \(desde.formatted(date: .omitted, time: .shortened))")
        }
        let cuantos = sesion.viewers.count
        partes.append(cuantos == 1 ? "1 dispositivo" : "\(cuantos) dispositivos")
        return partes.joined(separator: " · ")
    }
}

/// Un dispositivo que ve la sesión.
struct FilaVisor: View {
    @Environment(AppModel.self) private var modelo
    let visor: SessionSummary.Viewer

    var body: some View {
        let esEste = DondeSuena.esEste(visor, dispositivo: modelo.dispositivoId, visorLocal: modelo.reproductor.visor)
        let estado = estadoVisor(esEste: esEste)
        HStack(spacing: 10) {
            Image(systemName: DondeSuena.icono(visor))
                .font(.body)
                .foregroundStyle(esEste ? Tinta.acentoTinta : Tinta.texto2)
                .frame(width: 40)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(DondeSuena.nombre(visor))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Tinta.texto)
                    .lineLimit(1)
                if esEste {
                    Text("Este dispositivo")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Tinta.acentoTinta)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Tinta.acento.opacity(0.2), in: Capsule())
                }
            }
            Spacer(minLength: 4)
            Label(estado.texto, systemImage: estado.icono)
                .font(.caption.weight(.semibold))
                .foregroundStyle(estado.color)
                .labelStyle(.titleAndIcon)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(DondeSuena.nombre(visor))\(esEste ? ", este dispositivo" : ""), \(estado.texto.lowercased())")
        .accessibilityIdentifier(esEste ? "visor-este-dispositivo" : "visor")
    }

    private func estadoVisor(esEste: Bool) -> (texto: String, icono: String, color: Color) {
        let reproduciendo: Bool? = visor.playing ?? (esEste ? modelo.reproductor.quiereReproducir : nil)
        switch reproduciendo {
        case .some(true): return ("Reproduciendo", "play.fill", Tinta.okTinta)
        case .some(false): return ("En pausa", "pause.fill", Tinta.texto2)
        case .none: return ("Conectado", "dot.radiowaves.left.and.right", Tinta.texto2)
        }
    }
}
