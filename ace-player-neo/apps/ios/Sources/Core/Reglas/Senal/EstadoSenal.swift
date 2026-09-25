import Foundation

// b-arquitectura §2.1.3 (I0→M2). Sustituye en la poda (fase 0.2) al `EstadoSenal` de la interfaz
// vieja (`ok/floja/sinSenal/comprobando/pendiente`, en Design/Componentes.swift): mismos estados
// con los nombres de la web (`SignalState` de ui/SignalBadge.tsx).

/// Estado de una fuente: medidor de tres barras SIEMPRE con su palabra.
enum EstadoSenal: String, CaseIterable, Sendable {
    case ok, weak, fail, checking, pending

    var palabra: String {  // ui/SignalBadge.tsx
        switch self {
        case .ok: "Verificada"
        case .weak: "Floja"
        case .fail: "Sin señal"
        case .checking: "Comprobando"
        case .pending: "Pendiente"
        }
    }
}
