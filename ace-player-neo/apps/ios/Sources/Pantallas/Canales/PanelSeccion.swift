import SwiftUI

/* El panel de una pestaña de «Canales» (M5; a5 §3.5, §3.7): la lista activa (en Listas), la tarjeta-lista o su
   vacío, y «Buscar «q» en el motor AceStream» con 2 letras o más y algún resultado. */

struct PanelSeccion: View {
    let modelo: ModeloCanales
    let biblioteca: LibraryView
    let seccion: SeccionBiblioteca
    let items: [Item]
    let acciones: AccionesCanal
    let indice: IndiceAntena
    /// El «ahora» de Canales (30 s); la lista no mira el reloj compartido.
    let ahora: Date
    let marcadores: [String: LiveScore]
    let tapado: (String, String) -> Bool
    let reproducir: (CanalFila) -> Void
    let cambiarPestana: (SeccionBiblioteca) -> Void
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(Reproductor.self) private var reproductor

    private var consulta: String { modelo.consultaLimpia }

    var body: some View {
        let contenido = FilaLista.de(items, seccion: seccion, consulta: consulta, abiertas: modelo.abiertas, ahora: ahora)
        // Una vez por pintada, no por fila: con listas de miles de canales, rehacer este conjunto en cada fila que
        // aparece al desplazar costaba en cada fotograma (tirones en Canales, prueba de Isma).
        let idsLista: Set<String> = seccion == .favoritos ? Set(biblioteca.web.map(\.id)) : []
        VStack(alignment: .leading, spacing: 12) {
            if seccion == .listas { TarjetaListaActiva(biblioteca: biblioteca) }
            if contenido.canales == 0 {
                vacio
            } else {
                TarjetaLista(filas: contenido.filas, etiqueta: seccion.titulo) { fila, i in
                    celda(fila, idsLista: idsLista).modifier(AparicionEscalonada(indice: modelo.entrando ? min(i, ReglasBiblioteca.topeEscalonado) : nil))
                }
                .id(seccion)
            }
            if consulta.count >= ReglasBiblioteca.minimoMotor && contenido.canales > 0 {
                BotonPalco("Buscar «\(consulta)» en el motor AceStream", icono: .buscar, variante: .quieto, bloque: true) {
                    irAlMotor()
                }
            }
        }
    }

    @ViewBuilder private func celda(_ fila: FilaLista, idsLista: Set<String>) -> some View {
        switch fila {
        case .fecha(let tramo):
            CabeceraFecha(tramo: tramo)
        case .categoria(let nombre, let cuenta, let abierta):
            CabeceraCategoria(categoria: nombre, cuenta: cuenta, abierta: abierta, deshabilitada: !consulta.isEmpty) {
                modelo.alternarCategoria(nombre)
            }
        case .canal(let item, let coleccion):
            filaCanal(item, coleccion: coleccion, idsLista: idsLista)
        }
    }

    private func filaCanal(_ item: Item, coleccion: LibraryCollection, idsLista: Set<String>) -> some View {
        let conCategoria = conCategoriaDeLaLista(item)
        let canal = CanalFila(conCategoria)
        let antena = indice.para(titulo: item.title, alias: item.alias, marcadores: marcadores)
        let partido = antena.directo?.partido.id ?? ""
        let subtitulo = ReglasBiblioteca.subtitulo(conCategoria, coleccion: coleccion)
        return FilaCanal(
            canal: canal, subtitulo: subtitulo,
            caido: coleccion == .favorites && ReglasBiblioteca.caido(item, idsLista: idsLista),
            enPantalla: reproductor.canal?.id == item.id, antena: antena, tapado: tapado(partido, item.id),
            acciones: acciones.menu(canal, origen: .coleccion(coleccion)), reproducir: { reproducir(canal) },
            identificador: IDUI.filaCanal(item.id))
    }

    /// Un reciente sin categoría toma la del mismo hash en la lista activa.
    private func conCategoriaDeLaLista(_ item: Item) -> Item {
        guard item.category.isEmpty, let deLista = biblioteca.web.first(where: { $0.id == item.id }) else { return item }
        var copia = item
        copia.category = deLista.category
        return copia
    }

    // MARK: Vacíos (a5 §3.7)

    @ViewBuilder private var vacio: some View {
        let hayListas = !biblioteca.web.isEmpty
        if consulta.count >= ReglasBiblioteca.minimoMotor {
            EstadoVacio(titulo: "Nada en esta pestaña con «\(consulta)».") {
                BotonPalco("Buscar «\(consulta)» en el motor", icono: .buscar) { irAlMotor() }
            }
        } else if seccion == .listas {
            EstadoVacio(
                titulo: "Aún no hay ninguna lista cargada",
                texto: "Añade la dirección de una lista M3U o HTML y sus canales aparecerán aquí, por categorías. Se actualiza sola cada 3 horas."
            ) {
                BotonPalco("Añadir una lista", icono: .plus) { navegador.ir(.ajustes(.listas)) }
                BotonPalco("Pegar un hash", icono: .paste, variante: .quieto) { hojas.abrir(.pegar(.libre)) }
            }
        } else if seccion == .favoritos {
            EstadoVacio(titulo: "Aún no tienes favoritos", texto: "Guarda un canal con la estrella y aparecerá aquí.") {
                if hayListas {
                    BotonPalco("Ver las listas", icono: .list) { cambiarPestana(.listas) }
                } else {
                    BotonPalco("Buscar en el motor", icono: .buscar) { navegador.ir(.buscar(q: nil)) }
                }
            }
        } else {
            EstadoVacio(titulo: "Aún no has visto nada", texto: "Lo que reproduzcas irá quedando aquí.") {
                if hayListas {
                    BotonPalco("Ver las listas", icono: .list) { cambiarPestana(.listas) }
                } else {
                    BotonPalco("Ir a la agenda", icono: .agenda) { navegador.ir(.agenda) }
                }
            }
        }
    }

    /// `goToEngineSearch`: a Buscar con el texto puesto; la búsqueda sale sin esperar y sin subir el teclado.
    private func irAlMotor() {
        navegador.ir(.buscar(q: consulta))
    }
}
