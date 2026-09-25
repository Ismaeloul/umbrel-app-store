import SwiftUI

/* Lo de «Buscar» bajo el campo (M5; a5 §4.2-§4.4, §4.6): «Enlace detectado», «En tu biblioteca» y «En el
   motor AceStream» con sus fases (pista, buscando, sin resultados, error con aviso una vez, resultados que
   entran escalonados), y los anuncios para VoiceOver. */

struct ResultadosBuscar: View {
    let modelo: ModeloBuscar
    let limpiar: () -> Void
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(Avisos.self) private var avisos
    @Environment(Haptica.self) private var haptica
    @Environment(Reproductor.self) private var reproductor
    @Environment(BajasPendientes.self) private var bajas
    @Environment(TiempoReal.self) private var tiempoReal
    @Environment(RelojCompartido.self) private var reloj
    @Environment(MarcadoresDestapados.self) private var destapados
    @Environment(\.movimientoReducido) private var reducido
    @State private var consulta: Consulta<SearchResponse>?

    private var enlace: String? { ModeloBusqueda.hashOEnlace(modelo.texto) }
    private var q: String { modelo.comprometido }

    private var acciones: AccionesCanal {
        AccionesCanal(
            datos: datos, navegador: navegador, hojas: hojas, avisos: avisos, haptica: haptica, reproductor: reproductor,
            bajas: bajas)
    }

    private var fase: FaseBusqueda {
        let actual = consulta
        return ModeloBusqueda.fase(
            escrito: modelo.texto, comprometido: q, cargando: actual?.cargando == true && actual?.datos == nil,
            error: actual?.error != nil && actual?.datos == nil, cuenta: actual?.datos.map(\.results.count))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let enlace {
                EnlaceDetectado(
                    hash: enlace, conocido: ReglasBiblioteca.conocido(datos.biblioteca.datos, hash: enlace),
                    reproducir: { reproducirPegado(enlace) }, limpiar: limpiar
                )
                .transition(reducido ? .opacity : .opacity.combined(with: .offset(y: 8)))
            } else {
                enTuBiblioteca
                enElMotor
            }
        }
        .animation(Movimiento.estandar(reducido), value: enlace)
        .task(id: claveConsulta) { await buscar() }
        .onChange(of: fase) { _, nueva in alCambiarFase(nueva) }
        .accessibilityValue(ModeloBusqueda.anuncio(fase, enlace: enlace, conocido: enlace.flatMap { ReglasBiblioteca.conocido(datos.biblioteca.datos, hash: $0)?.title }))
    }

    /// Los partidos de hoy y sus canales (para la línea de cada fila).
    private var indice: IndiceAntena { IndiceAntena(agenda: datos.agenda.datos, reloj: RelojMadrid(reloj.ahora)) }

    private var claveConsulta: String { enlace == nil ? q : "" }

    /// La consulta del texto comprometido (una por texto: las atrasadas nunca pintan).
    private func buscar() async {
        guard enlace == nil, ModeloBusqueda.sePuedeBuscar(q) else {
            consulta = nil
            return
        }
        let nueva = datos.busqueda(q)
        consulta = nueva
        await nueva.asegurar(tiempoRealAbierto: tiempoReal.abierto)
    }

    private func alCambiarFase(_ nueva: FaseBusqueda) {
        switch nueva {
        case .error(let q):
            if modelo.debeAvisarFallo(q) { avisos.avisar(ModeloBusqueda.textoFallo, tono: .err) }
        case .resultados:
            modelo.entrarResultados()
        default:
            break
        }
        let texto = ModeloBusqueda.anuncio(nueva, enlace: enlace, conocido: nil)
        if !texto.isEmpty { AccessibilityNotification.Announcement(texto).post() }
    }

    // MARK: Secciones

    @ViewBuilder private var enTuBiblioteca: some View {
        let indice = self.indice
        let locales = ModeloBusqueda.sePuedeBuscar(q) ? ReglasBiblioteca.enTuBiblioteca(datos.biblioteca.datos, texto: q) : []
        if !locales.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                TituloSeccionBuscar(titulo: "En tu biblioteca", contador: nil)
                TarjetaLista(filas: locales.map { FilaLista.canal($0, ReglasBiblioteca.coleccion(de: $0)) }, etiqueta: "En tu biblioteca") { fila, _ in
                    if case .canal(let item, let coleccion) = fila { filaLocal(item, coleccion: coleccion, indice: indice) }
                }
            }
        }
    }

    private var enElMotor: some View {
        VStack(alignment: .leading, spacing: 12) {
            TituloSeccionBuscar(titulo: "En el motor AceStream", contador: contador)
            faseMotor
        }
    }

    private var contador: Int? {
        if case .resultados(_, let n) = fase { return n }
        return nil
    }

    @ViewBuilder private var faseMotor: some View {
        switch fase {
        case .reposo, .corta:
            PistaBuscar()
        case .buscando(let q):
            BuscandoEnElMotor(consulta: q)
        case .vacia(let q):
            EstadoVacio(titulo: "Sin resultados para «\(q)».", texto: "Prueba con otro nombre o menos palabras.") {
                BotonPalco("Borrar la búsqueda", icono: .x, variante: .quieto, accion: limpiar)
            }
        case .error:
            EstadoVacio(titulo: "La búsqueda falló", texto: consulta?.error?.mensaje ?? ModeloBusqueda.textoFallo, error: true) {
                BotonPalco("Reintentar", icono: .refresh) { Task { await consulta?.refrescar() } }
            }
        case .resultados(let q, _):
            listaResultados(q)
        }
    }

    private func listaResultados(_ q: String) -> some View {
        let resultados = consulta?.datos?.results ?? []
        let indice = self.indice
        let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
        return LazyVStack(spacing: 0) {
            ForEach(Array(resultados.enumerated()), id: \.element.id) { (par: (offset: Int, element: SearchResult)) in
                filaResultado(par.element, indice: indice)
                    .modifier(AparicionEscalonada(indice: modelo.entrando ? min(par.offset, ReglasBiblioteca.topeEscalonado) : nil))
                    .overlay(alignment: .top) { if par.offset > 0 { Rectangle().fill(Palco.lineSoft).frame(height: 1) } }
            }
        }
        .background(Palco.surface, in: forma)
        .clipShape(forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .sombra(.s1, forma: forma)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Resultados para «\(q)»")
        .id(q)
    }

    // MARK: Filas

    private func filaLocal(_ item: Item, coleccion: LibraryCollection, indice: IndiceAntena) -> some View {
        let canal = CanalFila(item)
        let antena = antenaDe(item.title, alias: item.alias, indice: indice)
        return FilaCanal(
            canal: canal, subtitulo: ReglasBiblioteca.subtitulo(item, coleccion: coleccion), caido: false,
            enPantalla: reproductor.canal?.id == item.id, antena: antena, tapado: tapado(antena, hash: item.id),
            acciones: acciones.menu(canal, origen: .coleccion(coleccion)), reproducir: { reproducir(canal, ih: item.ih) },
            identificador: IDUI.filaCanal(item.id))
    }

    private func filaResultado(_ resultado: SearchResult, indice: IndiceAntena) -> some View {
        let canal = CanalFila(resultado)
        let antena = antenaDe(resultado.title, alias: nil, indice: indice)
        return FilaCanal(
            canal: canal,
            subtitulo: ReglasBiblioteca.subtituloBusqueda(categoria: resultado.category, disponibilidad: resultado.availability),
            caido: false, enPantalla: reproductor.canal?.id == resultado.id, antena: antena,
            tapado: tapado(antena, hash: resultado.id), acciones: acciones.menu(canal, origen: .busqueda),
            reproducir: { reproducir(canal, ih: true) }, identificador: IDUI.resultado(resultado.id))
    }

    /// Lo que da hoy ese canal (`useOnAir`), con los marcadores que haya.
    private func antenaDe(_ titulo: String, alias: String?, indice: IndiceAntena) -> CanalEnAntena {
        indice.para(titulo: titulo, alias: alias, marcadores: datos.marcadores.datos?.scores ?? [:])
    }

    private func tapado(_ antena: CanalEnAntena, hash: String) -> Bool {
        guard let partido = antena.directo?.partido.id else { return false }
        return Destapado.tapadoFueraDeLaAgenda(viendo: reproductor.canal?.id == hash, destapado: destapados.destapado(partido))
    }

    private func reproducir(_ canal: CanalFila, ih: Bool) {
        guard modelo.puedeReproducir(canal.id) else { return }
        acciones.reproducir(canal, origen: "buscar", ih: ih)
    }

    private func reproducirPegado(_ hash: String) {
        ReproducirPegado(datos: datos, reproductor: reproductor, navegador: navegador, avisos: avisos, haptica: haptica)
            .reproducir(hash)
    }
}
