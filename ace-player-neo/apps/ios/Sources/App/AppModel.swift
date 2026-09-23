import Foundation
import Network
import Observation
import os

/// Estado global de la app: si está emparejada, con qué servidor habla, el
/// estado del motor y la conexión de tiempo real.
@MainActor
@Observable
public final class AppModel {
    public enum Fase: Equatable {
        /// Sin token o sin servidor: pantalla de emparejamiento.
        case emparejar
        /// Emparejada: la app de verdad.
        case lista
    }

    public enum EstadoConexion: Equatable {
        case conectando
        case conectado(ActiveServer)
        case sinConexion(String)
    }

    public private(set) var fase: Fase
    public private(set) var conexion: EstadoConexion = .conectando
    public private(set) var motor: EngineStatus?
    public private(set) var biblioteca: LibraryView?
    public private(set) var versionServidor: String?
    /// Aviso para enseñar una vez (p. ej. «se ha retirado el acceso»).
    public var aviso: String?
    /// Sube con cada `resync` o cambio relevante: las pantallas lo observan para recargar.
    public private(set) var recargas = 0

    public let entorno: Entorno
    @ObservationIgnored private var tareaTiempoReal: Task<Void, Never>?
    @ObservationIgnored private var tareaAccesoPerdido: Task<Void, Never>?
    @ObservationIgnored private var monitorRed: NWPathMonitor?
    @ObservationIgnored private var estuvoEnSegundoPlano = false

    public init(entorno: Entorno) {
        self.entorno = entorno
        let tieneToken = ((try? entorno.tokens.leerToken()) ?? nil) != nil
        fase = tieneToken && !entorno.configuracion.leer().vacia ? .lista : .emparejar
        tareaAccesoPerdido = Task { [weak self] in
            for await _ in entorno.accesoPerdido {
                self?.accesoRetirado()
            }
        }
    }

    // MARK: Emparejamiento

    /// Llamado por la pantalla de emparejamiento cuando el servidor ha dado el token.
    public func emparejado() {
        aviso = nil
        fase = .lista
    }

    /// «Olvidar este servidor»: borra token, direcciones y caché.
    public func desemparejar() async {
        pararTiempoReal()
        try? entorno.tokens.borrarToken()
        entorno.configuracion.borrar()
        await entorno.servidores.actualizar(ServerConfig())
        await entorno.cache.borrarTodo()
        motor = nil
        biblioteca = nil
        fase = .emparejar
    }

    private func accesoRetirado() {
        guard fase == .lista else { return }
        pararTiempoReal()
        aviso = ErrorCatalog.mensaje(para: "device_revoked")
        fase = .emparejar
    }

    // MARK: Arranque y tiempo real

    /// Pinta primero lo guardado y luego pide el arranque al servidor.
    public func arrancar() async {
        if biblioteca == nil, let guardada = await entorno.cache.leer(LibraryView.self, de: .biblioteca) {
            biblioteca = guardada.valor
        }
        vigilarRed()
        arrancarTiempoReal()
        await refrescarArranque()
    }

    public func refrescarArranque() async {
        do {
            let arranque = try await entorno.api.enviar(API.bootstrap)
            motor = arranque.engine
            biblioteca = arranque.library
            versionServidor = arranque.version
            if let activo = await entorno.servidores.conocido() { conexion = .conectado(activo) }
            try? await entorno.cache.guardar(arranque.library, en: .biblioteca)
        } catch let error as APIError {
            if case .necesitaEmparejar = error { return }
            conexion = .sinConexion(error.mensaje)
        } catch {
            conexion = .sinConexion(APIError.desde(error).mensaje)
        }
    }

    public func arrancarTiempoReal() {
        guard fase == .lista, tareaTiempoReal == nil else { return }
        let flujo = entorno.tiempoReal.conectar()
        tareaTiempoReal = Task { [weak self] in
            for await cambio in flujo {
                guard let self else { return }
                self.procesar(cambio)
            }
        }
    }

    public func pararTiempoReal() {
        tareaTiempoReal?.cancel()
        tareaTiempoReal = nil
    }

    private func procesar(_ cambio: SSEUpdate) {
        switch cambio {
        case .conectado(let servidor):
            conexion = .conectado(servidor)
        case .desconectado(let error, _):
            if let error { conexion = .sinConexion(error.mensaje) }
        case .necesitaEmparejar:
            accesoRetirado()
        case .evento(let sobre):
            switch sobre.event {
            case .engineStatus(let estado):
                motor = estado
            case .stateChanged(let datos) where datos.scopes.contains(.library) || datos.scopes.contains(.directories):
                Task { await self.refrescarArranque() }
            case .resync:
                recargas += 1
                Task { await self.refrescarArranque() }
            default:
                break
            }
        }
    }

    /// Si cambia la red del teléfono (casa ↔ datos), se vuelve a elegir dirección.
    private func vigilarRed() {
        guard monitorRed == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = Self.alCambiarLaRed(entorno.servidores)
        monitor.start(queue: DispatchQueue(label: "es.ismaeloul.aceplayerneo.red"))
        monitorRed = monitor
    }

    /// Se crea fuera del actor principal: Network llama al manejador en su cola.
    /// La primera llamada es el estado inicial y no cuenta como cambio.
    private nonisolated static func alCambiarLaRed(_ servidores: ServerResolver) -> @Sendable (NWPath) -> Void {
        let primera = OSAllocatedUnfairLock(initialState: true)
        return { _ in
            let esLaPrimera = primera.withLock { valor in
                defer { valor = false }
                return valor
            }
            guard !esLaPrimera else { return }
            Task { await servidores.invalidar() }
        }
    }

    /// Al volver a primer plano: comprobar la señal y reconectar si hacía falta.
    public func volvioAPrimerPlano() {
        guard fase == .lista, estuvoEnSegundoPlano else { return }
        estuvoEnSegundoPlano = false
        arrancarTiempoReal()
        Task { await refrescarArranque() }
    }

    /// En segundo plano no se mantiene el SSE (iOS lo cortaría igual).
    public func pasoASegundoPlano() {
        estuvoEnSegundoPlano = true
        pararTiempoReal()
    }
}
