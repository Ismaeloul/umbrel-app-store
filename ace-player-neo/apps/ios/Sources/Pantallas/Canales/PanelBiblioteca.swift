import SwiftUI

/* El panel de la pestaña (M5; a5 §3.5, §3.7): la lista activa (Listas), la tarjeta-lista con sus filas
   (Recientes con cabeceras de fecha; Listas por categorías plegables) o el vacío que toque, y el botón
   «Buscar «q» en el motor AceStream» con 2 letras o más. */

/// Una fila de la tarjeta-lista (`Row` de LibraryView.tsx).
enum FilaLista: Identifiable {
    case canal(Item, LibraryCollection)
    case fecha(String)
    case categoria(String, Int, Bool)

    var id: String {
        switch self {
        case .canal(let item, let coleccion): ReglasBiblioteca.claveFila(coleccion, item.id)
        case .fecha(let tramo): "h:\(tramo)"
        case .categoria(let nombre, _, _): "c:\(nombre)"
        }
    }

    /// Las filas de una pestaña ya filtrada; `canales` cuenta lo que encaja aunque esté plegado.
    static func de(
        _ items: [Item], seccion: SeccionBiblioteca, consulta: String, abiertas: Set<String>, ahora: Date
    ) -> (filas: [FilaLista], canales: Int) {
        let filtrados = ReglasBiblioteca.filtrar(items, texto: consulta)
        let coleccion = seccion.coleccion
        switch seccion {
        case .favoritos:
            return (filtrados.map { FilaLista.canal($0, coleccion) }, filtrados.count)
        case .recientes:
            var filas: [FilaLista] = []
            for grupo in ReglasBiblioteca.porTramos(filtrados, ahora: ahora) {
                filas.append(.fecha(grupo.tramo))
                filas += grupo.items.map { FilaLista.canal($0, coleccion) }
            }
            return (filas, filtrados.count)
        case .listas:
            let grupos = ReglasBiblioteca.porCategoria(filtrados)
            var filas: [FilaLista] = []
            for grupo in grupos {
                let abierta = !consulta.isEmpty || grupos.count == 1 || abiertas.contains(grupo.categoria)
                filas.append(.categoria(grupo.categoria, grupo.items.count, abierta))
                if abierta { filas += grupo.items.map { FilaLista.canal($0, coleccion) } }
            }
            return (filas, filtrados.count)
        }
    }
}

/// La tarjeta-lista: radio 24, `--surface`, filo `--line-soft` y `--shadow-1`; separador arriba de cada fila.
struct TarjetaLista<Fila: View>: View {
    let filas: [FilaLista]
    let etiqueta: String
    let fila: (FilaLista, Int) -> Fila

    init(filas: [FilaLista], etiqueta: String, @ViewBuilder fila: @escaping (FilaLista, Int) -> Fila) {
        self.filas = filas
        self.etiqueta = etiqueta
        self.fila = fila
    }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
        LazyVStack(spacing: 0) {
            ForEach(Array(filas.enumerated()), id: \.element.id) { (par: (offset: Int, element: FilaLista)) in
                fila(par.element, par.offset)
                    .overlay(alignment: .top) {
                        if par.offset > 0 { Rectangle().fill(Palco.lineSoft).frame(height: 1) }
                    }
            }
        }
        .background(Palco.surface, in: forma)
        .clipShape(forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .sombra(.s1, forma: forma)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(etiqueta)
    }
}
