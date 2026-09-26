import SwiftUI
import UIKit

/* Acciones sobre canales que comparten «Canales» y «Buscar» (M5; a5 §3.8, §3.9; useChannelActions.tsx):
   reproducir (con la lista de zapping), favorito (hoja al añadir, «Deshacer» al quitar), renombrar, eliminar
   con «Deshacer», abrir en AceStream y las tres copias, con los avisos literales de la web. */

/// Un canal de una fila: de la biblioteca o del buscador del motor.
struct CanalFila: Hashable, Sendable, Identifiable {
    var id: String
    var titulo: String
    var categoria: String
    var alias: String?
    var ih: Bool
    var disponibilidad: Double?

    init(_ item: Item) {
        id = item.id
        titulo = item.title
        categoria = item.category
        alias = item.alias
        ih = item.ih
        disponibilidad = nil
    }

    init(_ resultado: SearchResult) {
        id = resultado.id
        titulo = resultado.title
        categoria = resultado.category
        alias = nil
        ih = resultado.ih
        disponibilidad = resultado.availability
    }
}

@MainActor
struct AccionesCanal {
    let datos: DatosApp
    let navegador: Navegador
    let hojas: CentroHojas
    let avisos: Avisos
    let haptica: Haptica
    let reproductor: Reproductor
    let bajas: BajasPendientes
    /// Al guardar un favorito nuevo, la biblioteca salta a Favoritos (`onFavoriteSaved`: solo Canales lo pasa;
    /// Buscar no, ni para sus filas «En tu biblioteca»).
    var alGuardarIrAFavoritos = false

    private var biblioteca: LibraryView? { datos.biblioteca.datos }

    func esFavorito(_ hash: String) -> Bool { biblioteca?.favorites.contains { $0.id == hash } ?? false }

    /// `playChannel`: arranca el reproductor con el título y el tipo de la lista y va al teatro del canal.
    /// Se apunta en Recientes (lo hace el reproductor al dar imagen, salvo el origen «manual»).
    func reproducir(_ canal: CanalFila, origen: String, ih: Bool?) {
        let zapping = Zapping.lista(biblioteca).map { CanalReproducible(id: $0.id, titulo: $0.titulo, ih: $0.ih, origen: origen) }
        let nuevo = CanalReproducible(id: canal.id, titulo: canal.titulo, ih: ih, origen: origen)
        reproductor.reproducir(nuevo, lista: zapping)
        navegador.ir(.canal(hash: canal.id))
    }

    /// Favorito: si lo es, se quita con «Deshacer»; si no, la hoja «Guardar favorito» con la categoría de la
    /// fila (`toggleFavorite`: Recientes, lista o resultado del motor) y el salto a Favoritos si lo pide Canales.
    func alternarFavorito(_ canal: CanalFila, coleccion: LibraryCollection?) {
        if let existente = biblioteca?.favorites.first(where: { $0.id == canal.id }) {
            bajas.quitar(RefCanal(hash: existente.id, titulo: existente.title, coleccion: .favorites, ih: existente.ih), datos: datos, avisos: avisos)
            return
        }
        let ref = RefCanal(
            hash: canal.id, titulo: canal.titulo, coleccion: coleccion, ih: canal.ih, categoria: canal.categoria,
            alGuardarIrAFavoritos: alGuardarIrAFavoritos)
        hojas.abrir(.guardarFavorito(ref))
    }

    /// El menú de «…» y de la pulsación larga (a5 §3.9), con las mismas opciones para VoiceOver.
    func menu(_ canal: CanalFila, origen: OrigenFila) -> [AccionMenu] {
        let enColeccion: Item? = {
            guard case .coleccion(let coleccion) = origen, let biblioteca else { return nil }
            let lista = coleccion == .favorites ? biblioteca.favorites : coleccion == .history ? biblioteca.history : biblioteca.web
            return lista.first { $0.id == canal.id }
        }()
        let opciones = OpcionesCanal.menu(origen: origen, esFavorito: esFavorito(canal.id), enBiblioteca: enColeccion != nil)
        return opciones.map { (item: OpcionCanal) -> AccionMenu in
            AccionMenu(item.opcion) { ejecutar(item.accion, canal: canal, origen: origen, item: enColeccion) }
        }
    }

    private func ejecutar(_ accion: AccionCanal, canal: CanalFila, origen: OrigenFila, item: Item?) {
        switch accion {
        case .favorito:
            alternarFavorito(canal, coleccion: origen.coleccion)
        case .abrirAceStream: abrirEnAceStream(canal.id)
        case .copiarStream:
            let url = OpcionesCanal.urlStream(origen: RecursosServidor.origen, hash: canal.id, ih: origen == .busqueda || canal.ih)
            copiar(url, ok: TextosCanal.streamCopiado, icono: .externo, fallo: TextosCanal.noCopiado)
        case .copiarEnlace:
            copiar(OpcionesCanal.enlace(canal.id), ok: TextosCanal.enlaceCopiado, icono: .link, fallo: TextosCanal.noCopiado)
        case .copiarHash: copiarHash(canal.id)
        case .copiarNombre: copiar(canal.titulo, ok: TextosCanal.nombreCopiado, icono: .copy, fallo: TextosCanal.noCopiado)
        case .renombrar:
            guard case .coleccion(let coleccion) = origen, let item else { return }
            hojas.abrir(.renombrar(RefCanal(hash: item.id, titulo: item.title, coleccion: coleccion, ih: item.ih)))
        case .eliminar:
            guard case .coleccion(let coleccion) = origen, let item else { return }
            bajas.quitar(RefCanal(hash: item.id, titulo: item.title, coleccion: coleccion, ih: item.ih), datos: datos, avisos: avisos)
        }
    }

    private func copiar(_ texto: String, ok: String, icono: NombreIcono, fallo: String) {
        UIPasteboard.general.string = texto
        avisos.avisar(ok, tono: .ok, icono: icono)
    }

    private func copiarHash(_ valor: String) {
        guard let hash = ModeloBusqueda.normalizarHash(valor) else {
            avisos.avisar(TextosCanal.hashInvalido, tono: .warn)
            return
        }
        copiar(hash, ok: TextosCanal.hashCopiado, icono: .copy, fallo: TextosCanal.hashNoCopiado)
    }

    /// «Abrir en la app de AceStream» (D7): el enlace `acestream://` y la pista de la web.
    private func abrirEnAceStream(_ hash: String) {
        if let url = URL(string: OpcionesCanal.enlace(hash)) { UIApplication.shared.open(url) }
        avisos.avisar(TextosCanal.abriendo, tono: .info, icono: .externo)
    }
}

extension OrigenFila {
    /// La colección de la fila (nil en los resultados del motor).
    var coleccion: LibraryCollection? {
        if case .coleccion(let coleccion) = self { return coleccion }
        return nil
    }
}
