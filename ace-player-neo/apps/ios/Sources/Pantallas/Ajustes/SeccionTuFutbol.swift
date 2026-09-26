import SwiftUI

/* Ajustes › Tu fútbol (a6 §4; SettingsView.tsx `FootballSection`): la frase de los gustos y «Editar mis
   gustos», que abre la hoja de gustos de la agenda (M5). */

struct SeccionTuFutbol: View {
    @Environment(DatosApp.self) private var datos
    @Environment(CentroHojas.self) private var hojas
    @Environment(\.vistaActiva) private var vistaActiva

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(frase)
                .estilo(.cuerpo)
                .foregroundStyle(Palco.text)
                .fixedSize(horizontal: false, vertical: true)
            BotonPalco("Editar mis gustos", icono: .pencil, variante: .quieto) { hojas.abrir(.gustos) }
        }
        .task(id: vistaActiva) {
            guard vistaActiva else { return }
            await datos.preferencias.asegurar(tiempoRealAbierto: datos.tiempoRealAbierto)
        }
    }

    private var frase: String {
        if let respuesta = datos.preferencias.datos { return ResumenGustos.frase(respuesta.preferences) }
        return datos.preferencias.error != nil ? "No se pudieron leer tus gustos." : "Cargando tus gustos…"
    }
}
