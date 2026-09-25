import Foundation
import Observation

// PROVISIONAL de la poda (fase 0.2): el `Avisos` de la interfaz vieja (Design/Componentes.swift), sin su
// vista, para que `SesionFuentes` rescatada siga avisando igual. La fase 0.3b lo sustituye por el contrato
// de b-arquitectura §2.4.4 (el notify() de la web: toasts + línea de estado) y adapta sus llamadas.

/// Un aviso breve (toast), con acción opcional («Deshacer»).
struct Aviso: Identifiable, Equatable, Sendable {
    enum Tono: Equatable, Sendable { case normal, ok, error }

    let id = UUID()
    var texto: String
    var tono: Tono = .normal
    var accion: String?
    var duracion: TimeInterval = 3.2

    init(_ texto: String, tono: Tono = .normal, accion: String? = nil, duracion: TimeInterval = 3.2) {
        self.texto = texto
        self.tono = tono
        self.accion = accion
        self.duracion = duracion
    }

    static func == (a: Aviso, b: Aviso) -> Bool { a.id == b.id }
}

/// Avisos de la app (uno a la vez).
@MainActor
@Observable
final class Avisos {
    private(set) var actual: Aviso?
    @ObservationIgnored private var alPulsar: (() -> Void)?
    @ObservationIgnored private var tarea: Task<Void, Never>?

    init() {}

    func mostrar(_ aviso: Aviso, alPulsar: (() -> Void)? = nil) {
        tarea?.cancel()
        self.alPulsar = alPulsar
        actual = aviso
        let id = aviso.id
        let duracion = aviso.duracion
        tarea = Task { [weak self] in
            try? await Task.sleep(for: .seconds(duracion))
            guard !Task.isCancelled, let self, self.actual?.id == id else { return }
            self.actual = nil
            self.alPulsar = nil
        }
    }

    func mostrar(_ texto: String, tono: Aviso.Tono = .normal) {
        mostrar(Aviso(texto, tono: tono))
    }

    func pulsarAccion() {
        let accion = alPulsar
        cerrar()
        accion?()
    }

    func cerrar() {
        tarea?.cancel()
        actual = nil
        alPulsar = nil
    }
}
