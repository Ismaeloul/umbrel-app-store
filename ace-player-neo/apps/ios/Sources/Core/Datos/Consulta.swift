import Foundation
import Observation
import SwiftUI

/* Una consulta de caché (b-arquitectura §2.5.1, I0→M1): el TanStack mínimo de la web (a7 §4): datos,
   error, frescura, reintentos y una sola petición en vuelo. Vive en `DatosApp` (vida de proceso).
   ESQUELETO de I0 (fase 0.3b): pide y guarda sin reintentos ni reloj inyectado; M1 escribe la
   política entera (ConsultaTests) y `.mira(_:)`. */

@MainActor @Observable final class Consulta<Valor: Sendable> {
    private(set) var datos: Valor?
    private(set) var error: APIError?
    private(set) var cargando = false
    private(set) var actualizadaEn: Date?
    private(set) var observadores = 0
    let politica: PoliticaConsulta
    private let pedir: @Sendable () async throws -> Valor  // `let`: la macro no lo observa
    @ObservationIgnored private var enVuelo: Task<Void, Never>?

    init(_ politica: PoliticaConsulta = .porDefecto, pedir: @escaping @Sendable () async throws -> Valor) {
        self.politica = politica
        self.pedir = pedir
    }

    func caducada(tiempoRealAbierto: Bool, ahora: Date) -> Bool {
        guard let actualizadaEn else { return true }
        let frescura = tiempoRealAbierto ? politica.frescuraConTiempoReal : politica.frescuraSinTiempoReal
        guard let frescura else { return false }
        let segundos = Double(frescura.components.seconds)
        return ahora.timeIntervalSince(actualizadaEn) >= segundos
    }

    /// Pide si no hay datos o están caducados; si ya hay una petición en vuelo, espera a esa.
    func asegurar(tiempoRealAbierto: Bool) async {
        guard datos == nil || caducada(tiempoRealAbierto: tiempoRealAbierto, ahora: Date()) else { return }
        await refrescar()
    }

    /// «Actualizar» y tirar para actualizar: pide siempre.
    func refrescar() async {
        if let enVuelo {
            await enVuelo.value
            return
        }
        let tarea = Task { await self.cargar() }
        enVuelo = tarea
        await tarea.value
        enVuelo = nil
    }

    /// Caduca; si alguien la mira, vuelve a pedir (como TanStack con consultas activas).
    func invalidar() {
        actualizadaEn = nil
        guard observadores > 0 else { return }
        Task { await self.refrescar() }
    }

    func escribir(_ valor: Valor) {
        datos = valor
        error = nil
        actualizadaEn = Date()
    }

    func vaciar() {
        enVuelo?.cancel()
        enVuelo = nil
        datos = nil
        error = nil
        actualizadaEn = nil
    }

    func empezarAMirar() { observadores += 1 }

    func dejarDeMirar() { observadores = max(0, observadores - 1) }

    private func cargar() async {
        cargando = true
        defer { cargando = false }
        do {
            escribir(try await pedir())
        } catch {
            let convertido = APIError.desde(error)
            if case .cancelado = convertido { return }
            self.error = convertido
        }
    }
}

extension View {
    /// Mira una consulta mientras la vista está en pantalla Y `vistaActiva` (pestaña visible).
    /// Esqueleto de I0: no mira nada todavía (M1).
    func mira<V: Sendable>(_ consulta: Consulta<V>) -> some View { self }
}
