import SwiftUI

/* Ajustes › Acerca de (a6 §11; SettingsView.tsx `AboutSection`): la tabla «Aplicación · Ace Player Neo» y
   «Versión · <versión del servidor>» (« · modo demo» en la demo; «…» mientras llega), la frase y «Atajos de
   teclado» (abre la hoja de ayuda) con «o pulsa ?». Siete toques en «Versión» abren la galería «Sistema»
   (a1 §11; b-arquitectura §2.2.9). */

struct SeccionAcercaDe: View {
    @Environment(DatosApp.self) private var datos
    @Environment(CentroHojas.self) private var hojas
    @Environment(Navegador.self) private var navegador
    @Environment(\.modoDemo) private var modoDemo
    @Environment(\.vistaActiva) private var vistaActiva
    @State private var toques = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            tabla
            Text("Reproductor AceStream para tu Umbrel, con la agenda de fútbol, tu biblioteca y tus listas.")
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
                .fixedSize(horizontal: false, vertical: true)
            Flujo(horizontal: 12, vertical: 8) {
                BotonPalco("Atajos de teclado", icono: .kbd, variante: .quieto) { hojas.abrir(.ayuda) }
                    .accessibilityIdentifier(IDUI.botonAtajos)
                HStack(spacing: 6) {
                    Text("o pulsa").estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text2)
                    Tecla("?")
                }
            }
        }
        .task(id: vistaActiva) {
            guard vistaActiva else { return }
            await datos.arranque.asegurar(tiempoRealAbierto: datos.tiempoRealAbierto)
        }
    }

    private var tabla: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        return VStack(spacing: 0) {
            FilaAcerca(termino: "Aplicación", valor: "Ace Player Neo")
            Rectangle().fill(Palco.lineSoft).frame(height: 1)
            FilaAcerca(termino: "Versión", valor: version)
                .contentShape(Rectangle())
                .onTapGesture { tocarVersion() }
                .accessibilityIdentifier(IDUI.versionApp)
        }
        .background(Palco.bg, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
    }

    private var version: String {
        (datos.arranque.datos?.version ?? "…") + (modoDemo ? " · modo demo" : "")
    }

    private func tocarVersion() {
        toques += 1
        guard toques >= 7 else { return }
        toques = 0
        navegador.ir(.sistema)
    }
}

/// Una fila de la tabla: término en `--text-2`, valor 650 a la derecha; alto 44, relleno 10 14.
private struct FilaAcerca: View {
    let termino: String
    let valor: String

    var body: some View {
        HStack(spacing: 12) {
            Text(termino).estilo(.cuerpo).foregroundStyle(Palco.text2)
            Spacer(minLength: 0)
            Text(valor).estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.45)).foregroundStyle(Palco.text)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}
