import Foundation

/* Lo que un servidor viejo no deja hacer a la app (b-arquitectura §2.1.4, contrato I0→M1; a9 §2 y
   §9.1, a2 §23.5). */

/// Rutas de administración abiertas a la app en la 0.8.1 (a9 §2).
enum RutaAdministracion: String, CaseIterable, Sendable {
    case health, settingsUpdate, pairingCreate, devicesList, deviceRevoke
}

/// Memoria de proceso de lo que un servidor viejo (0.8.0) cerró con 403 `origin_forbidden`.
struct Capacidades: Sendable {
    private(set) var cerradas: Set<RutaAdministracion> = []

    /// Solo cuenta el 403 con código `origin_forbidden`; cualquier otro error no cierra nada.
    mutating func registrar(_ codigo: String, en ruta: RutaAdministracion) {
        if codigo == "origin_forbidden" { cerradas.insert(ruta) }
    }

    mutating func olvidar() { cerradas = [] }

    var servidorViejo: Bool { !cerradas.isEmpty }
}
