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
        guard consulta.count >= 2, ReglasFuentes.hashValido(consulta) == nil else {
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

/// Buscar: mientras se escribe, lo que ya tienes («En tu biblioteca», al
/// instante, con lo que emite cada canal hoy) y, debajo, lo que encuentra el
/// motor («En el motor», con su disponibilidad). Un Content ID o enlace
/// `acestream://` pegado se detecta y se reproduce como canal suelto, sin guardarlo.
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
                .searchable(
                    text: $texto, placement: .navigationBarDrawer(displayMode: .always),
                    prompt: "Canal, partido o pega un enlace")
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

    private var enlacePegado: String? { ReglasFuentes.hashValido(texto) }

    @ViewBuilder private var contenido: some View {
        let propios = locales
        if let hash = enlacePegado {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Enlace detectado", systemImage: "link")
                            .font(.headline)
                            .foregroundStyle(Tinta.okTinta)
                        Text("Se reproduce como señal externa, sin guardarla en recientes.")
                            .font(.subheadline)
                            .foregroundStyle(Tinta.texto2)
                        Button {
                            app.reproducirEnlace(hash)
                        } label: {
                            Label("Reproducir", systemImage: "play.fill")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: Medida.toque)
                        }
                        .botonOro()
                        .accessibilityIdentifier("boton-reproducir-enlace")
                    }
                    .padding(.vertical, 6)
                }
            }
            .listStyle(.insetGrouped)
            .accessibilityIdentifier("enlace-detectado")
        } else if texto.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && vm.buscado.isEmpty {
            ContentUnavailableView(
                "Busca un canal", systemImage: "magnifyingglass",
                description: Text("En tus canales, al instante, y en el motor AceStream. También puedes pegar un enlace."))
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
                    cabecera("En el motor", cuenta: vm.resultados.isEmpty ? nil : vm.resultados.count)
                }
            }
            .listStyle(.insetGrouped)
            .accessibilityIdentifier("lista-resultados")
        }
    }

    private func cabecera(_ titulo: String, cuenta: Int?) -> some View {
        CabeceraFila(titulo: titulo, cuenta: cuenta)
            .textCase(nil)
            .padding(.horizontal, 4)
    }

    @ViewBuilder private var motor: some View {
        if vm.buscando && vm.resultados.isEmpty {
            ForEach(0..<3, id: \.self) { _ in
                FilaResultado(resultado: SearchResult.muestra)
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
        } else if vm.buscado.isEmpty {
            Text("Escribe al menos dos letras para buscar en el motor.")
                .font(.subheadline)
                .foregroundStyle(Tinta.texto2)
        } else if vm.resultados.isEmpty {
            Text("El motor no encuentra nada con «\(vm.buscado)».")
                .font(.subheadline)
                .foregroundStyle(Tinta.texto2)
        } else {
            ForEach(vm.resultados) { resultado in
                Button {
                    abrir(resultado)
                } label: {
                    FilaResultado(resultado: resultado)
                }
                .foregroundStyle(Tinta.texto)
                .swipeActions(edge: .leading) {
                    Button {
                        Task { await app.alternarFavorito(id: resultado.id, titulo: resultado.title, ih: resultado.ih) }
                    } label: {
                        Label(app.esFavorito(resultado.id) ? "Quitar" : "Favorito", systemImage: "star")
                    }
                    .tint(Tinta.oro)
                }
                .contextMenu {
                    Button {
                        abrir(resultado)
                    } label: {
                        Label("Ver canal", systemImage: "play.fill")
                    }
                    Button {
                        Task { await app.alternarFavorito(id: resultado.id, titulo: resultado.title, ih: resultado.ih) }
                    } label: {
                        Label(
                            app.esFavorito(resultado.id) ? "Quitar de favoritos" : "Guardar en favoritos",
                            systemImage: "star")
                    }
                }
            }
        }
    }

    private func filaLocal(_ item: Item, en lista: [Item]) -> some View {
        Button {
            app.abrirCanal(app.canalReproducible(item), lista: lista.map { app.canalReproducible($0) })
        } label: {
            FilaCanal(
                item: item,
                favorito: app.esFavorito(item.id),
                antena: antena.para(titulo: item.title, alias: item.alias, marcadores: app.marcadores),
                subtitulo: ReglasBiblioteca.subtitulo(item, seccion: item.type == .web ? .listas : .favoritos),
                caido: false,
                enPantalla: app.reproductor.canal?.id.lowercased() == item.id.lowercased())
        }
        .foregroundStyle(Tinta.texto)
    }

    private func canalDe(resultado: SearchResult) -> CanalReproducible {
        CanalReproducible(id: resultado.id, titulo: resultado.title, ih: resultado.ih, origen: "acestream")
    }

    /// Reproduce y abre el escenario del canal.
    private func abrir(_ resultado: SearchResult) {
        app.abrirCanal(canalDe(resultado: resultado), lista: vm.resultados.map { canalDe(resultado: $0) })
    }
}

/// Un resultado de la búsqueda con su disponibilidad en una cápsula («93 %»).
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
                let tono: TonoCapsula = porcentaje >= 60 ? .ok : (porcentaje > 0 ? .floja : .fallo)
                CapsulaPalco(texto: "\(porcentaje) %", tono: tono, punto: true, compacta: true)
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
