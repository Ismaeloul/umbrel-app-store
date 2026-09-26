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
///
/// Sin nada que ocupe la tarjeta entera más que su fondo (prueba de Isma: Canales iba a tirones). Con cientos de
/// canales la tarjeta mide miles de puntos: recortarla entera, pintar su filo recortado y su sombra en un único
/// lienzo costaba en cada fotograma. Ahora el filo es un trazo por dentro, solo la primera y la última fila se
/// recortan a las esquinas, y la sombra se pinta en dos tramos (arriba y abajo): `--shadow-1` a los lados no se
/// ve (1 px al 6 % en claro; la segunda capa, con extensión −16, no asoma por los lados).
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
        let ultima = filas.count - 1
        LazyVStack(spacing: 0) {
            ForEach(Array(filas.enumerated()), id: \.element.id) { (par: (offset: Int, element: FilaLista)) in
                fila(par.element, par.offset)
                    .overlay(alignment: .top) {
                        if par.offset > 0 { Rectangle().fill(Palco.lineSoft).frame(height: 1) }
                    }
                    .modifier(EsquinasFila(arriba: par.offset == 0, abajo: par.offset == ultima))
            }
        }
        .fondoTarjetaLista()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(etiqueta)
    }
}

extension View {
    /// Fondo, filo y sombra de una tarjeta-lista larga (Canales y los resultados de Buscar), sin recortarla entera.
    func fondoTarjetaLista() -> some View {
        let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
        return background(Palco.surface, in: forma)
            .overlay { forma.strokeBorder(Palco.lineSoft, lineWidth: 1).allowsHitTesting(false) }
            .background { SombraTarjetaLarga() }
    }
}

/// La primera y la última fila, recortadas a las esquinas de la tarjeta (las de en medio, sin recorte).
struct EsquinasFila: ViewModifier {
    let arriba: Bool
    let abajo: Bool

    func body(content: Content) -> some View {
        if arriba || abajo {
            let r: CGFloat = R.xl
            content.clipShape(UnevenRoundedRectangle(
                topLeadingRadius: arriba ? r : 0, bottomLeadingRadius: abajo ? r : 0,
                bottomTrailingRadius: abajo ? r : 0, topTrailingRadius: arriba ? r : 0, style: .circular))
        } else {
            content
        }
    }
}

/// `--shadow-1` en dos tramos de 64 como mucho (el borde de arriba y el de abajo); lo que queda dentro lo tapa
/// el fondo opaco de la tarjeta.
private struct SombraTarjetaLarga: View {
    var body: some View {
        VStack(spacing: 0) {
            tramo
            Spacer(minLength: 0)
            tramo
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var tramo: some View {
        Color.clear
            .frame(maxHeight: 64)
            .sombra(.s1, forma: RoundedRectangle(cornerRadius: R.xl, style: .circular))
    }
}
