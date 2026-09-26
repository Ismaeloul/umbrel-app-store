import SwiftUI

/* Ajustes › Reproducción (a6 §5 y §5.1; SettingsView.tsx `PlaybackSection`): el modo de este iPhone (perfiles
   AVPlayer 12/8/4 s sin reconectar; toast «Modo «…» activado») y el interruptor del servidor «Un solo
   dispositivo a la vez» (`sameChannelPolicy`: handoff/share), que no es optimista: enseña lo que dice el
   servidor. Con un servidor 0.8.0 (`PUT settings` → 403 `origin_forbidden`) queda deshabilitado con su línea. */

struct SeccionReproduccion: View {
    @Environment(DatosApp.self) private var datos
    @Environment(SesionApp.self) private var sesion
    @Environment(PreferenciasLocales.self) private var preferencias
    @Environment(Reproductor.self) private var reproductor
    @Environment(Avisos.self) private var avisos
    @Environment(Haptica.self) private var haptica
    @Environment(\.vistaActiva) private var vistaActiva
    @State private var guardando = false

    /// Ayuda de la web con «Directo» en lugar de «LIVE» (a6 §5.1, b-arquitectura §0.3).
    static let ayuda =
        "«Equilibrado» mantiene un colchón moderado y es el modo recomendado. «Estable» prioriza la continuidad en canales con pocos pares. «Baja latencia» se acerca más al directo y asume mayor riesgo de cortes. El botón «Directo» siempre permite volver al borde manualmente."
    static let descripcion =
        "Al dar al play en otro dispositivo, este se para (como hasta la 0.6.59). Desactivado, dos dispositivos pueden ver el mismo canal a la vez; con canales distintos siempre manda el último."

    private var respuesta: SettingsResponse? { datos.ajustes.datos }
    private var viejo: Bool { sesion.capacidades.servidorViejo }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Modo de reproducción").estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.45)).foregroundStyle(Palco.text)
                RadioModo(elegido: preferencias.modo, alElegir: elegirModo)
                Text(Self.ayuda)
                    .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            FilaInterruptor("Un solo dispositivo a la vez", descripcion: descripcion, activo: interruptor,
                            deshabilitado: respuesta == nil || guardando || viejo)
            pie
        }
        .task(id: vistaActiva) {
            guard vistaActiva else { return }
            await datos.ajustes.asegurar(tiempoRealAbierto: datos.tiempoRealAbierto)
        }
    }

    private var descripcion: String {
        guard respuesta?.source == .environment else { return Self.descripcion }
        return Self.descripcion + " Ahora lo fija el servidor (ACE_SAME_CHANNEL_POLICY) hasta que lo cambies aquí."
    }

    @ViewBuilder private var pie: some View {
        if viejo {
            Text("\(AvisoVersion.base) \(AvisoVersion.ajuste)")
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.weakInk)
                .fixedSize(horizontal: false, vertical: true)
                .transition(.opacity.combined(with: .offset(y: 8)))
        } else if respuesta == nil, let error = datos.ajustes.error {
            Text("No se pudo leer este ajuste. \(error.mensaje)")
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.failInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// El interruptor enseña lo que dice el servidor; tocarlo lo pide (la web no es optimista).
    private var interruptor: Binding<Bool> {
        Binding(get: { respuesta?.settings.sameChannelPolicy == .handoff }, set: { nuevo in
            Task { await guardar(nuevo) }
        })
    }

    private func elegirModo(_ modo: PlaybackMode) {
        haptica.disparar(.seleccion)
        guard modo != preferencias.modo else { return }
        preferencias.cambiarModo(modo)
        reproductor.cambiarModo(modo)  // el aviso «Modo «…» activado» lo da el reproductor (M3): una sola vez
    }

    private func guardar(_ unoSolo: Bool) async {
        haptica.disparar(.seleccion)
        guardando = true
        defer { guardando = false }
        do {
            try await datos.guardarAjustes(SettingsUpdateBody(sameChannelPolicy: unoSolo ? .handoff : .share))
            avisos.avisar(unoSolo ? "Un solo dispositivo a la vez: activado" : "Varios dispositivos pueden ver el mismo canal",
                          tono: .ok)
        } catch {
            let fallo = APIError.desde(error)
            if fallo.codigo == "origin_forbidden" {
                sesion.anotar(fallo, en: .settingsUpdate)
                avisos.avisar("No se pudo guardar el ajuste. \(AvisoVersion.base)", tono: .err)
            } else {
                avisos.avisar("No se pudo guardar el ajuste. \(fallo.mensaje)", tono: .err)
            }
        }
    }
}
