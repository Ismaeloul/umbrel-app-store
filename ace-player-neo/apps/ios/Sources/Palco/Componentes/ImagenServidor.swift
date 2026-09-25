import SwiftUI
import UIKit

/// Escudos y logos del propio servidor (a1 §10.12, §10.14): la imagen de `CacheImagenes` del entorno (en
/// memoria al instante; si no, se pide y entra con un fundido de 340 ms); mientras no está o si falla, el
/// respaldo. El respaldo se guarda como `AnyView` (el único permitido, regla R4) para no hacer genérico un
/// tipo que se usa en decenas de sitios.
struct ImagenServidor: View {
    let url: URL?
    let tamano: CGSize
    private let respaldo: AnyView
    @Environment(\.cacheImagenes) private var cache
    @Environment(\.movimientoReducido) private var reducido
    @State private var imagen: UIImage?

    init(_ url: URL?, tamano: CGSize, @ViewBuilder respaldo: () -> some View) {
        self.url = url
        self.tamano = tamano
        self.respaldo = AnyView(respaldo())
    }

    var body: some View {
        ZStack {
            if let visible = imagen ?? enMemoria {
                Image(uiImage: visible)
                    .resizable()
                    .scaledToFit()
                    .transition(.opacity)
            } else {
                respaldo
            }
        }
        .frame(width: tamano.width, height: tamano.height)
        .task(id: url) { await cargar() }
    }

    /// Lo que ya está en memoria se pinta en el primer fotograma (sin parpadeo).
    private var enMemoria: UIImage? {
        guard let url, let cache else { return nil }
        return cache.enMemoria(url)
    }

    private func cargar() async {
        guard let url, let cache, cache.enMemoria(url) == nil else { return }
        let cargada = await cache.imagen(para: url)
        guard !Task.isCancelled, let cargada else { return }
        withAnimation(reducido ? .easeOut(duration: 0.12) : .easeOut(duration: 0.34)) { imagen = cargada }
    }
}
