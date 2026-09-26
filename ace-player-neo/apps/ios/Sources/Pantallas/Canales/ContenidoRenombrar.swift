import SwiftUI

/* Hoja «Renombrar canal» (M5; a5 §3.10; library/sheets.tsx): «Nuevo nombre» (máx. 120, «Hecho»; Intro guarda)
   y «Guardar cambios». Vacío no hace nada; mismo nombre, se cierra sin aviso; si no, se cierra, se ve al
   instante (optimista) y si falla se deshace con el aviso. */

struct ContenidoRenombrar: View {
    let canal: RefCanal
    @Environment(DatosApp.self) private var datos
    @Environment(CentroHojas.self) private var hojas
    @Environment(Avisos.self) private var avisos
    @State private var valor = ""
    @State private var ocupado = false
    @FocusState private var enfocado: Bool

    var body: some View {
        ContenidoHoja(titulo: "Renombrar canal", tamano: .sm, alCerrar: { hojas.cerrar() }) {
            CampoTexto("Nuevo nombre", texto: $valor, enfocado: $enfocado)
                .submitLabel(.done)
                .onSubmit(guardar)
                .onChange(of: valor) { _, nuevo in if nuevo.count > 120 { valor = String(nuevo.prefix(120)) } }
        } pie: {
            BotonPalco("Guardar cambios", bloque: true, ocupado: ocupado, accion: guardar)
        }
        .accessibilityIdentifier(IDUI.hojaRenombrar)
        .onAppear {
            valor = canal.titulo
            enfocado = true
        }
    }

    /// `renameChannel`.
    private func guardar() {
        let titulo = ModeloGustos.colapsar(valor)
        guard !titulo.isEmpty, !ocupado else { return }
        hojas.cerrar()
        guard titulo != canal.titulo, let coleccion = canal.coleccion else { return }
        let anterior = datos.biblioteca.datos
        if let anterior { datos.biblioteca.escribir(Self.renombrado(anterior, id: canal.hash, coleccion: coleccion, titulo: titulo)) }
        let fuente = coleccion == .web ? anterior?.activeWebSourceId : nil
        ocupado = true
        Task {
            defer { ocupado = false }
            do {
                try await datos.mutarBiblioteca(.rename(collection: coleccion, id: canal.hash, title: titulo, sourceId: fuente))
                avisos.avisar(TextosCanal.renombrado, tono: .ok)
            } catch {
                if let anterior { datos.biblioteca.escribir(anterior) }
                avisos.avisar(TextosCanal.noRenombrado, tono: .err)
            }
        }
    }

    /// La biblioteca con el nuevo nombre en esa colección (el cambio se ve al instante).
    static func renombrado(_ biblioteca: LibraryView, id: String, coleccion: LibraryCollection, titulo: String) -> LibraryView {
        var copia = biblioteca
        let cambiar: (Item) -> Item = { item in
            guard item.id == id else { return item }
            var nuevo = item
            nuevo.title = titulo
            return nuevo
        }
        switch coleccion {
        case .favorites: copia.favorites = copia.favorites.map(cambiar)
        case .history: copia.history = copia.history.map(cambiar)
        case .web: copia.web = copia.web.map(cambiar)
        }
        return copia
    }
}
