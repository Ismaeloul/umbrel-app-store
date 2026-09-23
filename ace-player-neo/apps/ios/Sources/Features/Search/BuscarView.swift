import Observation
import SwiftUI

/// Búsqueda en el motor AceStream (`GET search?q=`): con espera de 450 ms
/// mientras se escribe y cancelando la anterior.
@MainActor
@Observable
final class BuscarModelo {
    private(set) var resultados: [SearchResult] = []
    private(set) var buscando = false
    private(set) var fallo: String?
    private(set) var buscado = ""

    private let entorno: Entorno

    init(entorno: Entorno) {
        self.entorno = entorno
    }

    /// Busca `texto` (vacío = limpia). Pensado para `.task(id:)`, que cancela la anterior.
    func buscar(_ texto: String, esperar: Bool = true) async {
        let consulta = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        guard consulta.count >= 2 else {
            resultados = []
            fallo = nil
            buscado = ""
            buscando = false
            return
        }
        if esperar {
            try? await Task.sleep(for: .milliseconds(450))
            if Task.isCancelled { return }
        }
        buscando = true
        defer { buscando = false }
        do {
            let respuesta = try await entorno.api.enviar(API.buscar(consulta))
            guard !Task.isCancelled else { return }
            resultados = respuesta.results
            buscado = consulta
            fallo = nil
        } catch {
            let convertido = APIError.desde(error)
            if case .cancelado = convertido { return }
            fallo = convertido.mensaje
        }
    }
}

/// Buscar, como la web: mientras se escribe, lo que ya tienes («En tu
/// biblioteca», al instante, con lo que emite cada canal hoy) y, debajo, lo
/// que encuentra el motor («En el motor AceStream», con su disponibilidad).
struct BuscarView: View {
    @Environment(AppModel.self) private var app
    @State private var vm: BuscarModelo
    @State private var texto = ""
    @State private var antena = IndiceAntena.vacio

    init(entorno: Entorno) {
        _vm = State(initialValue: BuscarModelo(entorno: entorno))
    }

    var body: some View {
        NavigationStack {
            contenido
                .navigationTitle("Buscar")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { IndicadorMotor() }
                }
                .background(Tinta.fondo.ignoresSafeArea())
                .scrollContentBackground(.hidden)
                .searchable(
                    text: $texto, placement: .navigationBarDrawer(displayMode: .always),
                    prompt: "Canal, partido o competición")
                .onSubmit(of: .search) { Task { await vm.buscar(texto, esperar: false) } }
                .task(id: texto) { await vm.buscar(texto) }
                .task(id: app.agenda?.generatedAt) {
                    await app.cargarAgendaGuardada()
                    antena = IndiceAntena(agenda: app.agenda, reloj: RelojMadrid(.now))
                }
        }
        .reservaMini()
    }

    /// Lo de tu biblioteca que casa con lo escrito (sin repetir un mismo canal).
    private var locales: [Item] {
        let consulta = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !consulta.isEmpty, let biblioteca = app.biblioteca else { return [] }
        var vistos = Set<String>()
        let todos = (biblioteca.favorites + biblioteca.history + biblioteca.web).filter {
            vistos.insert($0.id.lowercased()).inserted
        }
        return Array(ReglasBiblioteca.filtrar(todos, texto: consulta).prefix(25))
    }

    @ViewBuilder private var contenido: some View {
        let propios = locales
        if texto.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && vm.buscado.isEmpty {
            ContentUnavailableView(
                "Busca un canal", systemImage: "magnifyingglass",
                description: Text("En tu biblioteca, al instante, y en la red AceStream."))
        } else {
            List {
                if !propios.isEmpty {
                    Section {
                        ForEach(propios) { item in filaLocal(item, en: propios) }
                    } header: {
                        cabecera("En tu biblioteca", cuenta: propios.count)
                    }
                }
                Section {
                    motor
                } header: {
                    cabecera("En el motor AceStream", cuenta: vm.resultados.isEmpty ? nil : vm.resultados.count)
                }
            }
            .listStyle(.insetGrouped)
            .accessibilityIdentifier("lista-resultados")
        }
    }

    private func cabecera(_ titulo: String, cuenta: Int?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(titulo)
                .font(.headline)
                .foregroundStyle(Tinta.texto)
            if let cuenta {
                Text("\(cuenta)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Tinta.texto3)
            }
        }
        .textCase(nil)
        .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private var motor: some View {
        if vm.buscando && vm.resultados.isEmpty {
            ForEach(0..<3, id: \.self) { _ in
                FilaResultado(resultado: SearchResult.muestra)
                    .listRowBackground(Tinta.superficie)
                    .redacted(reason: .placeholder)
            }
        } else if let fallo = vm.fallo {
            VStack(alignment: .leading, spacing: 8) {
                Label(fallo, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(Tinta.falloTinta)
                Button("Reintentar") { Task { await vm.buscar(texto, esperar: false) } }
                    .buttonStyle(.bordered)
            }
            .padding(.vertical, 4)
            .listRowBackground(Tinta.superficie)
        } else if vm.buscado.isEmpty {
            Text("Escribe al menos 2 letras para buscar en la red AceStream.")
                .font(.subheadline)
                .foregroundStyle(Tinta.texto2)
                .listRowBackground(Tinta.superficie)
        } else if vm.resultados.isEmpty {
            Text("El motor no encuentra nada con «\(vm.buscado)».")
                .font(.subheadline)
                .foregroundStyle(Tinta.texto2)
                .listRowBackground(Tinta.superficie)
        } else {
            ForEach(vm.resultados) { resultado in
                Button {
                    abrir(resultado)
                } label: {
                    FilaResultado(resultado: resultado)
                }
                .foregroundStyle(Tinta.texto)
                .listRowBackground(Tinta.superficie)
                .swipeActions(edge: .leading) {
                    Button {
                        Task { await app.alternarFavorito(id: resultado.id, titulo: resultado.title, ih: resultado.ih) }
                    } label: {
                        Label(app.esFavorito(resultado.id) ? "Quitar" : "Favorito", systemImage: "star")
                    }
                    .tint(Tinta.acento)
                }
                .contextMenu {
                    Button {
                        Task { await app.alternarFavorito(id: resultado.id, titulo: resultado.title, ih: resultado.ih) }
                    } label: {
                        Label(
                            app.esFavorito(resultado.id) ? "Quitar de favoritos" : "Añadir a favoritos",
                            systemImage: "star")
                    }
                }
            }
        }
    }

    private func filaLocal(_ item: Item, en lista: [Item]) -> some View {
        Button {
            abrirLocal(item, en: lista)
        } label: {
            FilaCanal(
                item: item,
                favorito: app.esFavorito(item.id),
                antena: antena.para(titulo: item.title, alias: item.alias, marcadores: app.marcadores),
                subtitulo: ReglasBiblioteca.subtitulo(item, seccion: item.type == .web ? .listas : .favoritos),
                caido: false)
        }
        .foregroundStyle(Tinta.texto)
        .listRowBackground(Tinta.superficie)
    }

    private func canalDe(resultado: SearchResult) -> CanalReproducible {
        CanalReproducible(id: resultado.id, titulo: resultado.title, ih: resultado.ih, origen: "acestream")
    }

    private func canalDe(item: Item) -> CanalReproducible {
        CanalReproducible(
            id: item.id, titulo: item.title, ih: item.ih,
            listaId: item.type == .web ? app.biblioteca?.activeWebSourceId : nil,
            origen: item.type == .web ? "m3u" : (item.type == .fav ? "favorites" : "history"))
    }

    /// Reproduce y abre el reproductor grande (deslizando hacia abajo se queda en el mini).
    private func abrir(_ resultado: SearchResult) {
        app.reproducirCanal(canalDe(resultado: resultado), lista: vm.resultados.map { canalDe(resultado: $0) })
        withAnimation(Muelle.heroe) { app.reproductor.expandir() }
    }

    private func abrirLocal(_ item: Item, en lista: [Item]) {
        app.reproducirCanal(canalDe(item: item), lista: lista.map { canalDe(item: $0) })
        withAnimation(Muelle.heroe) { app.reproductor.expandir() }
    }
}

/// Un resultado de la búsqueda con su disponibilidad.
struct FilaResultado: View {
    let resultado: SearchResult

    var body: some View {
        let porcentaje = ReglasFuentes.porcentaje(resultado.availability)
        HStack(spacing: 12) {
            LogoCanal(titulo: resultado.title, tamano: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(resultado.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Tinta.texto)
                    .lineLimit(2)
                if !resultado.category.isEmpty {
                    Text(resultado.category)
                        .font(.caption)
                        .foregroundStyle(Tinta.texto2)
                }
            }
            Spacer(minLength: 4)
            if let porcentaje {
                let estado: EstadoSenal = porcentaje >= 60 ? .ok : (porcentaje > 0 ? .floja : .sinSenal)
                MedidorSenal(estado, palabra: "\(porcentaje)%")
            }
        }
        .frame(minHeight: Medida.toque)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            porcentaje.map { "\(resultado.title), \($0) por ciento disponible" } ?? resultado.title)
        .accessibilityAddTraits(.isButton)
    }
}

extension SearchResult {
    static let muestra = SearchResult(
        id: "0000000000000000000000000000000000000000", title: "Canal de ejemplo HD", category: "Deportes",
        availability: 0.8, bitrate: nil, ih: true)
}
