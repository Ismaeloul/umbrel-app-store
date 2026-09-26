import SwiftUI

/// Agenda de Palco: el título grande arriba y, dentro del contenido que se
/// desplaza, la tarjeta «versus» grande del partido destacado (la portada),
/// la tira de días, «Para ti / Todos», la tarjeta para personalizar y los
/// partidos en tres secciones (En directo · Próximos · Terminados) como
/// tarjetas «versus» a ancho completo, sin marcador (anti-spoiler). Tocar
/// una abre el escenario. Nada se reproduce solo desde aquí.
///
/// Sin `safeAreaInset` arriba: en el iPhone de verdad (iOS 26) la tira de
/// días metida ahí se pintaba como una banda vacía.
struct AgendaView: View {
    @Environment(AppModel.self) private var app
    @State private var vm: AgendaViewModel
    @State private var diaElegido: String?
    @State private var modoElegido: ModoAgenda?
    @State private var editandoGustos = false
    @State private var ahora = Date.now
    @AppStorage("es.ismaeloul.aceplayerneo.agenda.tarjetaCerrada") private var tarjetaCerrada = false

    init(entorno: Entorno) {
        _vm = State(initialValue: AgendaViewModel(entorno: entorno))
    }

    var body: some View {
        NavigationStack {
            contenido
                .navigationTitle("Agenda")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { IndicadorMotor() }
                }
                .refreshable {
                    await vm.refrescar()
                    await app.refrescarMarcadores()
                }
                .task { await vm.arrancar() }
                .task { await app.vigilarMarcadores() }
                .task { await pasarElReloj() }
                .task(id: clavePrecalentado) { precalentar() }
                .overlay(alignment: .bottom) {
                    avisoSinConexion.animation(Muelle.estandar, value: vm.fallo)
                }
                .sheet(isPresented: $editandoGustos) {
                    NavigationStack {
                        GustosView(enHoja: true) {
                            modoElegido = .paraTi
                            tarjetaCerrada = true
                        }
                    }
                }
        }
        .reservaMini()
        // Un solo háptico al abrir el escenario (antes cada tarjeta tenía el suyo y vibraban todas a la vez,
        // también al cerrarlo).
        .sensoryFeedback(.impact(weight: .light), trigger: app.escenario?.id) { _, nuevo in nuevo != nil }
        .onChange(of: vm.dias.map(\.date)) { _, fechas in
            if let elegido = diaElegido, fechas.contains(elegido) { return }
            diaElegido = AgendaViewModel.diaInicial(fechas)
        }
        .onChange(of: vm.agenda) { _, nueva in
            app.agendaCargada(nueva)
            if let nueva {
                let hoy = FormatoAgenda.clave(.now)
                app.precalentarEscudos(nueva.days.first { $0.date == hoy }?.matches ?? nueva.days.first?.matches ?? [])
            }
        }
    }

    // MARK: Datos

    private var reloj: RelojMadrid { RelojMadrid(ahora) }

    private var modo: ModoAgenda { ReglasAgenda.modoEfectivo(modoElegido, gustos: app.gustos) }

    private var hayGustos: Bool { ParaTi.tieneGustos(app.gustos) }

    private var diaActual: FootballDay? {
        let elegido = diaElegido ?? AgendaViewModel.diaInicial(vm.dias.map(\.date))
        return vm.dias.first { $0.date == elegido } ?? vm.dias.first
    }

    private var entradasDias: [EntradaDia] {
        vm.dias.map { dia in
            EntradaDia(fecha: dia.date, cuenta: ReglasAgenda.visibles(dia.matches, modo: modo, gustos: app.gustos).count)
        }
    }

    private var partidosDelDia: [FootballMatch] { diaActual?.matches ?? [] }

    private var visibles: [FootballMatch] {
        ReglasAgenda.visibles(partidosDelDia, modo: modo, gustos: app.gustos)
    }

    /// Los partidos de hoy (para la portada y el precalentado); si hoy no hay, los del día elegido.
    private var partidosDeHoy: [FootballMatch] {
        vm.dias.first { $0.date == reloj.fecha }?.matches ?? partidosDelDia
    }

    private var destacado: FootballMatch? {
        ReglasAgenda.destacado(
            partidosDeHoy, viendo: app.reproductor.canal?.partido?.id, reloj: reloj, marcadores: app.marcadores,
            gustos: app.gustos)
    }

    /// Cambia cada minuto y con el día: vuelve a mirar qué partidos precalentar.
    private var clavePrecalentado: String {
        "\(diaActual?.date ?? "")-\(reloj.fecha)-\(reloj.minutos)-\(vm.agenda?.generatedAt ?? "")"
    }

    /// Como la web: mientras las preferencias no digan que ya se personalizó.
    private var mostrarTarjeta: Bool {
        guard let preferencias = app.preferencias else { return false }
        return !preferencias.onboardingComplete && !tarjetaCerrada
    }

    // MARK: Contenido

    @ViewBuilder private var contenido: some View {
        if vm.agenda == nil && vm.cargando {
            esqueleto
        } else if vm.agenda == nil, let fallo = vm.fallo {
            ContentUnavailableView {
                Label("No se puede cargar la agenda", systemImage: "wifi.exclamationmark")
            } description: {
                Text(fallo)
            } actions: {
                Button("Reintentar") { Task { await vm.refrescar() } }
                    .botonOro()
            }
        } else if vm.dias.isEmpty {
            ContentUnavailableView(
                "No hay partidos", systemImage: "sportscourt",
                description: Text("La agenda está vacía. Tira hacia abajo para actualizar."))
        } else {
            lista
        }
    }

    private var esqueleto: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous)
                    .fill(Tinta.superficie)
                    .aspectRatio(16 / 9, contentMode: .fit)
                HStack(spacing: 8) {
                    ForEach(0..<4, id: \.self) { _ in
                        Capsule().fill(Tinta.superficie).frame(width: 86, height: 40)
                    }
                }
                ForEach(0..<2, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous)
                        .fill(Tinta.superficie)
                        .aspectRatio(16 / 9, contentMode: .fit)
                }
            }
            .padding(Medida.margen)
        }
        .redacted(reason: .placeholder)
        .disabled(true)
        .accessibilityLabel("Cargando la agenda")
    }

    private var lista: some View {
        let reloj = self.reloj
        let fases = ReglasAgenda.porFase(visibles, reloj: reloj, marcadores: app.marcadores)
        let gustos = app.gustos
        // Las cápsulas de señal releen los centros creados por el precalentado.
        _ = app.centrosVersion
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let destacado {
                    PortadaDestacado(partido: destacado, reloj: reloj, capsula: capsula(destacado, reloj: reloj))
                        .padding(.horizontal, Medida.margen)
                        .padding(.top, 4)
                        .id("portada-\(destacado.id)")
                }

                TiraDias(dias: entradasDias, elegido: diaActual?.date, ahora: ahora) { fecha in
                    withAnimation(Muelle.estandar) { diaElegido = fecha }
                }
                .padding(.top, 18)

                barraModo
                    .padding(.horizontal, Medida.margen)
                    .padding(.top, 10)

                if mostrarTarjeta {
                    TarjetaPersonalizar(
                        alPersonalizar: { editandoGustos = true },
                        alCerrar: { ahoraNo() })
                    .padding(.horizontal, Medida.margen)
                    .padding(.top, 14)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }

                if visibles.isEmpty {
                    vacioDelDia
                        .padding(.horizontal, Medida.margen)
                        .padding(.top, 28)
                } else {
                    seccion("En directo", fases.directo, reloj: reloj, gustos: gustos, directo: true)
                    seccion("Próximos", fases.proximos, reloj: reloj, gustos: gustos)
                    seccion("Terminados", fases.terminados, reloj: reloj, gustos: gustos)
                }

                pie
                    .padding(.horizontal, Medida.margen)
                    .padding(.top, 20)
            }
            .padding(.bottom, 24)
            .animation(Muelle.estandar, value: modo)
            .animation(Muelle.estandar, value: mostrarTarjeta)
        }
        .scrollIndicators(.automatic)
        .accessibilityIdentifier("lista-agenda")
    }

    @ViewBuilder
    private func seccion(_ titulo: String, _ partidos: [FootballMatch], reloj: RelojMadrid, gustos: GustosFutbol, directo: Bool = false)
        -> some View
    {
        if !partidos.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                CabeceraFila(titulo: titulo, cuenta: partidos.count, directo: directo)
                ForEach(partidos) { partido in
                    tarjeta(partido, reloj: reloj, gustos: gustos)
                }
            }
            .padding(.horizontal, Medida.margen)
            .padding(.top, 24)
        }
    }

    private func tarjeta(_ partido: FootballMatch, reloj: RelojMadrid, gustos: GustosFutbol) -> some View {
        let marcador = app.marcadores[partido.id]
        let estado = ReglasAgenda.estado(partido, reloj: reloj, marcador: marcador)
        let enPantalla = app.reproductor.canal?.partido?.id == partido.id
        return Button {
            app.abrirPartido(partido)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                TarjetaVersus(
                    partido: partido, marcador: marcador, enDirecto: estado?.fase == .directo,
                    capsula: capsula(partido, reloj: reloj), tuEquipo: ParaTi.destacado(partido, gustos),
                    enPantalla: enPantalla)
                PieVersus(partido: partido)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                app.verPartido(partido)
            } label: {
                Label("Ver ahora", systemImage: "play.fill")
            }
            Button {
                app.abrirPartido(partido)
            } label: {
                Label("Abrir el partido", systemImage: "sportscourt")
            }
        }
        .accessibilityHint("Abre el partido")
    }

    /// La cápsula de señal de una tarjeta: lo que sepa su centro (precalentado) o la regla sin sesión.
    private func capsula(_ partido: FootballMatch, reloj: RelojMadrid) -> CapsulaSenal? {
        ReglasSenal.capsula(
            marcador: app.marcadores[partido.id], faltan: ReglasAgenda.minutosParaPartido(partido, reloj: reloj),
            resumen: app.centroCargado(partido.id)?.resumen)
    }

    @ViewBuilder private var barraModo: some View {
        if hayGustos {
            HStack(spacing: 10) {
                Picker(
                    "Qué partidos ver",
                    selection: Binding(get: { modo }, set: { nuevo in withAnimation(Muelle.estandar) { modoElegido = nuevo } })
                ) {
                    Text("Para ti · \(ReglasAgenda.visibles(partidosDelDia, modo: .paraTi, gustos: app.gustos).count)")
                        .tag(ModoAgenda.paraTi)
                    Text("Todos · \(partidosDelDia.count)")
                        .tag(ModoAgenda.todos)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("selector-modo-agenda")

                botonGustos
            }
            .hapticoSeleccion(trigger: modo)
        } else if !mostrarTarjeta {
            HStack(spacing: 10) {
                Text("Todos los partidos · \(partidosDelDia.count)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Tinta.texto2)
                Spacer()
                Button {
                    editandoGustos = true
                } label: {
                    Label("Personalizar", systemImage: "star")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("boton-editar-gustos")
            }
        }
    }

    private var botonGustos: some View {
        Button {
            editandoGustos = true
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.body.weight(.semibold))
                .frame(width: 36, height: 30)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .accessibilityLabel("Editar mis gustos")
        .accessibilityIdentifier("boton-editar-gustos")
    }

    @ViewBuilder private var vacioDelDia: some View {
        if modo == .paraTi && hayGustos {
            EstadoVacio(
                icono: "star.slash", titulo: "Nada de lo tuyo este día",
                texto: "No hay partidos de tus ligas, equipos o selecciones. Puedes cambiar tus gustos o ver todos."
            ) {
                Button("Ver todos") { withAnimation(Muelle.estandar) { modoElegido = .todos } }
                    .botonOro()
                    .accessibilityIdentifier("boton-ver-todos")
                Button("Editar mis gustos") { editandoGustos = true }
                    .buttonStyle(.bordered)
            }
        } else {
            EstadoVacio(
                icono: "sportscourt", titulo: "Sin partidos anunciados",
                texto: "Este día no hay partidos en la agenda. Prueba con otro día o tira hacia abajo para actualizar."
            ) {
                if let siguiente = vm.dias.first(where: { $0.date > (diaActual?.date ?? "") }) {
                    Button("Ver el día siguiente") { withAnimation(Muelle.estandar) { diaElegido = siguiente.date } }
                        .buttonStyle(.bordered)
                }
            }
        }
    }

    private var pie: some View {
        HStack(spacing: 6) {
            Image(systemName: "info.circle")
            if let agenda = vm.agenda, !agenda.attribution.isEmpty {
                Text(agenda.attribution)
            }
            if let fecha = vm.actualizadaEn {
                Text("· actualizada \(fecha, style: .relative)")
            }
        }
        .font(.caption)
        .foregroundStyle(Tinta.texto3)
        .lineLimit(2)
        .accessibilityElement(children: .combine)
    }

    /// Píldora de cristal cuando se está enseñando la agenda guardada sin red.
    @ViewBuilder private var avisoSinConexion: some View {
        if vm.agenda != nil, vm.fallo != nil {
            HStack(spacing: 8) {
                Image(systemName: "icloud.slash")
                if let fecha = vm.actualizadaEn {
                    Text("Sin conexión · agenda de hace \(fecha, style: .relative)")
                } else {
                    Text("Sin conexión")
                }
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(Tinta.texto)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .cristal()
            .padding(.bottom, 12)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityIdentifier("aviso-sin-conexion")
        }
    }

    // MARK: Acciones

    /// Pide las fuentes de los partidos en directo o a menos de 45 min (cápsula «Señal»).
    private func precalentar() {
        guard vm.agenda != nil else { return }
        app.precalentar(ReglasAgenda.precalentables(partidosDeHoy, reloj: reloj, marcadores: app.marcadores))
    }

    private func ahoraNo() {
        withAnimation(Muelle.estandar) { tarjetaCerrada = true }
        Task {
            if await app.guardarGustos(app.gustos, completar: true) {
                app.avisos.mostrar(
                    hayGustos ? "Tu agenda ya está personalizada" : "Puedes personalizar tu agenda cuando quieras",
                    tono: .ok)
            }
        }
    }

    /// Las insignias «En 12 min» se mueven solas.
    private func pasarElReloj() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(30))
            ahora = .now
        }
    }
}

// MARK: - Portada

/// La cabecera de la agenda: la tarjeta «versus» grande del partido
/// destacado. Solo enseña vídeo si ESTE iPhone ya está reproduciendo ese
/// partido («Seguir viendo»); si no, la tarjeta con «Ver ahora», que es lo
/// único que arranca algo. Nunca reproduce solo.
struct PortadaDestacado: View {
    @Environment(AppModel.self) private var app
    let partido: FootballMatch
    let reloj: RelojMadrid
    let capsula: CapsulaSenal?

    private var marcador: LiveScore? { app.marcadores[partido.id] }
    private var estado: EstadoPartido? { ReglasAgenda.estado(partido, reloj: reloj, marcador: marcador) }
    private var enDirecto: Bool { estado?.fase == .directo }
    private var viendo: Bool {
        app.reproductor.canal?.partido?.id == partido.id && app.reproductor.conexion.enMarcha
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 7) {
                if enDirecto {
                    PuntoDirecto(tamano: 6)
                    Text("En directo")
                } else if estado?.fase == .terminado {
                    Text("Terminado")
                } else {
                    Image(systemName: "clock").font(.caption2.weight(.bold))
                    Text("Próximo")
                }
                Text("·")
                Text(partido.competition.isEmpty ? "Fútbol" : partido.competition)
                    .lineLimit(1)
            }
            .font(.antetitulo)
            .kerning(1.2)
            .textCase(.uppercase)
            .foregroundStyle(enDirecto ? Tinta.directo : Tinta.texto2)
            .accessibilityElement(children: .combine)

            Button {
                app.abrirPartido(partido)
            } label: {
                if viendo {
                    videoEnTarjeta
                } else {
                    TarjetaVersus(
                        partido: partido, marcador: marcador, enDirecto: enDirecto, capsula: capsula,
                        tuEquipo: ParaTi.destacado(partido, app.gustos), enPantalla: false)
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint("Abre el partido")

            HStack(alignment: .center, spacing: 12) {
                // El título también abre el partido (como la tarjeta): tocar el
                // nombre de los equipos y que no pasara nada confundía (UITests de la CI).
                Button {
                    app.abrirPartido(partido)
                } label: {
                    PieVersus(partido: partido)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Abre el partido")
                botonPrincipal
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("portada")
    }

    /// La imagen viva dentro de la tarjeta (solo si ya suena aquí): mientras
    /// está a la vista, el mini se esconde (el escenario es una sola superficie).
    private var videoEnTarjeta: some View {
        ZStack {
            VideoApp(prioridad: .integrado)
            VStack {
                HStack {
                    CapsulaPalco(
                        texto: FormatoAgenda.chipHora(partido, marcador: marcador, enDirecto: enDirecto),
                        tono: enDirecto ? .directo : .neutro, punto: enDirecto, sobreImagen: true)
                    Spacer()
                }
                Spacer()
                HStack {
                    Spacer()
                    CapsulaPalco(texto: "En pantalla", tono: .oro, icono: "waveform", sobreImagen: true)
                }
            }
            .padding(12)
            .allowsHitTesting(false)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
        .onAppear { app.reproductor.superficieGrande(visible: true) }
        .onDisappear { app.reproductor.superficieGrande(visible: false) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(FormatoAgenda.equipos(partido)), en pantalla")
        .accessibilityIdentifier("portada-video")
    }

    @ViewBuilder private var botonPrincipal: some View {
        if viendo {
            Button {
                app.abrirPartido(partido)
            } label: {
                Label("Seguir viendo", systemImage: "play.fill")
                    .font(.subheadline.weight(.bold))
                    .frame(minHeight: Medida.toque)
            }
            .botonOro()
            .accessibilityIdentifier("boton-ver-ahora")
        } else if enDirecto {
            Button {
                app.verPartido(partido)
            } label: {
                Label("Ver ahora", systemImage: "play.fill")
                    .font(.subheadline.weight(.bold))
                    .frame(minHeight: Medida.toque)
            }
            .botonOro()
            .accessibilityIdentifier("boton-ver-ahora")
        } else {
            Button {
                app.abrirPartido(partido)
            } label: {
                Label("Ver el partido", systemImage: "sportscourt")
                    .font(.subheadline.weight(.bold))
                    .frame(minHeight: Medida.toque)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
        }
    }
}

// MARK: - Tira de días

/// Un día de la tira: su fecha y cuántos partidos se ven con el filtro.
struct EntradaDia: Identifiable, Hashable {
    var fecha: String
    var cuenta: Int
    var id: String { fecha }
}

/// Días de la agenda en píldoras que se desplazan en horizontal; la gota de
/// oro del elegido se desliza de una a otra. Va DENTRO del contenido de la
/// agenda (nada de barras propias encima de la lista).
struct TiraDias: View {
    let dias: [EntradaDia]
    let elegido: String?
    var ahora: Date = .now
    let alElegir: (String) -> Void
    @Namespace private var gota

    var body: some View {
        ScrollViewReader { lector in
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(dias) { dia in
                        boton(dia)
                            .id(dia.fecha)
                    }
                }
                .padding(.horizontal, Medida.margen)
                .padding(.vertical, 6)
            }
            .scrollIndicators(.hidden)
            .onAppear {
                guard let elegido, let indice = dias.firstIndex(where: { $0.fecha == elegido }), indice > 2 else { return }
                lector.scrollTo(elegido, anchor: .center)
            }
            .onChange(of: elegido) { _, nuevo in
                guard let nuevo else { return }
                withAnimation(Muelle.estandar) { lector.scrollTo(nuevo, anchor: .center) }
            }
        }
        .hapticoSeleccion(trigger: elegido)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Días")
        .accessibilityIdentifier("tira-dias")
    }

    private func boton(_ dia: EntradaDia) -> some View {
        let esElegido = dia.fecha == elegido
        let partes = FormatoAgenda.partesDia(dia.fecha, ahora: ahora)
        return Button {
            alElegir(dia.fecha)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(partes.arriba)
                    .font(.subheadline.weight(.bold))
                Text(partes.numero)
                    .font(.subheadline.weight(.bold).monospacedDigit())
                Text("· \(dia.cuenta)")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .opacity(0.75)
            }
            .foregroundStyle(esElegido ? Tinta.sobreAcento : Tinta.texto)
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            .background {
                if esElegido {
                    Capsule()
                        .fill(Tinta.oro)
                        .matchedGeometryEffect(id: "gota", in: gota)
                } else {
                    Capsule().fill(Tinta.superficie)
                }
            }
            .overlay {
                Capsule().strokeBorder(esElegido ? Tinta.acentoBorde : Tinta.linea, lineWidth: 1)
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(FormatoAgenda.etiqueta(dia: dia.fecha, ahora: ahora)), \(FormatoAgenda.partidos(dia.cuenta))")
        .accessibilityAddTraits(esElegido ? [.isSelected] : [])
        .accessibilityIdentifier("dia-\(dia.fecha)")
    }
}

// MARK: - Personalizar

/// Tarjeta de primer uso (la de la web): no bloquea, la agenda sigue debajo.
struct TarjetaPersonalizar: View {
    let alPersonalizar: () -> Void
    let alCerrar: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "star")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Tinta.acentoTinta)
                .frame(width: 44, height: 44)
                .background(Tinta.oro.opacity(0.18), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text("Personaliza tu agenda")
                    .font(.headline)
                    .foregroundStyle(Tinta.texto)
                    .accessibilityAddTraits(.isHeader)
                Text("Dinos tus ligas y equipos y la agenda resaltará lo tuyo. Mientras tanto ves todos los partidos.")
                    .font(.subheadline)
                    .foregroundStyle(Tinta.texto2)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    Button("Ahora no", action: alCerrar)
                        .buttonStyle(.borderless)
                        .foregroundStyle(Tinta.texto2)
                    Button("Personalizar", action: alPersonalizar)
                        .botonOro()
                        .accessibilityIdentifier("boton-personalizar")
                }
                .font(.subheadline.weight(.semibold))
                .padding(.top, 4)
            }
        }
        .padding(16)
        .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous)
                .strokeBorder(Tinta.acentoBorde.opacity(0.5), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tarjeta-personalizar")
    }
}

extension FootballMatch {
    /// Partido de relleno para los esqueletos de carga.
    static let muestra = FootballMatch(
        id: "muestra", date: "2026-01-01", time: "21:00", start: nil, title: "Equipo local - Equipo visitante",
        home: "Equipo local", away: "Equipo visitante", competition: "Competición", country: "",
        channels: [FootballChannelRef(id: "canal", name: "Canal")])
}
