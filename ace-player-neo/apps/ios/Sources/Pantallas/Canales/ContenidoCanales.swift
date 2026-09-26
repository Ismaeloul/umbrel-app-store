import SwiftUI

/* Lo de «Canales» bajo el buscador (M5; a5 §3.3-§3.7): cargando / error, «Emitiendo ahora», las pestañas, el
   panel con sus filas o su vacío, el botón del motor y el pie. */

struct ContenidoCanales: View {
    let modelo: ModeloCanales
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(Avisos.self) private var avisos
    @Environment(Haptica.self) private var haptica
    @Environment(Reproductor.self) private var reproductor
    @Environment(BajasPendientes.self) private var bajas
    @Environment(RelojCompartido.self) private var reloj
    @Environment(MarcadoresDestapados.self) private var destapados
    @Environment(\.maquetacion) private var maquetacion

    private var acciones: AccionesCanal {
        AccionesCanal(
            datos: datos, navegador: navegador, hojas: hojas, avisos: avisos, haptica: haptica, reproductor: reproductor,
            bajas: bajas, alGuardarIrAFavoritos: true)
    }

    private var seccion: SeccionBiblioteca { SeccionBiblioteca(navegador.pestanaCanales) }

    var body: some View {
        if let biblioteca = datos.biblioteca.datos {
            cargada(biblioteca)
        } else if let error = datos.biblioteca.error {
            EstadoVacio(titulo: "No se pudo cargar la biblioteca", texto: error.mensaje, error: true) {
                BotonPalco("Reintentar", icono: .refresh) { Task { await datos.biblioteca.refrescar() } }
            }
        } else {
            FilasEsqueleto(6, anuncio: "Cargando la biblioteca…")
        }
    }

    @ViewBuilder private func cargada(_ biblioteca: LibraryView) -> some View {
        let visibles = Visibles(biblioteca: biblioteca, bajas: bajas)
        let marcadores = datos.marcadores.datos?.scores ?? [:]
        let indice = IndiceAntena(agenda: datos.agenda.datos, reloj: RelojMadrid(reloj.ahora))
        if modelo.consultaLimpia.isEmpty {
            let entradas = ReglasEmitiendo.entradas(visibles.favoritos + visibles.recientes, indice: indice, marcadores: marcadores)
            if !entradas.isEmpty {
                EmitiendoAhora(
                    entradas: entradas, enPantalla: reproductor.canal?.id, favoritos: Set(biblioteca.favorites.map(\.id)),
                    tapado: { tapado(partido: $0.directo.partido.id, hash: $0.item.id) },
                    reproducir: { reproducir(CanalFila($0)) })
            }
        }
        SegmentoPantalla(
            opciones: pestanas(visibles), seleccion: seccion, bloque: true, etiqueta: "Secciones de la biblioteca",
            cambiar: cambiarPestana)
        panel(biblioteca, visibles: visibles, indice: indice, marcadores: marcadores)
        PieBiblioteca(biblioteca: biblioteca)
    }

    private func pestanas(_ visibles: Visibles) -> [OpcionPantalla<SeccionBiblioteca>] {
        let ids = [IDUI.pestanaFavoritos, IDUI.pestanaRecientes, IDUI.pestanaListas]
        return SeccionBiblioteca.allCases.enumerated().map { (par: (offset: Int, element: SeccionBiblioteca)) in
            OpcionPantalla(
                valor: par.element, titulo: par.element.titulo, contador: visibles.cuenta(par.element),
                icono: maquetacion.tipo == .movil ? nil : par.element.icono, identificador: ids[par.offset])
        }
    }

    private func panel(_ biblioteca: LibraryView, visibles: Visibles, indice: IndiceAntena, marcadores: [String: LiveScore])
        -> some View
    {
        PanelSeccion(
            modelo: modelo, biblioteca: biblioteca, seccion: seccion, items: visibles.items(seccion), acciones: acciones,
            indice: indice, marcadores: marcadores, tapado: tapado(partido:hash:), reproducir: reproducir,
            cambiarPestana: cambiarPestana
        )
        .gesture(
            DeslizamientoHorizontal(
                activo: maquetacion.tipo == .movil, alMover: { _ in },
                alSoltar: { dx, dy, vx in deslizar(Double(dx), Double(dy), Double(vx)) }))
    }

    // MARK: Acciones

    /// El marcador del partido que se ve va tapado hasta que se pide (regla 29; `useScoreHidden`).
    private func tapado(partido: String, hash: String) -> Bool {
        Destapado.tapadoFueraDeLaAgenda(viendo: reproductor.canal?.id == hash, destapado: destapados.destapado(partido))
    }

    private func reproducir(_ canal: CanalFila) {
        guard modelo.puedeReproducir(canal.id) else { return }
        acciones.reproducir(canal, origen: "biblioteca", ih: canal.ih)
    }

    private func cambiarPestana(_ nueva: SeccionBiblioteca) {
        guard nueva != seccion else { return }
        haptica.disparar(.seleccion)
        modelo.entrarEnPestana()
        navegador.pestanaCanales = nueva.pestana
    }

    /// Deslizar sobre el panel: izquierda → la siguiente; derecha → la anterior (a5 §3.4).
    private func deslizar(_ dx: Double, _ dy: Double, _ vx: Double) {
        let paso = GestoLateral.paso(dx: dx, dy: dy, vx: vx)
        let todas = SeccionBiblioteca.allCases
        guard paso != 0, let i = todas.firstIndex(of: seccion), todas.indices.contains(i + paso) else { return }
        cambiarPestana(todas[i + paso])
    }
}

/// Las colecciones sin las filas que esperan el «Deshacer» (no se ven ni cuentan).
struct Visibles {
    let favoritos: [Item]
    let recientes: [Item]
    let web: [Item]

    @MainActor
    init(biblioteca: LibraryView, bajas: BajasPendientes) {
        favoritos = biblioteca.favorites.filter { !bajas.pendiente($0.id) }
        recientes = biblioteca.history.filter { !bajas.pendiente($0.id) }
        web = biblioteca.web.filter { !bajas.pendiente($0.id) }
    }

    func items(_ seccion: SeccionBiblioteca) -> [Item] {
        switch seccion {
        case .favoritos: favoritos
        case .recientes: recientes
        case .listas: web
        }
    }

    func cuenta(_ seccion: SeccionBiblioteca) -> Int { items(seccion).count }
}
