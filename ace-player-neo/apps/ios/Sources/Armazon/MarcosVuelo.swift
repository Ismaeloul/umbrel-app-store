import SwiftUI
import UIKit

/* Los marcos y las fotos de los vuelos (b-arquitectura §3.5, M4): cada pieza publica su marco en la ventana para
   `TransicionTeatro` y las fotos de la pantalla que viajan. Sacado de TransicionTeatro.swift (R20). */

extension View {
    /// Publica el marco de esta pieza (onGeometryChange en .global) y lo olvida al desaparecer. Mientras su foto
    /// vuela, la pieza no se pinta (la foto ocupa su sitio).
    func piezaVuelo(_ pieza: PiezaVuelo, partido: String) -> some View {
        modifier(PublicarMarco(clave: ClaveMarco(pieza: pieza, partido: partido)))
    }
}

/// Cada cambio de marco, en coordenadas de la ventana, va a `TransicionTeatro` (sin observar: nadie se repinta).
private struct PublicarMarco: ViewModifier {
    let clave: ClaveMarco
    @Environment(TransicionTeatro.self) private var transicion

    func body(content: Content) -> some View {
        content
            .opacity(transicion.ocultas.contains(clave) ? 0 : 1)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { transicion.publicar($0, para: clave) }
            .onDisappear { transicion.olvidar(clave) }
    }
}

/// Fotos de un trozo de la pantalla (lo que se ve AHORA), para los vuelos.
@MainActor enum Instantanea {
    static func tomar(_ marco: CGRect) -> UIView? {
        guard marco.width >= 1, marco.height >= 1, let ventana = ventanaClave() else { return nil }
        return ventana.resizableSnapshotView(from: marco, afterScreenUpdates: false, withCapInsets: .zero)
    }

    static func ventanaClave() -> UIWindow? {
        let escenas = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let activa = escenas.first { $0.activationState == .foregroundActive } ?? escenas.first
        return activa?.keyWindow
    }
}
