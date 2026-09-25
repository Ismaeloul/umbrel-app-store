import Observation
import SwiftUI

/// Estado de muestra de la galería y del banco: interruptores, filtros, el campo y los avisos de ejemplo. El
/// tema y la transparencia NO están aquí: son los de la app (`PreferenciasLocales`, como `setTheme` y
/// `setTransparency` en SistemaPage.tsx) y los aplica `HostingRaiz`.
@MainActor @Observable final class EstadoGaleria {
    var pulsado = false
    var filtro = "para-ti"
    var pestana = "favoritos"
    var consulta = ""
    var progreso = 0.8
    private(set) var toast: Toast?
    private(set) var linea: ContenidoLinea?
    @ObservationIgnored private var tareaToast: Task<Void, Never>?
    @ObservationIgnored private var tareaLinea: Task<Void, Never>?
    @ObservationIgnored private var siguiente = 1

    /// Un toast de muestra (2,8 s; con «Deshacer», 6 s). Mismo texto y tono → «×n».
    func avisar(_ texto: String, tono: TonoAviso, accion: String? = nil) {
        let clave = "\(tono.rawValue)|\(texto)"
        let repeticiones = toast?.clave == clave ? (toast?.repeticiones ?? 1) + 1 : 1
        toast = Toast(id: siguiente, clave: clave, texto: texto, tono: tono, icono: nil, tituloAccion: accion,
                      repeticiones: repeticiones, saliendo: false)
        siguiente += 1
        tareaToast?.cancel()
        let plazo: Duration = accion == nil ? .milliseconds(2800) : .seconds(6)
        tareaToast = Task { [weak self] in
            try? await Task.sleep(for: plazo)
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    func cerrarToast() {
        tareaToast?.cancel()
        toast = nil
    }

    /// La línea de estado de muestra (4,5 s sobre su base).
    func mostrarLinea(_ contenido: ContenidoLinea) {
        linea = contenido
        tareaLinea?.cancel()
        tareaLinea = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(4500))
            guard !Task.isCancelled else { return }
            self?.linea = nil
        }
    }

    /// `-AceNeoDesplazar <pt>` (capturas por tramos): baja a esa altura medio segundo después de abrir.
    static func desplazarAlAbrir(_ posicion: Binding<ScrollPosition>) async {
        let y = ModoEjecucion.desplazar
        guard y > 0 else { return }
        try? await Task.sleep(for: .milliseconds(500))
        posicion.wrappedValue.scrollTo(point: CGPoint(x: 0, y: y))
    }

    /// Las tres opciones del tema de la web (Sistema · Claro · Oscuro).
    static let opcionesTema: [OpcionSegmento<TemaApp>] = [
        OpcionSegmento(valor: .sistema, titulo: "Sistema", icono: .pantalla),
        OpcionSegmento(valor: .claro, titulo: "Claro", icono: .sol),
        OpcionSegmento(valor: .oscuro, titulo: "Oscuro", icono: .luna),
    ]
}
