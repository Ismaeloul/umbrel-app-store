import Observation
import SwiftUI

/* Transición tarjeta → teatro (b-arquitectura §2.4.5 y §3.5, I0→M4; decisión 3). Las piezas publican
   su marco (coordenadas de la ventana) y la capa del teatro y la del vuelo los leen.
   ESQUELETO de I0 (fase 0.3b): guarda los marcos y salta al final sin animar; M4 escribe la ida (zoom
   de la capa + vuelo de escudos con plusLighter), la vuelta de la web y `.piezaVuelo`. */

enum PiezaVuelo: Hashable, Sendable { case tarjeta, escudos, filaEquipos, escenario }

struct ClaveMarco: Hashable, Sendable {
    var pieza: PiezaVuelo
    var partido: String
}

@MainActor @Observable final class TransicionTeatro {
    @ObservationIgnored private(set) var marcos: [ClaveMarco: CGRect] = [:]  // coordenadas de la ventana
    private(set) var progreso: Double = 1  // 0 = en el origen, 1 = teatro colocado
    private(set) var ida = true
    private(set) var activa = false

    func publicar(_ marco: CGRect, para clave: ClaveMarco) { marcos[clave] = marco }

    func olvidar(_ clave: ClaveMarco) { marcos[clave] = nil }

    /// Ida (§3.5): zoom de la capa desde el origen + vuelo de escudos (plusLighter), muelle estándar.
    func abrir(_ destino: Destino, desde origen: OrigenApertura, reducido: Bool) async {
        ida = true
        progreso = 1
        activa = false
    }

    /// Vuelta de la web: el teatro se funde, la pestaña entra desde −16, los escudos vuelven,
    /// y el vídeo vuela al mini si sigue sonando.
    func cerrar(haciaMini: Bool, desde marcoVideo: CGRect?, reducido: Bool) async {
        ida = false
        progreso = 1
        activa = false
    }
}

extension View {
    /// Publica el marco de esta pieza (onGeometryChange en .global) y lo olvida al desaparecer.
    /// Esqueleto de I0: no publica nada todavía (M4).
    func piezaVuelo(_ pieza: PiezaVuelo, partido: String) -> some View { self }
}
