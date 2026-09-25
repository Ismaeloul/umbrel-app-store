import SwiftUI

/* Ajustes › Listas (a6 §3; directories/DirectoriesSection.tsx): guardar una lista remota M3U o HTML por su
   dirección, elegir la activa, actualizarla a mano y borrarla con segundo toque (5 s). Hasta 8. Todo
   deshabilitado mientras hay una operación en curso. */

struct SeccionListas: View {
    @Environment(DatosApp.self) private var datos
    @Environment(Avisos.self) private var avisos
    @Environment(Navegador.self) private var navegador
    @Environment(\.vistaActiva) private var vistaActiva
    @State private var nombre = ""
    @State private var url = ""
    @State private var urlTocada = false
    @State private var errorURL: String?
    @State private var ocupado: OperacionLista?
    @State private var nota: NotaLista?
    @State private var confirmar = SegundoToque()

    private var vista: DirectoryView? { datos.directorios.datos }
    private var listas: [WebSourceSummary] { vista?.webSources ?? [] }
    private var llenas: Bool { listas.count >= ModeloListas.maximo }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            FormularioLista(
                nombre: $nombre, url: urlEnlazada, errorURL: errorURL,
                pista: !url.isEmpty && ModeloListas.pareceLocal(url) ? ModeloListas.pistaPrivada : nil,
                ocupado: ocupado, llenas: llenas, nota: nota,
                guardar: { (tipo: WebSourceType) in Task { await sincronizar(tipo, lista: nil) } })
            guardadas
        }
        .task(id: vistaActiva) {
            guard vistaActiva else { return }
            await datos.directorios.asegurar(tiempoRealAbierto: datos.tiempoRealAbierto)
        }
        .onChange(of: vista, initial: true) { _, nueva in rellenarPorDefecto(nueva) }
        .onChange(of: vistaActiva) { _, activa in if !activa { confirmar.desarmar() } }
    }

    private var urlEnlazada: Binding<String> {
        Binding(get: { url }, set: { nuevo in
            url = nuevo
            urlTocada = true
            errorURL = nil
        })
    }

    /// La dirección llega rellena con la lista por defecto, salvo que ya esté guardada o se haya tocado.
    private func rellenarPorDefecto(_ vista: DirectoryView?) {
        guard let vista, !urlTocada else { return }
        if !vista.webSources.contains(where: { $0.url == ModeloListas.porDefecto }) { url = ModeloListas.porDefecto }
    }

    @ViewBuilder private var guardadas: some View {
        VStack(alignment: .leading, spacing: 12) {
            RotuloBloque(titulo: "Listas guardadas", dato: "\(listas.count) de \(ModeloListas.maximo)")
            if let vista {
                if vista.webSources.isEmpty {
                    Text("Todavía no hay listas guardadas.").estilo(notaEstilo).foregroundStyle(Palco.text2)
                } else {
                    VStack(spacing: 8) {
                        ForEach(vista.webSources) { (lista: WebSourceSummary) in tarjeta(lista, activa: vista.activeWebSourceId) }
                    }
                }
            } else if let error = datos.directorios.error {
                EstadoVacio(titulo: "No se pudieron cargar las listas", texto: error.mensaje, error: true) {
                    BotonPalco("Reintentar", icono: .refresh, variante: .quieto) {
                        Task { await datos.directorios.refrescar() }
                    }
                }
            } else {
                FilasEsqueleto(2, anuncio: "Cargando las listas…")
            }
        }
    }

    private var notaEstilo: EstiloTexto { EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45) }

    private func tarjeta(_ lista: WebSourceSummary, activa: String) -> some View {
        TarjetaLista(
            lista: lista, activa: lista.id == activa, armada: confirmar.armado == lista.id,
            ocupado: ocupado, hayOperacion: ocupado != nil,
            usar: { Task { await activar(lista) } },
            actualizar: { Task { await sincronizar(lista.type, lista: lista) } },
            borrar: { confirmar.tocar(lista.id, plazo: ModeloListas.plazoBorrar) { Task { await quitar(lista) } } })
    }

    // MARK: Operaciones (DirectoriesSection.tsx)

    private func sincronizar(_ tipo: WebSourceType, lista: WebSourceSummary?) async {
        let destino = lista?.url ?? url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !destino.isEmpty else {
            avisos.avisar("Escribe la URL de la lista", tono: .warn)
            return
        }
        if lista == nil && !ModeloListas.esHttp(destino) {
            errorURL = ErrorCatalog.mensaje(para: "bad_url")
            return
        }
        errorURL = nil
        ocupado = lista.map { .actualizar($0.id) } ?? .guardar
        nota = NotaLista(tono: .info, texto: lista.map { "Actualizando «\($0.name)»…" } ?? "Guardando y sincronizando la lista…")
        let nombreLista = lista?.name ?? nombre.trimmingCharacters(in: .whitespacesAndNewlines)
        let cuerpo = DirectorySyncBody(url: destino, type: tipo, sourceId: lista?.id, name: nombreLista.isEmpty ? nil : nombreLista)
        do {
            try await datos.sincronizarLista(cuerpo)
            if let nueva = datos.directorios.datos {
                nota = NotaLista(tono: .ok, texto: ModeloListas.hecho(nueva))
                avisos.avisar("Lista guardada: \(nueva.web.count) canales", tono: .ok)
            }
            navegador.pestanaCanales = .listas
            if lista == nil {
                nombre = ""
                url = ""
                urlTocada = true
            }
        } catch {
            nota = NotaLista(tono: .err, texto: ModeloListas.mensajeError(APIError.desde(error)))
        }
        ocupado = nil
    }

    private func activar(_ lista: WebSourceSummary) async {
        ocupado = .activar(lista.id)
        do {
            try await datos.activarLista(id: lista.id)
            avisos.avisar("Lista activa: \(lista.name)", tono: .ok)
            navegador.pestanaCanales = .listas
        } catch {
            let mensaje = ModeloListas.mensajeError(APIError.desde(error))
            avisos.avisar(mensaje == ModeloListas.errorGenerico ? "No se pudo cambiar de lista" : mensaje, tono: .err)
        }
        ocupado = nil
    }

    private func quitar(_ lista: WebSourceSummary) async {
        ocupado = .borrar(lista.id)
        do {
            try await datos.borrarLista(id: lista.id)
            avisos.avisar("Lista eliminada", tono: .ok, icono: .trash)
        } catch {
            avisos.avisar(ModeloListas.mensajeError(APIError.desde(error)), tono: .err)
        }
        ocupado = nil
    }
}

/// Lo que se está haciendo con las listas (una cosa cada vez).
enum OperacionLista: Equatable {
    case guardar
    case actualizar(String)
    case activar(String)
    case borrar(String)
}

/// La línea de estado del formulario.
struct NotaLista: Equatable {
    enum Tono { case info, ok, err }
    var tono: Tono
    var texto: String
}
