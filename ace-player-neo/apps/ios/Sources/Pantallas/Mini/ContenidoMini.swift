import SwiftUI

/* Las partes del mini (MiniPlayer.tsx; a4 §19.2): el texto (rótulo con ecualizador, canal y segunda línea) y los
   botones 📺 · ⏸/▶ · ■ de 44 con iconos 24 rellenos en `--text`. 📺 en el móvil en vertical solo si otro
   dispositivo ve lo mismo (en `--accent-ink`); desde 768, siempre. */

/// «Volver al vídeo: {título}»: rótulo 11/650/88 `--accent-ink` · canal 13/650 · nota del marcador (650 `--text`) y
/// « · » + la fuente, 12 `--text-2`. Nunca las cifras.
struct InfoMini: View {
    let titulo: String
    let abrir: () -> Void
    let video = EntornoVideo()
    @Environment(MarcadoresDestapados.self) private var destapados

    var body: some View {
        Button(action: abrir) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Ecualizador(sonando: video.reproductor.fase == .reproduciendo, color: Palco.accentInk)
                    Text(EstadoEscenario.rotuloMini(video.reproductor.fase))
                        .estilo(EstiloTexto(tamano: 11, peso: 650, anchura: 88, altoLinea: 1.45))
                        .foregroundStyle(Palco.accentInk)
                }
                Text(titulo).estilo(EstiloTexto(tamano: 13, peso: 650, altoLinea: 1.25)).foregroundStyle(Palco.text).lineLimit(1)
                segundaLinea
            }
            .padding(.vertical, 2)
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .circular))
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(RoundedRectangle(cornerRadius: 12, style: .circular))))
        .accessibilityLabel("Volver al vídeo: \(titulo)")
    }

    @ViewBuilder private var segundaLinea: some View {
        let nota = notaMarcador
        let subtitulo = video.subtitulo
        if nota != nil || subtitulo != nil {
            let estilo = EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)
            let notaTexto: Text = Text(verbatim: nota ?? "").foregroundStyle(Palco.text).font(Mona.fuente(12, peso: 650))
            let separador: Text = Text(verbatim: nota != nil && subtitulo != nil ? " · " : "")
            let fuente: Text = Text(verbatim: subtitulo ?? "")
            Text("\(notaTexto)\(separador)\(fuente)").estilo(estilo).foregroundStyle(Palco.text2).lineLimit(1)
        }
    }

    /// «Marcador oculto» (tapado) · «72'» · «Descanso» · «En directo» · «Final»; solo con marcador en caché.
    private var notaMarcador: String? {
        guard let partido = video.reproductor.canal?.partido,
            let marcador = DatosTeatro.pintable(video.datos.marcadores.datos?.scores[partido.id]),
            video.datos.marcadores.datos?.available == true
        else { return nil }
        if !destapados.destapado(partido.id) { return "Marcador oculto" }
        if marcador.state == "post" { return "Final" }
        guard let minuto = DatosTeatro.minuto(marcador) else { return "En directo" }
        return minuto.descanso ? "Descanso" : "\(minuto.minuto)'"
    }
}

/// 📺 · ⏸/▶ · ■ (44×44, iconos 24 rellenos).
struct BotonesMini: View {
    let video = EntornoVideo()
    @Environment(SesionApp.self) private var sesion
    @Environment(\.maquetacion) private var maquetacion

    private var otros: Int {
        OtrosDispositivos.cuenta(
            video.datos.reproduccion.datos?.sessions ?? [], visor: video.reproductor.visor, dispositivo: sesion.dispositivo)
    }

    var body: some View {
        let quiere = video.reproductor.quiereReproducir || video.reproductor.fase == .buffer
        let n = otros
        HStack(spacing: 0) {
            if maquetacion.tipo == .tableta || n > 0 {
                BotonMini(.tv, etiqueta: etiquetaDonde(n), tinta: n > 0 ? Palco.accentInk : Palco.text) { video.abrirDonde() }
                    .accessibilityIdentifier(IDUI.miniDonde)
            }
            BotonMini(quiere ? .pause : .play, etiqueta: quiere ? "Pausar" : "Reproducir") { video.alternar() }
                .accessibilityIdentifier(IDUI.miniPausa)
            BotonMini(.stop, etiqueta: "Detener la reproducción") { video.detener() }
                .accessibilityIdentifier(IDUI.miniDetener)
        }
    }

    private func etiquetaDonde(_ n: Int) -> String {
        guard n > 0 else { return "Dónde se está reproduciendo" }
        return "Dónde se está reproduciendo (también en \(n == 1 ? "otro dispositivo" : "\(n) dispositivos más"))"
    }
}

private struct BotonMini: View {
    let icono: NombreIcono
    let etiqueta: String
    let tinta: Color
    let accion: () -> Void

    init(_ icono: NombreIcono, etiqueta: String, tinta: Color = Palco.text, accion: @escaping () -> Void) {
        self.icono = icono
        self.etiqueta = etiqueta
        self.tinta = tinta
        self.accion = accion
    }

    var body: some View {
        Button(action: accion) {
            IconoPalco(icono, tamano: 24, relleno: true).frame(width: 44, height: 44).contentShape(Circle())
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(Circle())))
        .foregroundStyle(tinta)
        .accessibilityLabel(etiqueta)
    }
}

/// Cuántos dispositivos más ven lo mismo (`otherDevicesWatching`, where-playing/model.ts).
enum OtrosDispositivos {
    static func cuenta(_ sesiones: [SessionSummary], visor: String, dispositivo: String?) -> Int {
        guard let sesion = sesiones.first(where: { $0.viewers.contains { $0.viewerId == visor } }) else { return 0 }
        let otros = sesion.viewers.filter { v in
            v.viewerId != visor && !(dispositivo != nil && v.deviceId == dispositivo)
        }
        return Set(otros.map { $0.deviceId ?? $0.viewerId ?? "" }).count
    }
}
