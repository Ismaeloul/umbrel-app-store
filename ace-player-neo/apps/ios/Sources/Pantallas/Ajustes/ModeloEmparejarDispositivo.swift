import Foundation
import Observation

/* Emparejar OTRO iPhone o iPad desde Ajustes › Dispositivos (a6 §8.1-§8.7, §8.10.4, §8.10.7; usePairing.ts):
   la máquina pura (`MaquinaEmparejarOtro`) con la petición cancelable, la cuenta atrás contra el reloj de la
   app, la lista y el SSE `devices.changed`, y el aviso «emparejado» una vez por aparato. Los servicios se
   inyectan (ModeloEmparejarDispositivoTests). */

@MainActor @Observable final class ModeloEmparejarDispositivo {
    struct Servicios {
        /// `POST pairing` con `{ baseUrl, alternateBaseUrls? }`.
        var crear: @MainActor () async throws -> PairingCreateResponse
        /// El reloj de la app (R14).
        var ahora: @MainActor () -> Date
        /// Un 403 `origin_forbidden` (servidor 0.8.0): la sección pasa al modo degradado.
        var cerrado: @MainActor (APIError) -> Void = { _ in }
        /// «emparejado»: háptica de éxito y toast (una vez por aparato, con el nombre ya conocido).
        var emparejado: @MainActor (String) -> Void = { _ in }
    }

    private(set) var maquina = MaquinaEmparejarOtro()
    /// Instante del último tic (lo que pinta la cuenta atrás).
    private(set) var ahora: Date

    @ObservationIgnored private var peticion: Task<Void, Never>?
    @ObservationIgnored private var avisados: Set<String> = []
    @ObservationIgnored private var ultimaLista: [String]?
    private let servicios: Servicios

    init(servicios: Servicios) {
        self.servicios = servicios
        ahora = servicios.ahora()
    }

    var fase: FaseEmparejarOtro { maquina.fase }
    var restante: Double { maquina.restante(ahora: ahora) }
    var fraccion: Double { maquina.fraccion(ahora: ahora) }
    var hayCodigo: Bool { maquina.hayCodigo }

    /// «Emparejar un dispositivo», «Crear otro código», «Emparejar otro», «Volver a intentarlo»: un código
    /// nuevo anula el anterior.
    func crear() {
        peticion?.cancel()
        maquina.empezar()
        let conocidos = ultimaLista
        peticion = Task { [weak self] in
            guard let self else { return }
            do {
                let respuesta = try await self.servicios.crear()
                guard !Task.isCancelled else { return }
                self.ahora = self.servicios.ahora()
                self.maquina.creado(respuesta, ahora: self.ahora, conocidos: conocidos)
            } catch {
                guard !Task.isCancelled else { return }
                let fallo = APIError.desde(error)
                if case .cancelado = fallo { return }
                if fallo.codigo == "origin_forbidden" {
                    self.servicios.cerrado(fallo)
                    self.maquina.fallar(AvisoVersion.base)
                } else {
                    self.maquina.fallar(fallo.mensaje)
                }
            }
        }
    }

    /// «Cancelar» y «Hecho».
    func cancelar() {
        peticion?.cancel()
        peticion = nil
        maquina.cancelar()
    }

    /// Tic de 1 s de la cuenta atrás (y al volver a la vista, con la hora de ahora).
    func tic() {
        ahora = servicios.ahora()
        maquina.tic(ahora: ahora)
    }

    /// Llegó la lista: la referencia al crear el código y la diferencia con código a la vista.
    func lista(_ dispositivos: [Device], nombres: (String) -> String?) {
        let ids = dispositivos.map(\.id)
        ultimaLista = ids
        maquina.lista(ids)
        avisarSiToca(nombres)
    }

    /// SSE `devices.changed`.
    func evento(_ e: DevicesChangedData, nombres: (String) -> String?) {
        maquina.evento(e)
        avisarSiToca(nombres)
    }

    /// El nombre del recién emparejado (de la lista), cuando ya se conoce.
    func nombreEmparejado(_ nombres: (String) -> String?) -> String? {
        guard case .emparejado(let id) = maquina.fase else { return nil }
        return nombres(id)
    }

    private func avisarSiToca(_ nombres: (String) -> String?) {
        guard case .emparejado(let id) = maquina.fase, !avisados.contains(id), let nombre = nombres(id) else { return }
        avisados.insert(id)
        servicios.emparejado(nombre)
    }
}
