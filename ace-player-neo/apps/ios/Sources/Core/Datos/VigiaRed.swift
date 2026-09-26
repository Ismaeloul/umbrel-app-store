import Foundation
import Network

/* Cambio de red (b-arquitectura §2.5.5, M1; a8 §3.2): NWPathMonitor → `ServerResolver.invalidar()` y
   `alCambiar` (la sesión rehace el tiempo real y vuelve a elegir dirección). Es lo que hace el cambio
   casa ↔ Tailscale sin aviso al salir de casa o volver (a9 §3). El primer aviso del monitor es el estado
   inicial y no cuenta; después, solo cuenta si cambia de verdad (estado o interfaces). */

@MainActor final class VigiaRed {
    private let servidores: ServerResolver
    private let alCambiar: () -> Void
    private let monitor = NWPathMonitor()
    private var firma: String?

    init(servidores: ServerResolver, alCambiar: @escaping () -> Void) {
        self.servidores = servidores
        self.alCambiar = alCambiar
        monitor.pathUpdateHandler = Self.manejador(para: self)
        monitor.start(queue: DispatchQueue(label: "es.ismaeloul.aceplayerneo.red"))  // permitido: NWPathMonitor exige una cola
    }

    deinit { monitor.cancel() }

    /// Se crea fuera del actor principal (como `alCambiarLaRed` de la 0.8.0): Network llama al manejador en su
    /// cola, así que el cierre no puede heredar el aislamiento del `init`.
    private nonisolated static func manejador(para vigia: VigiaRed) -> @Sendable (NWPath) -> Void {
        { [weak vigia] camino in
            let nueva = firma(de: camino)
            guard let vigia else { return }
            Task { @MainActor in vigia.recibir(nueva) }
        }
    }

    /// Lo que distingue una red de otra: si hay salida y por qué interfaces.
    nonisolated static func firma(de camino: NWPath) -> String {
        let interfaces = camino.availableInterfaces.map { "\($0.type)-\($0.name)" }.joined(separator: ",")
        return "\(camino.status)|\(interfaces)"
    }

    func recibir(_ nueva: String) {
        defer { firma = nueva }
        guard let anterior = firma, anterior != nueva else { return }
        let servidores = self.servidores
        Task { await servidores.invalidar() }
        alCambiar()
    }
}
