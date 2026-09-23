import SwiftUI

/// Agenda: tira de días con scroll, partidos agrupados por liga, tirar para
/// actualizar, el anillo del minuto en los que van en directo y estados de
/// carga, vacío y error.
struct AgendaView: View {
    @Environment(AppModel.self) private var app
    @State private var vm: AgendaViewModel
    @State private var ruta: [FootballMatch] = []
    @State private var diaElegido: String?
    @Namespace private var zoom
    @Namespace private var mini

    init(entorno: Entorno) {
        _vm = State(initialValue: AgendaViewModel(entorno: entorno))
    }

    var body: some View {
        NavigationStack(path: $ruta) {
            contenido
                .navigationTitle("Agenda")
                .background(Tinta.fondo.ignoresSafeArea())
                .scrollContentBackground(.hidden)
                .refreshable {
                    await vm.refrescar()
                    await app.refrescarMarcadores()
                }
                .task { await vm.arrancar() }
                .task { await app.vigilarMarcadores() }
                // La animación solo para la píldora (antes animaba también el
                // cambio de la carga a la lista entera).
                .overlay(alignment: .bottom) {
                    avisoSinConexion.animation(Muelle.estandar, value: vm.fallo)
                }
                .navigationDestination(for: FootballMatch.self) { partido in
                    CentroPartidoView(modelo: app.centro(para: partido))
                        .destinoZoom(partido.id, en: zoom)
                }
        }
        .conMiniReproductor(app, espacio: mini)
        .onChange(of: vm.dias.map(\.date)) { _, fechas in
            if let elegido = diaElegido, fechas.contains(elegido) { return }
            diaElegido = AgendaViewModel.diaInicial(fechas)
        }
    }

    private var diaActual: FootballDay? {
        let elegido = diaElegido ?? AgendaViewModel.diaInicial(vm.dias.map(\.date))
        return vm.dias.first { $0.date == elegido } ?? vm.dias.first
    }

    @ViewBuilder private var contenido: some View {
        if vm.agenda == nil && vm.cargando {
            List {
                ForEach(0..<6, id: \.self) { _ in
                    FilaPartido(partido: .muestra, marcador: nil)
                        .listRowBackground(Tinta.superficie)
                }
            }
            .redacted(reason: .placeholder)
            .disabled(true)
            .accessibilityLabel("Cargando la agenda")
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

    private var lista: some View {
        List {
            if let dia = diaActual {
                ForEach(AgendaViewModel.porLiga(dia.matches), id: \.competicion) { grupo in
                    Section {
                        ForEach(grupo.partidos) { partido in
                            NavigationLink(value: partido) {
                                FilaPartido(partido: partido, marcador: app.marcadores[partido.id])
                            }
                            .origenZoom(partido.id, en: zoom)
                            .listRowBackground(Tinta.superficie)
                        }
                    } header: {
                        CabeceraLiga(nombre: grupo.competicion, pais: grupo.pais)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .safeAreaInset(edge: .top, spacing: 0) {
            TiraDias(dias: vm.dias, elegido: diaActual?.date) { fecha in
                withAnimation(Muelle.estandar) { diaElegido = fecha }
            }
        }
        .accessibilityIdentifier("lista-agenda")
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
}

// MARK: - Tira de días

/// Días de la agenda en horizontal; la gota del elegido se desliza de uno a otro.
struct TiraDias: View {
    let dias: [FootballDay]
    let elegido: String?
    let alElegir: (String) -> Void
    @Namespace private var gota

    var body: some View {
        ScrollViewReader { lector in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(dias) { dia in
                        boton(dia)
                            .id(dia.date)
                    }
                }
                .padding(.horizontal, Medida.margen)
                .padding(.vertical, 8)
            }
            .onAppear {
                // Solo si el día elegido no cabe a la vista (hoy suele ser el
                // primero), y tras la primera maquetación: sin desplazar una
                // tira que aún no se ha medido.
                guard let elegido, let indice = dias.firstIndex(where: { $0.date == elegido }), indice > 3 else {
                    return
                }
                Task { @MainActor in
                    await Task.yield()
                    lector.scrollTo(elegido, anchor: .center)
                }
            }
            .onChange(of: elegido) { _, nuevo in
                guard let nuevo else { return }
                // Lo justo para que se vea (sin ancla): el que se toca ya está a la vista.
                withAnimation(Muelle.estandar) { lector.scrollTo(nuevo) }
            }
        }
        // Fondo opaco y solo detrás de la tira (si se extendiera hacia arriba
        // taparía el título grande). Con el material `.bar`, en la app de verdad
        // recién emparejada (E2E de la CI) los días quedaban sin pintar aunque
        // estaban ahí y respondían al toque.
        .background(Tinta.superficie, ignoresSafeAreaEdges: [])
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Días")
    }

    private func boton(_ dia: FootballDay) -> some View {
        let esElegido = dia.date == elegido
        let partes = FormatoAgenda.partesDia(dia.date)
        return Button {
            alElegir(dia.date)
        } label: {
            VStack(spacing: 2) {
                Text(partes.arriba)
                    .font(.caption2.weight(.semibold))
                    .textCase(.uppercase)
                Text(partes.numero)
                    .font(.numeros(.title3, peso: .bold))
                Text("\(dia.matches.count)")
                    .font(.caption2.monospacedDigit())
                    .opacity(0.7)
            }
            .foregroundStyle(esElegido ? Tinta.sobreAcento : Tinta.texto)
            .frame(minWidth: 52, minHeight: 64)
            .padding(.horizontal, 4)
            .background {
                if esElegido {
                    RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous)
                        .fill(Tinta.acento)
                        .matchedGeometryEffect(id: "gota", in: gota)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(FormatoAgenda.etiqueta(dia: dia.date)), \(dia.matches.count) partidos")
        .accessibilityAddTraits(esElegido ? [.isSelected] : [])
        .accessibilityIdentifier("dia-\(dia.date)")
    }
}

/// Cabecera de una liga dentro del día.
struct CabeceraLiga: View {
    let nombre: String
    let pais: String

    var body: some View {
        HStack(spacing: 6) {
            Text(nombre.isEmpty ? "Otros" : nombre)
                .font(.headline)
                .foregroundStyle(Tinta.texto)
            if !pais.isEmpty {
                Text(pais)
                    .font(.caption)
                    .foregroundStyle(Tinta.texto3)
            }
        }
        .textCase(nil)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Fila de partido

/// Una fila de partido: hora (o anillo del minuto) a la izquierda, equipos
/// con su marca y, si hay, el marcador.
struct FilaPartido: View {
    let partido: FootballMatch
    let marcador: LiveScore?

    private var enDirecto: Bool { marcador?.state == "in" }

    var body: some View {
        HStack(spacing: 14) {
            Group {
                if enDirecto {
                    AnilloDirecto(minuto: marcador.flatMap(Marcador.minuto), tamano: 44)
                } else {
                    Text(partido.time)
                        .font(.numeros(.title3))
                        .foregroundStyle(marcador?.state == "post" ? Tinta.texto3 : Tinta.acentoTinta)
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                }
            }
            .frame(width: 52, alignment: .leading)

            VStack(alignment: .leading, spacing: 6) {
                if partido.away.isEmpty {
                    Text(partido.title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Tinta.texto)
                } else {
                    filaEquipo(partido.home, goles: marcador?.home)
                    filaEquipo(partido.away, goles: marcador?.away)
                }
                if !partido.channels.isEmpty {
                    Text(partido.channels.map(\.name).joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Tinta.texto2)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: Medida.toque)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(etiquetaAccesible)
    }

    private func filaEquipo(_ nombre: String, goles: Int?) -> some View {
        HStack(spacing: 8) {
            MarcaEquipo(nombre, tamano: 22)
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
        }
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
