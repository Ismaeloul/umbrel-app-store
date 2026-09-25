import Foundation

/* Las consultas de caché de la app (b-arquitectura §2.1.4, contrato I0→M1; a7 §4.1). */

/// Una consulta de caché (una por ruta de lectura). Lo que invalida cada evento se expresa con esto.
enum RutaConsulta: String, CaseIterable, Sendable {
    case bootstrap, libraryGet, preferencesGet, directoriesGet, settingsGet, playbackStatus, engineStatus
    case footballSchedule, scores, footballPreheat, footballResolve, footballScan, health, diagnosticsList
    case devicesList, search
}
