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

/// Buscar: canales del motor AceStream por nombre.
struct BuscarView: View {
    @Environment(AppModel.self) private var app
    @State private var vm: BuscarModelo
    @State private var texto = ""
    @State private var ruta: [CanalReproducible] = []
    @Namespace private var mini

    init(entorno: Entorno) {
        _vm = State(initialValue: BuscarModelo(entorno: entorno))
    }

    var body: some View {
        NavigationStack(path: $ruta) {
            contenido
                .navigationTitle("Buscar")
                .background(Tinta.fondo.ignoresSafeArea())
                .scrollContentBackground(.hidden)
                .searchable(text: $texto, placement: .navigationBarDrawer(displayMode: .always), prompt: "Canal, partido o competición")
                .onSubmit(of: .search) { Task { await vm.buscar(texto, esperar: false) } }
                .task(id: texto) { await vm.buscar(texto) }
                .navigationDestination(for: CanalReproducible.self) { canal in
                    CanalView(canal: canal)
                }
        }
        .conMiniReproductor(app, espacio: mini)
    }

    @ViewBuilder private var contenido: some View {
        if vm.buscando && vm.resultados.isEmpty {
            List {
                ForEach(0..<5, id: \.self) { _ in
                    FilaResultado(resultado: SearchResult.muestra)
                        .listRowBackground(Tinta.superficie)
                }
            }
            .redacted(reason: .placeholder)
            .disabled(true)
        } else if let fallo = vm.fallo {
            ContentUnavailableView {
                Label("No se ha podido buscar", systemImage: "exclamationmark.magnifyingglass")
            } description: {
                Text(fallo)
            } actions: {
                Button("Reintentar") { Task { await vm.buscar(texto, esperar: false) } }
                    .buttonStyle(.borderedProminent)
            }
        } else if vm.buscado.isEmpty {
            ContentUnavailableView(
                "Busca en el motor", systemImage: "magnifyingglass",
                description: Text("Escribe el nombre de un canal para buscarlo en la red AceStream."))
        } else if vm.resultados.isEmpty {
            ContentUnavailableView.search(text: vm.buscado)
        } else {
            List(vm.resultados) { resultado in
                Button {
                    abrir(resultado)
                } label: {
                    FilaResultado(resultado: resultado)
                }
                .foregroundStyle(Tinta.texto)
                .listRowBackground(Tinta.superficie)
                .contextMenu {
                    Button {
                        Task { await app.alternarFavorito(id: resultado.id, titulo: resultado.title, ih: resultado.ih) }
                    } label: {
                        Label(app.esFavorito(resultado.id) ? "Quitar de favoritos" : "Añadir a favoritos", systemImage: "star")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .accessibilityIdentifier("lista-resultados")
        }
    }

    private func canal(_ resultado: SearchResult) -> CanalReproducible {
        CanalReproducible(id: resultado.id, titulo: resultado.title, ih: resultado.ih, origen: "acestream")
    }

    private func abrir(_ resultado: SearchResult) {
        let elegido = canal(resultado)
        app.reproducirCanal(elegido, lista: vm.resultados.map(canal))
        ruta.append(elegido)
    }
}

/// Un resultado de la búsqueda con su disponibilidad.
struct FilaResultado: View {
    let resultado: SearchResult

    var body: some View {
        let porcentaje = ReglasFuentes.porcentaje(resultado.availability)
        HStack(spacing: 12) {
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
