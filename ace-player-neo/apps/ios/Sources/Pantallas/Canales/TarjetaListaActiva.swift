import SwiftUI

/* La lista activa (M5; a5 §3.5.1): nombre y «sincronizada 23 sept» / «sin sincronizar», «Cambiar de lista»
   (menú «Listas guardadas» con ✓ en la activa; solo con más de una) y «Gestionar» (Ajustes › Listas). */

struct TarjetaListaActiva: View {
    let biblioteca: LibraryView
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(Avisos.self) private var avisos

    private var activa: WebSourceSummary? {
        biblioteca.webSources.first { $0.id == biblioteca.activeWebSourceId }
    }

    var body: some View {
        if let activa {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(activa.name)
                        .estilo(EstiloTexto(tamano: 15, peso: 800, anchura: 125, trackingEm: -0.01, altoLinea: 1.25))
                        .foregroundStyle(Palco.text)
                        .lineLimit(1)
                    Text(ReglasBiblioteca.fechaCorta(activa.syncedAt).map { "sincronizada \($0)" } ?? "sin sincronizar")
                        .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.25))
                        .foregroundStyle(Palco.text3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if biblioteca.webSources.count > 1 {
                    BotonMas(etiqueta: "Cambiar de lista") { listas }
                        .frame(width: 44, height: 44)
                }
                BotonPalco("Gestionar", icono: .ajustes, variante: .fantasma, tamano: .sm) {
                    navegador.ir(.ajustes(.listas))
                }
            }
            .padding(.horizontal, 4)
        }
    }

    /// «Listas guardadas»: «{nombre} · {n} canal|canales», con ✓ en la activa.
    private var listas: [AccionMenu] {
        biblioteca.webSources.map { (fuente: WebSourceSummary) -> AccionMenu in
            let opcion = OpcionMenu(
                id: fuente.id, titulo: "\(fuente.name) · \(ReglasBiblioteca.canales(fuente.count))",
                marcada: fuente.id == biblioteca.activeWebSourceId)
            return AccionMenu(opcion) { cambiar(a: fuente) }
        }
    }

    private func cambiar(a fuente: WebSourceSummary) {
        guard fuente.id != biblioteca.activeWebSourceId else { return }
        Task {
            do {
                try await datos.activarLista(id: fuente.id)
                await datos.biblioteca.refrescar()
                avisos.avisar(TextosCanal.listaActiva(fuente.name), tono: .ok)
            } catch {
                avisos.avisar(TextosCanal.listaNoCambiada, tono: .err)
            }
        }
    }
}
