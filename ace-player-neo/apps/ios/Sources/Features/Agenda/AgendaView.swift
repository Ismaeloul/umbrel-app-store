import SwiftUI

/// Agenda: el título grande arriba y, dentro del contenido que se desplaza,
/// la tira de días, «Para ti / Todos» (con tus gustos, las mismas reglas que
/// la web), la tarjeta para personalizarla y los partidos por competición en
/// tarjetas. Tirar para actualizar, el anillo del minuto en los que van en
/// directo y estados de carga, vacío y error.
///
/// Sin `safeAreaInset` arriba: en el iPhone de verdad (iOS 26) la tira de
/// días metida ahí se pintaba como una banda blanca vacía.
struct AgendaView: View {
    @Environment(AppModel.self) private var app
    @State private var vm: AgendaViewModel
    @State private var ruta: [FootballMatch] = []
    @State private var diaElegido: String?
    @State private var modoElegido: ModoAgenda?
    @State private var editandoGustos = false
    @State private var ahora = Date.now
    @AppStorage("es.ismaeloul.aceplayerneo.agenda.tarjetaCerrada") private var tarjetaCerrada = false
    @Namespace private var zoom

    init(entorno: Entorno) {
        _vm = State(initialValue: AgendaViewModel(entorno: entorno))
    }

    var body: some View {
        NavigationStack(path: $ruta) {
            contenido
                .navigationTitle("Agenda")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { IndicadorMotor() }
                }
                .background(Tinta.fondo.ignoresSafeArea())
                .refreshable {
                    await vm.refrescar()
                    await app.refrescarMarcadores()
                }
                .task { await vm.arrancar() }
                .task { await app.vigilarMarcadores() }
                .task { await pasarElReloj() }
                .overlay(alignment: .bottom) {
                    avisoSinConexion.animation(Muelle.estandar, value: vm.fallo)
                }
                .navigationDestination(for: FootballMatch.self) { partido in
                    CentroPartidoView(modelo: app.centro(para: partido))
                        .destinoZoom(partido.id, en: zoom)
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
        .onChange(of: vm.dias.map(\.date)) { _, fechas in
            if let elegido = diaElegido, fechas.contains(elegido) { return }
            diaElegido = AgendaViewModel.diaInicial(fechas)
        }
        .onChange(of: vm.agenda) { _, nueva in app.agendaCargada(nueva) }
    }

    // MARK: Datos

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
                    .buttonStyle(.borderedProminent)
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
                HStack(spacing: 8) {
                    ForEach(0..<4, id: \.self) { _ in
                        Capsule().fill(Tinta.superficie).frame(width: 86, height: 40)
                    }
                }
                ForEach(0..<2, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Competición").font(.title3.weight(.bold))
                        VStack(spacing: 0) {
                            ForEach(0..<3, id: \.self) { _ in
                                FilaPartido(partido: .muestra, marcador: nil, estado: nil, destacado: false)
                                    .padding(14)
                            }
                        }
                        .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous))
                    }
                }
            }
            .padding(Medida.margen)
        }
        .redacted(reason: .placeholder)
        .disabled(true)
        .accessibilityLabel("Cargando la agenda")
    }

    private var lista: some View {
        let reloj = RelojMadrid(ahora)
        let grupos = ReglasAgenda.porCompeticion(visibles, reloj: reloj, marcadores: app.marcadores)
        let gustos = app.gustos
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                TiraDias(dias: entradasDias, elegido: diaActual?.date, ahora: ahora) { fecha in
                    withAnimation(Muelle.estandar) { diaElegido = fecha }
                }
                .padding(.top, 2)

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
                    ForEach(grupos) { grupo in
                        SeccionLiga(grupo: grupo, reloj: reloj, gustos: gustos, zoom: zoom)
                            .padding(.horizontal, Medida.margen)
                            .padding(.top, 22)
                    }
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
            .sensoryFeedback(.selection, trigger: modo)
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
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("boton-ver-todos")
                Button("Editar mis gustos") { editandoGustos = true }
                    .buttonStyle(.bordered)
            }
        } else {
            EstadoVacio(
                icono: "sportscourt", titulo: "Sin partidos anunciados",
                texto: "Este día no hay partidos en la agenda. Prueba con otro día o tira hacia abajo para actualizar."
            ) {
                EmptyView()
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

// MARK: - Tira de días

/// Un día de la tira: su fecha y cuántos partidos se ven con el filtro.
struct EntradaDia: Identifiable, Hashable {
    var fecha: String
    var cuenta: Int
    var id: String { fecha }
}

/// Días de la agenda en píldoras que se desplazan en horizontal; la gota del
/// elegido se desliza de una a otra. Va DENTRO del contenido de la agenda
/// (nada de barras propias encima de la lista).
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
        .sensoryFeedback(.selection, trigger: elegido)
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
                        .fill(Tinta.acento)
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
                .background(Tinta.acento.opacity(0.22), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text("Personaliza tu agenda")
                    .font(.headline)
                    .foregroundStyle(Tinta.texto)
                    .accessibilityAddTraits(.isHeader)
                Text("Dinos tus ligas y equipos y la agenda pondrá primero lo tuyo. Mientras tanto ves todos los partidos.")
                    .font(.subheadline)
                    .foregroundStyle(Tinta.texto2)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    Button("Ahora no", action: alCerrar)
                        .buttonStyle(.borderless)
                        .foregroundStyle(Tinta.texto2)
                    Button("Personalizar", action: alPersonalizar)
                        .buttonStyle(.borderedProminent)
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
                .strokeBorder(Tinta.acentoBorde.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tarjeta-personalizar")
    }
}

// MARK: - Competición

/// Un bloque de la agenda: el nombre de la competición con su recuento y
/// una tarjeta con sus partidos.
struct SeccionLiga: View {
    @Environment(AppModel.self) private var app
    let grupo: GrupoLiga
    let reloj: RelojMadrid
    let gustos: GustosFutbol
    let zoom: Namespace.ID

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(grupo.competicion)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Tinta.texto)
                    .lineLimit(2)
                Text(FormatoAgenda.partidos(grupo.partidos.count))
                    .font(.subheadline)
                    .foregroundStyle(Tinta.texto3)
            }
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            VStack(spacing: 0) {
                ForEach(Array(grupo.partidos.enumerated()), id: \.element.id) { indice, partido in
                    if indice > 0 {
                        Divider().padding(.leading, 86)
                    }
                    NavigationLink(value: partido) {
                        FilaPartido(
                            partido: partido, marcador: app.marcadores[partido.id],
                            estado: ReglasAgenda.estado(partido, reloj: reloj, marcador: app.marcadores[partido.id]),
                            destacado: ParaTi.destacado(partido, gustos)
                        )
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(EstiloFilaPulsada())
                    .origenZoom(partido.id, en: zoom)
                }
            }
            .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous))
        }
    }
}

// MARK: - Fila de partido

/// Una fila de partido: la hora (o el anillo del minuto) con «En 3 h 16 min»
/// debajo, los equipos con su marca y marcador, y los canales.
struct FilaPartido: View {
    let partido: FootballMatch
    let marcador: LiveScore?
    let estado: EstadoPartido?
    let destacado: Bool

    private var enDirecto: Bool { marcador?.state == "in" }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                if enDirecto {
                    AnilloDirecto(minuto: marcador.flatMap(Marcador.minuto), tamano: 44)
                } else {
                    Text(partido.time)
                        .font(.numeros(.title2, peso: .bold))
                        .foregroundStyle(estado?.fase == .terminado ? Tinta.texto3 : Tinta.texto)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    if let estado {
                        Text(estado.texto)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(estado.fase == .directo ? Tinta.acentoTinta : Tinta.texto2)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .frame(width: 62, alignment: .leading)

            VStack(alignment: .leading, spacing: 6) {
                if partido.away.isEmpty {
                    Text(partido.title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Tinta.texto)
                        .lineLimit(2)
                } else {
                    filaEquipo(partido.home, goles: marcador?.home)
                    filaEquipo(partido.away, goles: marcador?.away)
                }
                if !partido.channels.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(partido.channels.prefix(2)) { canal in
                            Label(canal.name, systemImage: "tv")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(Tinta.texto2)
                                .lineLimit(1)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .overlay(Capsule().strokeBorder(Tinta.linea, lineWidth: 1))
                        }
                        if partido.channels.count > 2 {
                            Text("+\(partido.channels.count - 2)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Tinta.texto3)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if destacado {
                Image(systemName: "star.fill")
                    .font(.footnote)
                    .foregroundStyle(Tinta.acentoTinta)
                    .accessibilityHidden(true)
            }
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Tinta.texto3)
                .accessibilityHidden(true)
        }
        .frame(minHeight: Medida.toque)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(etiquetaAccesible)
        .accessibilityAddTraits(.isButton)
    }

    private func filaEquipo(_ nombre: String, goles: Int?) -> some View {
        HStack(spacing: 8) {
            MarcaEquipo(nombre, tamano: 24)
            Text(nombre)
                .font(.body.weight(.semibold))
                .foregroundStyle(Tinta.texto)
                .lineLimit(1)
            Spacer(minLength: 4)
            if let goles, marcador?.state != "pre" {
                Text("\(goles)")
                    .font(.numeros(.body, peso: .bold))
                    .foregroundStyle(Tinta.texto)
                    .contentTransition(.numericText())
            }
        }
    }

    private var etiquetaAccesible: String {
        var partes = [FormatoAgenda.equipos(partido)]
        if let marcador, marcador.state != "pre" {
            partes.append("\(marcador.home) a \(marcador.away)")
        }
        if enDirecto {
            partes.append(marcador.flatMap(Marcador.minuto).map { "en directo, minuto \($0)" } ?? "en directo")
        } else {
            partes.append("a las \(partido.time)")
            if let estado { partes.append(estado.texto.lowercased()) }
        }
        if destacado { partes.append("tu equipo") }
        partes.append(FormatoAgenda.detalle(partido))
        return partes.joined(separator: ", ")
    }
}

/// Lectura del marcador de ESPN.
enum Marcador {
    /// «54'» o «45'+2'» → 54 / 45.
    static func minuto(_ marcador: LiveScore) -> Int? {
        let cifras = marcador.clock.prefix { $0.isNumber }
        return Int(cifras)
    }

    /// Progreso del partido (0…1) para la barra de la cabecera.
    static func progreso(_ marcador: LiveScore?, inicio: Date?, ahora: Date = .now) -> Double {
        switch marcador?.state {
        case "post": return 1
        case "in": return min(1, Double(marcador.flatMap(minuto) ?? 1) / 90)
        default:
            guard let inicio, ahora > inicio else { return 0 }
            return min(1, ahora.timeIntervalSince(inicio) / (105 * 60))
        }
    }
}

extension FootballMatch {
    /// Partido de relleno para el esqueleto de carga.
    static let muestra = FootballMatch(
        id: "muestra", date: "2026-01-01", time: "21:00", start: nil, title: "Equipo local - Equipo visitante",
        home: "Equipo local", away: "Equipo visitante", competition: "Competición", country: "",
        channels: [FootballChannelRef(id: "canal", name: "Canal")])
}
