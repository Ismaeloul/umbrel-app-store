import Foundation
import Observation
import UIKit

/* «Deshacer» de 6 s de la biblioteca (b-arquitectura §2.5.5, M1; a7 §8.6.1): `removeWithUndo` de
   apps/web/src/features/library/data.ts.
   - La fila se oculta al momento (clave `"<colección>:<hash>"`; si ya está pendiente, nada) y sale el
     toast warn de 6 s con «Deshacer»: ««<título>» quitado de favoritos» (estrella) o ««<título>» eliminado»
     (papelera).
   - A los 6 s, `libraryMutate delete` (con la lista activa solo en `web`). Si falla, la fila vuelve y sale
     «No se pudo quitar el favorito» / «No se pudo eliminar el canal».
   - Al pasar a segundo plano se mandan ya, dentro de una tarea de fondo (el `keepalive` de la web). */

@MainActor @Observable final class BajasPendientes {
    /// Filas ocultas mientras dura su «Deshacer».
    private(set) var claves: Set<String> = []
    @ObservationIgnored private var bajas: [String: Baja] = [:]
    @ObservationIgnored private var observador: (any NSObjectProtocol)?

    /// `UNDO_MS` (library/model.ts).
    static let deshacer: Duration = .seconds(6)
    /// Lo que dura el «Deshacer» (las pruebas lo acortan).
    @ObservationIgnored var espera: Duration = BajasPendientes.deshacer

    private struct Baja {
        var canal: RefCanal
        var coleccion: LibraryCollection
        var listaActiva: String?
        var datos: DatosApp
        var avisos: Avisos
        var reloj: Task<Void, Never>?
        var enviando = false
    }

    init() {
        observador = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let bajas = self else { return }
            Task { @MainActor in bajas.enviarYa() }
        }
    }

    /// `rowKey` (library/model.ts).
    static func clave(_ coleccion: LibraryCollection, _ hash: String) -> String { "\(coleccion.rawValue):\(hash)" }

    func quitar(_ canal: RefCanal, datos: DatosApp, avisos: Avisos) {
        let coleccion = canal.coleccion ?? .favorites
        let clave = Self.clave(coleccion, canal.hash)
        guard bajas[clave] == nil else { return }
        let lista = coleccion == .web ? datos.biblioteca.datos?.activeWebSourceId : nil
        var baja = Baja(canal: canal, coleccion: coleccion, listaActiva: lista, datos: datos, avisos: avisos)
        let espera = self.espera
        baja.reloj = Task { [weak self] in
            try? await Task.sleep(for: espera)
            guard !Task.isCancelled else { return }
            await self?.confirmar(clave)
        }
        bajas[clave] = baja
        claves.insert(clave)
        let titulo = canal.titulo.isEmpty ? "Canal" : canal.titulo
        let desfavorito = coleccion == .favorites
        let accion = AccionAviso(titulo: "Deshacer") { [weak self] in self?.soltar(clave) }
        avisos.avisar(
            desfavorito ? "«\(titulo)» quitado de favoritos" : "«\(titulo)» eliminado", tono: .warn,
            icono: desfavorito ? .star : .trash, accion: accion, duracion: 6)
    }

    /// ¿Está oculta alguna fila de este canal?
    func pendiente(_ hash: String) -> Bool { claves.contains { $0.hasSuffix(":" + hash) } }

    /// ¿Está oculta la fila de este canal en esta colección?
    func pendiente(_ hash: String, en coleccion: LibraryCollection) -> Bool {
        claves.contains(Self.clave(coleccion, hash))
    }

    /// Manda ya todas las bajas (segundo plano), dentro de una tarea de fondo.
    func enviarYa() {
        let pendientes = Array(bajas.keys)
        guard !pendientes.isEmpty else { return }
        let tarea = TareaDeFondo()
        tarea.empezar()
        Task { [weak self] in
            for clave in pendientes { await self?.confirmar(clave) }
            tarea.terminar()
        }
    }

    /// «Deshacer»: la fila vuelve a su sitio.
    private func soltar(_ clave: String) {
        bajas[clave]?.reloj?.cancel()
        bajas[clave] = nil
        claves.remove(clave)
    }

    private func confirmar(_ clave: String) async {
        guard var baja = bajas[clave], !baja.enviando else { return }
        baja.reloj?.cancel()
        baja.reloj = nil
        baja.enviando = true
        bajas[clave] = baja
        let cambio = LibraryMutation.delete(
            collection: baja.coleccion, id: baja.canal.hash, sourceId: baja.listaActiva)
        do {
            try await baja.datos.mutarBiblioteca(cambio)
            soltar(clave)
        } catch {
            soltar(clave)
            let texto = baja.coleccion == .favorites ? "No se pudo quitar el favorito" : "No se pudo eliminar el canal"
            baja.avisos.avisar(texto, tono: .err)
        }
    }
}

/// Una tarea de fondo de UIKit que se termina una sola vez (al acabar o al agotarse el tiempo).
@MainActor private final class TareaDeFondo {
    private var id = UIBackgroundTaskIdentifier.invalid

    func empezar() {
        id = UIApplication.shared.beginBackgroundTask(withName: "bajas-biblioteca") { [weak self] in
            self?.terminar()
        }
    }

    func terminar() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
