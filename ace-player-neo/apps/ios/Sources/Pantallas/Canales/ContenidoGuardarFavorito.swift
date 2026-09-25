import SwiftUI

/* ContenidoGuardarFavorito (b-arquitectura §2.8, M5; a5 §3). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M5 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct ContenidoGuardarFavorito: View {
    let canal: RefCanal

    var body: some View {
        Color.clear
            .overlay { Text("Guardar favorito") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.hojaGuardarFavorito)
    }
}
