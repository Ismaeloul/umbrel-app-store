import SwiftUI
import UIKit

/// Una imagen de la caché: pinta al instante lo que ya haya en memoria (sin
/// `AsyncImage`), enseña `relleno` mientras no hay nada y, cuando la imagen
/// llega de disco o de la red, entra con un fundido de 150 ms.
struct ImagenCacheada<Relleno: View>: View {
    @Environment(AppModel.self) private var app
    let url: URL?
    @ViewBuilder let relleno: () -> Relleno
    @State private var cargada: UIImage?
    @State private var conFundido = false

    var body: some View {
        let inmediata = cargada ?? url.flatMap { app.entorno.imagenes.enMemoria($0) }
        ZStack {
            if let imagen = inmediata {
                Image(uiImage: imagen)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .transition(conFundido ? .opacity : .identity)
            } else {
                relleno()
            }
        }
        .animation(conFundido ? .easeOut(duration: 0.15) : nil, value: inmediata == nil)
        .task(id: url) {
            guard let url, cargada == nil, app.entorno.imagenes.enMemoria(url) == nil else { return }
            if let imagen = await app.entorno.imagenes.imagen(para: url), !Task.isCancelled {
                conFundido = true
                cargada = imagen
            }
        }
    }
}
