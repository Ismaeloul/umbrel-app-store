import Foundation
import Observation
import SwiftUI

/* Una consulta de caché (b-arquitectura §2.5.1, I0→M1): el TanStack mínimo de la web (a7 §4,
   apps/web/src/api/query.ts): datos, error, frescura, reintentos y una sola petición en vuelo. Vive en
   `DatosApp` (vida de proceso).
   - Frescura: ∞ con el SSE abierto y 30 s sin él (o la de su política).
   - Reintentos: 2, a 1 s y 2 s (`min(8000, 1000·2^n)`), solo si el error es `reintentable`.
   - `invalidar()` caduca y, si alguien la mira, vuelve a pedir (las consultas activas de TanStack).
   - Un fallo con datos conserva los datos (TanStack también) y deja el error al lado. */

@MainActor @Observable final class Consulta<Valor: Sendable> {
    private(set) var datos: Valor?
    private(set) var error: APIError?
    private(set) var cargando = false
    private(set) var actualizadaEn: Date?
    private(set) var observadores = 0
    let politica: PoliticaConsulta
    private let pedir: @Sendable () async throws -> Valor  // `let`: la macro no lo observa
    @ObservationIgnored private var enVuelo: Task<Void, Never>?

    /// El reloj de la frescura (DatosApp pone el de la app).
    @ObservationIgnored var reloj: any Reloj = RelojSistema()
    /// Espera antes del reintento n (0, 1…): 1 s y 2 s (`retryDelay` de query.ts). Los tests la acortan.
    @ObservationIgnored var esperarReintento: @Sendable (Int) async throws -> Void = { intento in
        try await Task.sleep(for: .seconds(min(8, Double(1 << intento))))
    }
    /// Cada dato nuevo (de la red o escrito): caché en disco, versión del servidor…
    @ObservationIgnored var alEscribir: ((Valor) -> Void)?
    /// Cada fallo que se queda (tras los reintentos): capacidades de un servidor 0.8.0.
    @ObservationIgnored var alFallar: ((APIError) -> Void)?
    /// Sube al vaciar o forzar: una respuesta de una generación vieja se tira.
    @ObservationIgnored private var generacion = 0
    /// Desde cuándo nadie la mira: al soltarla el último (`dejarDeMirar`) o, en las consultas con parámetro,
    /// al crearla (`DatosApp`). Sin hora, nunca es recogible.
    @ObservationIgnored var inactivaDesde: Date?

    init(_ politica: PoliticaConsulta = .porDefecto, pedir: @escaping @Sendable () async throws -> Valor) {
        self.politica = politica
        self.pedir = pedir
    }

    func caducada(tiempoRealAbierto: Bool, ahora: Date) -> Bool {
        guard let actualizadaEn else { return true }
        let frescura = tiempoRealAbierto ? politica.frescuraConTiempoReal : politica.frescuraSinTiempoReal
        guard let frescura else { return false }
        let partes = frescura.components
        let segundos = Double(partes.seconds) + Double(partes.attoseconds) / 1e18
        return ahora.timeIntervalSince(actualizadaEn) >= segundos
    }

    /// Pide si no hay datos o están caducados; si ya hay una petición en vuelo, espera a esa.
    func asegurar(tiempoRealAbierto: Bool) async {
        if let enVuelo {
            await enVuelo.value
            return
        }
        guard datos == nil || caducada(tiempoRealAbierto: tiempoRealAbierto, ahora: reloj.ahora) else { return }
        await refrescar()
    }

    /// «Actualizar» y tirar para actualizar: pide siempre (si ya hay una en vuelo, espera a esa).
    func refrescar() async {
        if let enVuelo {
            await enVuelo.value
            return
        }
        let miGeneracion = generacion
        let tarea = Task { await self.cargar(generacion: miGeneracion) }
        enVuelo = tarea
        await tarea.value
        if generacion == miGeneracion { enVuelo = nil }
    }

    /// Caduca; si alguien la mira, vuelve a pedir (como TanStack con consultas activas: la que estuviera en
    /// vuelo se tira y sale otra).
    func invalidar() {
        actualizadaEn = nil
        guard observadores > 0 else { return }
        cancelarEnVuelo()
        Task { await self.refrescar() }
    }

    func escribir(_ valor: Valor) {
        datos = valor
        error = nil
        actualizadaEn = reloj.ahora
        alEscribir?(valor)
    }

    /// Escritura directa que no cambia la frescura (a7 §4.3: `setQueryData` sobre lo que hay). Sin datos,
    /// no hace nada (como `old ? {...} : old` de la web).
    func modificar(_ cambio: (inout Valor) -> Void) {
        guard var valor = datos else { return }
        cambio(&valor)
        datos = valor
        alEscribir?(valor)
    }

    /// Lo guardado en disco para pintar en frío (a2 §23.1): se ve al momento, pero caducado.
    func pintarEnFrio(_ valor: Valor) {
        guard datos == nil else { return }
        datos = valor
    }

    func vaciar() {
        cancelarEnVuelo()
        datos = nil
        error = nil
        actualizadaEn = nil
    }

    func empezarAMirar() { observadores += 1 }

    func dejarDeMirar() {
        observadores = max(0, observadores - 1)
        if observadores == 0 { inactivaDesde = reloj.ahora }
    }

    /// Nadie la mira ni se está pidiendo desde hace `tras` (el `gcTime` de TanStack, 5 min en query.ts): se
    /// puede tirar. `DatosApp` solo recoge las consultas con parámetro (búsquedas, precalentados, trabajos).
    func recogible(ahora: Date, tras: TimeInterval) -> Bool {
        guard observadores == 0, enVuelo == nil, let inactivaDesde else { return false }
        return ahora.timeIntervalSince(inactivaDesde) >= tras
    }

    /// La app vuelve a primer plano (`refetchOnWindowFocus`): solo las que alguien mira y estén caducadas.
    func volverActiva(tiempoRealAbierto: Bool) {
        guard observadores > 0 else { return }
        switch politica.alVolverActiva {
        case .nunca: return
        case .soloSinTiempoReal where tiempoRealAbierto: return
        default: break
        }
        guard caducada(tiempoRealAbierto: tiempoRealAbierto, ahora: reloj.ahora) else { return }
        Task { await self.refrescar() }
    }

    /// Vuelve la conexión (`refetchOnReconnect`): las que alguien mira y se quedaron con error.
    func reintentarSiFallo() {
        guard observadores > 0, error != nil, enVuelo == nil else { return }
        Task { await self.refrescar() }
    }

    private func cancelarEnVuelo() {
        generacion += 1
        enVuelo?.cancel()
        enVuelo = nil
        cargando = false
    }

    private func cargar(generacion miGeneracion: Int) async {
        cargando = true
        defer { if generacion == miGeneracion { cargando = false } }
        var intento = 0
        while true {
            do {
                let valor = try await pedir()
                guard generacion == miGeneracion, !Task.isCancelled else { return }
                escribir(valor)
                return
            } catch {
                let convertido = APIError.desde(error)
                if case .cancelado = convertido { return }
                guard generacion == miGeneracion, !Task.isCancelled else { return }
                if convertido.reintentable && intento < politica.reintentos {
                    do {
                        try await esperarReintento(intento)
                    } catch {
                        return
                    }
                    guard generacion == miGeneracion, !Task.isCancelled else { return }
                    intento += 1
                    continue
                }
                self.error = convertido
                alFallar?(convertido)
                return
            }
        }
    }
}

extension View {
    /// Mira una consulta mientras la vista está en pantalla Y `vistaActiva` (pestaña visible): la pide al
    /// montarse si no hay datos o están caducados (`refetchOnMount: 'always'` con `siempreAlMontar`), y la
    /// suelta al irse. Equivale a `useApiQuery` con `enabled` (a7 §4.1).
    func mira<V: Sendable>(_ consulta: Consulta<V>) -> some View {
        modifier(MiraConsulta(consulta: consulta))
    }
}

/// La clave de la tarea de `.mira(_:)`: si la vista pasa a mirar OTRA consulta (otra `q` en Buscar, una fila
/// reutilizada con otro partido), la tarea vuelve a empezar con la nueva, como `useApiQuery` al cambiar su
/// clave (`['v1','search',{q}]`, `['v1','footballPreheat',{matchId}]`).
struct ClaveMira: Hashable {
    let activa: Bool
    let consulta: ObjectIdentifier

    init<V: Sendable>(activa: Bool, consulta: Consulta<V>) {
        self.activa = activa
        self.consulta = ObjectIdentifier(consulta)
    }
}

/// El `useApiQuery` de `.mira(_:)`.
private struct MiraConsulta<V: Sendable>: ViewModifier {
    let consulta: Consulta<V>
    @Environment(\.vistaActiva) private var activa
    @Environment(DatosApp.self) private var datos

    func body(content: Content) -> some View {
        content.task(id: ClaveMira(activa: activa, consulta: consulta)) { await mirar() }
    }

    private func mirar() async {
        guard activa else { return }
        consulta.empezarAMirar()
        defer { consulta.dejarDeMirar() }
        if consulta.politica.siempreAlMontar {
            await consulta.refrescar()
        } else {
            await consulta.asegurar(tiempoRealAbierto: datos.tiempoRealAbierto)
        }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3600))
        }
    }
}
