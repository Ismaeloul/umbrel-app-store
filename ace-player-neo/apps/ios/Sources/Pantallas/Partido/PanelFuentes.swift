import SwiftUI

/* La pestaña «Fuentes» (SourcesPanel.tsx; a4 §12): cabecera («Fuentes n» u «Otras fuentes n» con Rebuscar en
   partidos), progreso del comprobador, «Ninguna da señal», el cuerpo (esqueleto, vacíos o «Emitiendo» +
   carteles con las plegadas) y el inspector. En un canal suelto las fuentes son sus hermanas de la biblioteca
   (§0.0 punto 1); sin hermanas no hay cabecera y solo queda el inspector («Acciones del canal»). */

/// Lo que pinta el panel, ya decidido.
struct VistaFuentes {
    var filas: [FilaCartel] = []
    var visibles: [FilaCartel] = []
    var plegadas: [FilaCartel] = []
    var activa: FilaCartel?
}

struct PanelFuentes: View {
    let enPartido: Bool
    let partidoId: String?
    let canalHash: String?
    let objetivoCanal: ObjetivoInspector?
    let video = EntornoVideo()
    @Environment(RelojCompartido.self) private var reloj
    @Environment(CentroHojas.self) private var hojas

    private var claveSesion: String? {
        if let partidoId { return "partido:\(partidoId)" }
        return canalHash.map { "canal:\($0)" }
    }
    private var deSesion: Bool { video.fuentes.clave == claveSesion && !video.fuentes.entradas.isEmpty }
    private var fase: FaseSesionFuentes { video.fuentes.clave == claveSesion ? video.fuentes.fase : .reposo }

    var body: some View {
        let vista = calcular()
        VStack(alignment: .leading, spacing: 12) {
            if enPartido || !vista.filas.isEmpty { CabeceraFuentes(enPartido: enPartido, cuenta: vista.filas.count) }
            if enPartido && (!vista.filas.isEmpty || fase == .resolviendo) {
                ProgresoComprobador(vista: vista, resolviendo: fase == .resolviendo)
            }
            if let fallo = textoFallo { AvisoFallo(texto: fallo, pegar: pegar) }
            cuerpo(vista)
            InspectorFuente(objetivo: objetivo(vista), enPartido: enPartido, partidoId: partidoId)
        }
        .accessibilityElement(children: .contain)
        .modifier(IdentificadorOtrasSenales(activo: !enPartido))
    }

    /// El fallo de la sesión, solo si es la de esta vista (en la web `useSession` ya es la de la vista).
    private var textoFallo: String? {
        guard video.fuentes.clave == claveSesion, enPartido || !video.fuentes.entradas.isEmpty else { return nil }
        return video.fuentes.textoFallo
    }

    // MARK: Datos

    private func calcular() -> VistaFuentes {
        let listas = video.datos.biblioteca.datos?.webSources ?? []
        let pantalla = video.enPantalla
        if deSesion {
            let f = video.fuentes
            let filas = PresentacionFuentes.filas(
                f.entradas, activa: f.activa, pantalla: pantalla, ahora: reloj.ahora, listas: listas,
                hayComprobador: f.trabajo != nil)
            let visibles = Set(f.visibles.map(\.id))
            let plegadas = Set(f.plegadas.map(\.id))
            return VistaFuentes(
                filas: filas, visibles: filas.filter { visibles.contains($0.id) },
                plegadas: filas.filter { plegadas.contains($0.id) }, activa: filas.first { $0.activa })
        }
        guard let canalHash else { return VistaFuentes() }
        let biblioteca = video.datos.biblioteca.datos
        let hermanas = OtrasFuentes.hermanas(biblioteca, hash: canalHash)
        guard hermanas.count > 1 else { return VistaFuentes() }
        let entradas = hermanas.map { OtrasFuentes.entrada($0, listaActiva: biblioteca?.activeWebSourceId) }
        let activa = video.reproductor.canal?.id
        let filas = PresentacionFuentes.filas(
            entradas, activa: activa, pantalla: pantalla, ahora: reloj.ahora, listas: listas, hayComprobador: false)
        return VistaFuentes(filas: filas, visibles: filas, plegadas: [], activa: filas.first { $0.activa })
    }

    private func objetivo(_ vista: VistaFuentes) -> ObjetivoInspector? {
        guard let fila = vista.activa else { return enPartido ? nil : objetivoCanal }
        let e = fila.entrada
        return ObjetivoInspector(hash: e.id, titulo: e.titulo, ih: e.ih == true, aprendida: e.aprendida == .correct, numero: fila.numero)
    }

    private func pegar() { hojas.abrir(.pegar(partidoId.map { ContextoPegar.partido(id: $0) } ?? .libre)) }

    // MARK: Cuerpo

    @ViewBuilder private func cuerpo(_ vista: VistaFuentes) -> some View {
        if fase == .resolviendo && vista.filas.isEmpty {
            FilasEsqueleto(3, anuncio: "Buscando fuentes para el partido…")
        } else if fase == .sinCanales {
            EstadoVacio(
                titulo: "Canal por confirmar",
                texto: "Este partido todavía no tiene canal anunciado. Si lo encuentras por tu cuenta, pega su Content ID."
            ) { BotonPalco("Pegar hash", icono: .paste, variante: .quieto, tamano: .sm, accion: pegar) }
        } else if (fase == .opciones || fase == .noEncontrado) && vista.filas.isEmpty {
            vacioResolucion
        } else if !vista.filas.isEmpty {
            barra(vista)
            ListaCarteles(visibles: vista.visibles, plegadas: vista.plegadas, enPartido: enPartido)
        }
    }

    private var vacioResolucion: some View {
        let opciones = fase == .opciones
        return EstadoVacio(
            titulo: opciones ? "Elige la señal que quieres usar" : "No hemos encontrado el canal",
            texto: opciones
                ? "Hay varias coincidencias posibles. No reproduciremos ninguna sin que la confirmes."
                : "No aparece en tus listas ni en el buscador. Puedes pegar un Content ID."
        ) {
            BotonPalco("Encontrar canal", icono: .buscar, tamano: .sm) { hojas.abrir(.encontrarCanal) }
            BotonPalco("Pegar hash", icono: .paste, variante: .quieto, tamano: .sm, accion: pegar)
        }
    }

    /// «Emitiendo»: solo con la activa entre las visibles y un título en el reproductor.
    @ViewBuilder private func barra(_ vista: VistaFuentes) -> some View {
        if let activa = vista.activa, vista.visibles.contains(where: { $0.id == activa.id }),
            let titulo = video.reproductor.canal?.titulo
        {
            BarraEmitiendo(
                titulo: titulo, numero: activa.numero, total: vista.filas.count, puedeCambiar: vista.visibles.count > 1)
        }
    }
}

/// «Fuentes 6» u «Otras fuentes 3» (17/800/125, −0,02 em) con la cuenta en `--text-3` y Rebuscar (partido).
private struct CabeceraFuentes: View {
    let enPartido: Bool
    let cuenta: Int
    let video = EntornoVideo()

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(enPartido ? "Fuentes" : "Otras fuentes")
                    .estilo(EstiloTexto(tamano: 17, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1))
                    .foregroundStyle(Palco.text)
                    .accessibilityAddTraits(.isHeader)
                if cuenta > 0 { Num(String(cuenta), tamano: 17).foregroundStyle(Palco.text3) }
            }
            Spacer(minLength: 0)
            if enPartido { rebuscar.padding(.trailing, -8) }
        }
        .frame(minHeight: 44)
    }

    private var rebuscar: some View {
        let rebuscando = video.fuentes.rebuscando
        return Button {
            let fuentes = video.fuentes
            Task { await fuentes.rebuscar() }
        } label: {
            IconoGiratorio(icono: .refresh, girando: rebuscando, tamano: 24)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(Circle())))
        .foregroundStyle(Palco.text2)
        .disabled(rebuscando)
        .accessibilityLabel(rebuscando ? "Rebuscando…" : "Rebuscar fuentes")
    }
}

/// Barra fina del comprobador (alto 3, relleno `--text-2` que late mientras comprueba) y su texto (a4 §12.2).
private struct ProgresoComprobador: View {
    let vista: VistaFuentes
    let resolviendo: Bool
    let video = EntornoVideo()

    var body: some View {
        let trabajo = video.fuentes.trabajo
        let valor = resolviendo ? 0 : PresentacionFuentes.progreso(trabajo, entradas: vista.filas.count)
        let enMarcha = trabajo.map { $0.status != .complete } ?? false
        VStack(alignment: .leading, spacing: 8) {
            BarraFina(valor: valor, latiendo: enMarcha)
            texto(trabajo)
        }
        .accessibilityElement(children: .combine)
    }

    private func texto(_ trabajo: ScanJob?) -> some View {
        let base = resolviendo
            ? "Preparando fuentes"
            : PresentacionFuentes.textoProgreso(trabajo, filas: vista.filas, precalentado: video.fuentes.resolucion?.preheat)
        let ahora = PresentacionFuentes.probandoAhora(vista.visibles, trabajo: trabajo)
        let estilo = EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.25)
        return HStack(spacing: 0) {
            Text(base).estilo(estilo)
            if let ahora {
                Text(" · la ").estilo(estilo)
                Num(String(ahora), tamano: 13)
                Text(" se está probando ahora").estilo(estilo)
            }
        }
        .foregroundStyle(Palco.text2)
        .lineLimit(1)
    }
}

private struct BarraFina: View {
    let valor: Double
    let latiendo: Bool
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: 6, style: .circular)
        ZStack(alignment: .leading) {
            forma.fill(Palco.lineSoft)
            TimelineView(.animation(minimumInterval: nil, paused: !latiendo || reducido)) { contexto in
                Rectangle()
                    .fill(Palco.text2)
                    .opacity(opacidad(contexto.date.timeIntervalSinceReferenceDate))
                    .scaleEffect(x: min(1, max(0, valor)), y: 1, anchor: .leading)
                    .animation(Movimiento.progreso, value: valor)
            }
        }
        .frame(height: 3)
        .clipShape(forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .accessibilityLabel("Progreso del comprobador")
    }

    /// Late `opacity 1 → .55 → 1` en 2 s mientras el comprobador no ha terminado.
    private func opacidad(_ t: Double) -> Double {
        guard latiendo && !reducido else { return 1 }
        let fase: Double = t.truncatingRemainder(dividingBy: 2) / 2
        let angulo: Double = 2 * Double.pi * fase
        let onda: Double = 0.5 - 0.5 * cos(angulo)
        return 1 - 0.45 * onda
    }
}

/// «Ninguna da señal»: relleno 16, radio 18, `--fail` 9 % sobre `--surface`, borde `--fail` al 35 % (a4 §12.3).
private struct AvisoFallo: View {
    let texto: String
    let pegar: () -> Void
    let video = EntornoVideo()

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        let rebuscando = video.fuentes.rebuscando
        VStack(alignment: .leading, spacing: 12) {
            Text(texto).estilo(EstiloTexto(tamano: 15, peso: 450, altoLinea: 1.25)).foregroundStyle(Palco.text)
            HStack(spacing: 8) {
                BotonPalco(rebuscando ? "Rebuscando…" : "Rebuscar", icono: .refresh, variante: .quieto, tamano: .sm,
                           ocupado: rebuscando) {
                    let fuentes = video.fuentes
                    Task { await fuentes.rebuscar() }
                }
                BotonPalco("Pegar hash", icono: .paste, variante: .quieto, tamano: .sm, accion: pegar)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PalcoMezcla.fail9SobreSurface, in: forma)
        .bordeInterior(Palco.fail.opacity(0.35), forma: forma)
        .accessibilityElement(children: .contain)
    }
}

/// El identificador de «Otras señales» solo en el canal suelto (en el partido el panel no lleva ninguno).
private struct IdentificadorOtrasSenales: ViewModifier {
    let activo: Bool

    func body(content: Content) -> some View {
        if activo {
            content.accessibilityIdentifier(IDUI.otrasSenales)
        } else {
            content
        }
    }
}
