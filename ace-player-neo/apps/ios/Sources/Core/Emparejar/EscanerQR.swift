import AVFoundation
import SwiftUI
import UIKit

/* La vista de la cámara del cartel de emparejar (a2 §22.3, §27.3; b-arquitectura §1.12). La sesión, la capa de
   la imagen y la lectura viven en `CamaraQR`, que dura lo que la pantalla: al girar, el cartel se monta en otro
   sitio (vertical ↔ horizontal) y esta vista solo vuelve a colgar la MISMA capa, sin parar ni arrancar la sesión
   (a2 §22.7: «al girar se conserva todo (campos, estado, sesión de la cámara)»). */

/// La cámara embebida. `activo` = debe estar leyendo; `ventana` = la ventana del marco en coordenadas de
/// esta vista; `recomprobar` cambia al volver a la app (se mira otra vez el permiso); `releer` cambia cuando el
/// modelo deja volver a leer el mismo QR (tras un fallo de red, ModeloEmparejar).
struct EscanerQR: UIViewRepresentable {
    let camara: CamaraQR
    var activo: Bool
    var ventana: CGRect
    var recomprobar: Int
    var releer: Int
    let alCambiar: @MainActor (EstadoCaptura) -> Void
    let alPrimeraImagen: @MainActor () -> Void
    let alLeer: @MainActor (String) -> Bool

    func makeUIView(context: Context) -> VistaCamaraQR {
        let vista = VistaCamaraQR(camara: camara)
        vista.ventana = ventana
        enlazar()
        camara.cambiarLectura(activo)
        camara.alojar(en: vista)
        return vista
    }

    func updateUIView(_ vista: VistaCamaraQR, context: Context) {
        enlazar()
        if vista.ventana != ventana {
            vista.ventana = ventana
            camara.maquetar(en: vista, ventana: ventana)
        }
        camara.recomprobar(recomprobar)
        camara.releer(releer)
        camara.cambiarLectura(activo)
    }

    /// Al girar se desmonta esta vista, pero la sesión sigue: solo se suelta la capa si aún cuelga de ella.
    static func dismantleUIView(_ vista: VistaCamaraQR, coordinator: ()) {
        vista.camara.desalojar(de: vista)
    }

    private func enlazar() {
        camara.alCambiar = alCambiar
        camara.alPrimeraImagen = alPrimeraImagen
        camara.alLeer = alLeer
    }
}

/// La vista que aloja la capa de la cámara (sin tamaño propio: el del cartel).
final class VistaCamaraQR: UIView {
    let camara: CamaraQR
    var ventana: CGRect = .zero

    init(camara: CamaraQR) {
        self.camara = camara
        super.init(frame: .zero)
        backgroundColor = .clear
        isAccessibilityElement = false
    }

    required init?(coder: NSCoder) { fatalError("sin storyboard") }

    override func layoutSubviews() {
        super.layoutSubviews()
        camara.maquetar(en: self, ventana: ventana)
    }
}
