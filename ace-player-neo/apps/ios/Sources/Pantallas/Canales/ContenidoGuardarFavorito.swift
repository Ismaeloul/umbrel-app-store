import SwiftUI

/* Hoja «Guardar favorito» (M5; a5 §3.10; library/sheets.tsx y data.ts `saveFavorite`): «Nombre del canal»
   (máx. 120; la pista «Si lo dejas vacío: «Canal {6}»» con el campo vacío), la caja «Hash» y «Guardar en
   favoritos». Al guardar: se cierra, aparece arriba de Favoritos al instante, aviso y háptica de éxito, y la
   biblioteca salta a Favoritos (desde el buscador, no). */

struct ContenidoGuardarFavorito: View {
    let canal: RefCanal
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(Avisos.self) private var avisos
    @Environment(Haptica.self) private var haptica
    @State private var valor = ""
    @State private var ocupado = false
    @FocusState private var enfocado: Bool

    var body: some View {
        ContenidoHoja(titulo: "Guardar favorito", tamano: .sm, alCerrar: { hojas.cerrar() }) {
            VStack(alignment: .leading, spacing: 16) {
                CampoTexto(
                    "Nombre del canal", texto: $valor, marcador: "Ej: DAZN LaLiga",
                    pista: valor.trimmingCharacters(in: .whitespaces).isEmpty
                        ? "Si lo dejas vacío: «\(ReglasBiblioteca.tituloFavoritoPorDefecto(canal.hash))»" : nil,
                    enfocado: $enfocado
                )
                .submitLabel(.done)
                .onSubmit(guardar)
                .onChange(of: valor) { _, nuevo in if nuevo.count > 120 { valor = String(nuevo.prefix(120)) } }
                cajaHash
            }
        } pie: {
            BotonPalco("Guardar en favoritos", icono: .star, bloque: true, ocupado: ocupado, accion: guardar)
        }
        .accessibilityIdentifier(IDUI.hojaGuardarFavorito)
        .onAppear {
            valor = canal.titulo
            enfocado = true
        }
    }

    /// `.lib-hashbox`: «Hash» (12 `--text-3`) y el valor en monoespaciada que parte en cualquier sitio.
    private var cajaHash: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        return VStack(alignment: .leading, spacing: 4) {
            Text("Hash").estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text3)
            Text(canal.hash).estilo(.mono).foregroundStyle(Palco.text)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palco.bgSunk, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .accessibilityElement(children: .combine)
    }

    /// `saveFavorite`: optimista (arriba de Favoritos, categoría «Guardado» si no traía) y, si falla, se deshace.
    private func guardar() {
        let escrito = ModeloGustos.colapsar(valor)
        let titulo = escrito.isEmpty ? ReglasBiblioteca.tituloFavoritoPorDefecto(canal.hash) : escrito
        hojas.cerrar()
        let anterior = datos.biblioteca.datos
        let deLista = anterior?.web.first { $0.id == canal.hash }
        let categoria = deLista?.category.isEmpty == false ? deLista?.category ?? "Guardado" : "Guardado"
        let entrada = ItemInput(
            id: canal.hash, title: titulo, category: categoria, fromWebSync: deLista != nil, ih: canal.ih == true)
        if var optimista = anterior {
            let nuevo = Item(
                id: canal.hash, title: titulo, alias: nil, type: .fav, category: categoria, date: "", fromWebSync: deLista != nil,
                ih: canal.ih == true)
            optimista.favorites = [nuevo] + optimista.favorites.filter { $0.id != canal.hash }
            datos.biblioteca.escribir(optimista)
        }
        let saltar = canal.coleccion != nil
        Task {
            do {
                try await datos.mutarBiblioteca(.favoriteUpsert(entrada))
                avisos.avisar(TextosCanal.guardado(titulo), tono: .ok, icono: .star)
                haptica.disparar(.exito)
                if saltar { navegador.pestanaCanales = .favoritos }
            } catch {
                if let anterior { datos.biblioteca.escribir(anterior) }
                avisos.avisar(TextosCanal.noGuardado(APIError.desde(error).mensaje), tono: .err)
            }
        }
    }
}
