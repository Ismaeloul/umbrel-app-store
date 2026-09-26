import SwiftUI

/* La pestaña «Fuentes» (SourcesPanel.tsx; a4 §12): cabecera («Fuentes n» u «Otras fuentes n» con Rebuscar en
   partidos), progreso del comprobador, «Ninguna da señal», el cuerpo (esqueleto, vacíos o «Emitiendo» +
   carteles con las plegadas) y el inspector. En un canal suelto las fuentes son sus hermanas de la biblioteca
   (§0.0 punto 1); sin hermanas no hay cabecera y solo queda el inspector («Acciones del canal»). */

/// Lo que pinta el panel, ya decidido (las filas de `useSourcesView`: las de la sesión de fuentes, M3).
struct VistaFuentes {
    var filas: [FilaFuente] = []
    var visibles: [FilaFuente] = []
    var plegadas: [FilaFuente] = []
    var activa: FilaFuente?
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
    /// La sesión es la de esta vista (`useSession`): la de este partido o canal, o la del canal del que este es
    /// hermano (se vuelve del mini tras elegir una hermana: la sesión sigue siendo la del primero).
    private var esLaSesion: Bool {
        let fuentes: SesionFuentes = video.fuentes
        if fuentes.clave == claveSesion { return true }
        guard let canalHash, fuentes.tipo == .canal else { return false }
        return fuentes.entradas.contains { $0.id == canalHash }
    }
    private var deSesion: Bool { esLaSesion && !video.fuentes.entradas.isEmpty }
    private var fase: FaseSesionFuentes { esLaSesion ? video.fuentes.fase : .reposo }

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
        guard esLaSesion, enPartido || !video.fuentes.entradas.isEmpty else { return nil }
        return video.fuentes.textoFallo
    }

    // MARK: Datos

    /// Las filas de la sesión (M3: número, estado, medidor, frase y descripción) y cuáles se ven o se pliegan.
    private func calcular() -> VistaFuentes {
        guard deSesion else { return VistaFuentes() }
        let fuentes: SesionFuentes = video.fuentes
        let ahora: Date = reloj.ahora
        let filas: [FilaFuente] = fuentes.filas(ahora: ahora)
        let visibles = Set(fuentes.filasVisibles(ahora: ahora).map(\.id))
        return VistaFuentes(
            filas: filas, visibles: filas.filter { visibles.contains($0.id) },
            plegadas: filas.filter { !visibles.contains($0.id) }, activa: filas.first { $0.activa })
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
            ListaCarteles(visibles: vista.visibles, plegadas: vista.plegadas, enPartido: enPartido, clave: claveSesion)
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
        let rebuscando: Bool = video.fuentes.rebuscando
        return Button {
            let fuentes: SesionFuentes = video.fuentes
            Task<Void, Never> { await fuentes.rebuscar() }
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

    @Environment(RelojCompartido.self) private var reloj

    var body: some View {
        let comprobador: EstadoComprobador? = video.fuentes.comprobador
        let valor = resolviendo ? 0 : video.fuentes.progreso
        let enMarcha = comprobador.map { $0.estado != .complete } ?? false
        VStack(alignment: .leading, spacing: 8) {
            BarraFina(valor: valor, latiendo: enMarcha)
            texto(comprobador)
        }
        .accessibilityElement(children: .combine)
    }

    /// «· la 3 se está probando ahora» (SourcesPanel.tsx): la que el comprobador prueba, no la de pantalla.
    static func probandoAhora(_ visibles: [FilaFuente], comprobador: EstadoComprobador?) -> Int? {
        guard let comprobador, comprobador.estado != .complete else { return nil }
        return visibles.first { $0.efectivo.estado == .checking && $0.efectivo.motivo != "player_check" }?.numero
    }

    private func texto(_ comprobador: EstadoComprobador?) -> some View {
        let base = resolviendo ? "Preparando fuentes" : video.fuentes.textoProgreso(ahora: reloj.ahora)
        let ahora = Self.probandoAhora(vista.visibles, comprobador: comprobador)
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
        let rebuscando: Bool = video.fuentes.rebuscando
        VStack(alignment: .leading, spacing: 12) {
            Text(texto).estilo(EstiloTexto(tamano: 15, peso: 450, altoLinea: 1.25)).foregroundStyle(Palco.text)
            HStack(spacing: 8) {
                BotonPalco(rebuscando ? "Rebuscando…" : "Rebuscar", icono: .refresh, variante: .quieto, tamano: .sm,
                           ocupado: rebuscando) {
                    let fuentes: SesionFuentes = video.fuentes
                    Task<Void, Never> { await fuentes.rebuscar() }
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
