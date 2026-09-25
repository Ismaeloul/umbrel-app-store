import SwiftUI

/// Galería «Sistema», bloques 11-16 de a1 §11: cristal, avisos, hojas y menús, campos, carga y vacío, iconos.
struct SeccionesSistemaC: View {
    let galeria: EstadoGaleria

    var body: some View {
        SeccionGaleria("Cristal") { BloqueCristal() }
        SeccionGaleria("Avisos y línea de estado") { BloqueAvisos(galeria: galeria) }
        SeccionGaleria("Hojas y menús") { BloqueHojas() }
        SeccionGaleria("Campos") { BloqueCampos(galeria: galeria) }
        SeccionGaleria("Carga y vacío") { BloqueCarga() }
        SeccionGaleria("Iconos") { RejillaIconos() }
    }
}

private struct BloqueAvisos: View {
    let galeria: EstadoGaleria

    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            Flujo(horizontal: S.s2, vertical: S.s2) {
                BotonPalco("Toast", variante: .quieto) { galeria.avisar("«DAZN 1» guardado en favoritos", tono: .ok) }
                BotonPalco("Toast con Deshacer", variante: .quieto) {
                    galeria.avisar("«DAZN 1» eliminado", tono: .warn, accion: "Deshacer")
                }
                BotonPalco("Toast de error", variante: .quieto) { galeria.avisar("No se pudo guardar el favorito", tono: .err) }
                BotonPalco("Línea de estado", variante: .quieto) {
                    galeria.mostrarLinea(ContenidoLinea(texto: "Reconectando la fuente 1…", tono: .warn, icono: .refresh))
                }
                BotonPalco("notify() de señal", variante: .quieto) {
                    galeria.mostrarLinea(ContenidoLinea(texto: "Fuente floja: rellenando el colchón", tono: .warn))
                }
            }
            // `<StatusLineHost />`: la región siempre está montada (vacía, 0 de alto), así que la web deja su hueco de 12.
            if let linea = galeria.linea { LineaEstadoVista(linea) } else { Color.clear.frame(height: 0) }
            LineaEstadoVista(ContenidoLinea(texto: "Fuente 1 verificada. Vas en directo.", tono: .ok, senal: .ok,
                                            dato: "6 s de retraso"))
            LineaEstadoVista(ContenidoLinea(texto: "Sin señal en la fuente 3. Probando la 4.", tono: .err, senal: .fail,
                                            dato: "reintento 20:51"))
            ToastVista(Toast(id: 0, clave: "ok|Hash copiado", texto: "Hash copiado", tono: .ok, icono: nil,
                             tituloAccion: nil, repeticiones: 3, saliendo: false), alAccion: {}, alCerrar: {})
        }
    }
}

/// Las hojas van por la única puerta de la app (`CentroHojas`, b-arquitectura §2.4.2).
private struct BloqueHojas: View {
    @Environment(CentroHojas.self) private var hojas

    var body: some View {
        Flujo(horizontal: S.s2, vertical: S.s2) {
            BotonPalco("Abrir hoja", icono: .plus, variante: .quieto) { hojas.abrir(.muestra(.reproducirOtroHash)) }
            BotonPalco("Panel lateral", icono: .panel, variante: .quieto) { hojas.abrir(.muestra(.atajos)) }
            ZonaMenuContextual()
        }
    }
}

private struct BloqueCampos: View {
    let galeria: EstadoGaleria

    var body: some View {
        @Bindable var galeria = galeria
        VStack(alignment: .leading, spacing: S.s4) {
            CampoTexto("Buscar canal", texto: $galeria.consulta, marcador: "Buscar canal…", icono: .buscar,
                       piel: .buscador, ocultarEtiqueta: true) {
                Tecla("/").padding(.trailing, 6)
            }
            CampoTexto("URL de la lista", texto: .constant(""), marcador: "https://…",
                       error: galeria.consulta == "error" ? "Esa dirección no es válida." : nil)
        }
        .tarjeta()
    }
}

private struct BloqueCarga: View {
    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            VStack(alignment: .leading, spacing: S.s4) {
                EsqueletoRelativo(fraccion: 0.4, alto: 22, radio: R.m)
                EsqueletoRelativo(fraccion: 0.7, alto: 14, radio: R.s)
            }
            .tarjeta()
            FilasEsqueleto(2, anuncio: "Cargando…")
            EstadoVacio(titulo: "Aún no hay listas",
                        texto: "Añade una lista M3U o pega un hash para empezar a ver canales.") {
                BotonPalco("Añadir una lista", icono: .plus) {}
                BotonPalco("Pegar un hash", icono: .paste, variante: .quieto) {}
            }
            .tarjeta()
        }
    }
}

/// Un `Skeleton` de ancho en % de su caja.
private struct EsqueletoRelativo: View {
    let fraccion: CGFloat
    let alto: CGFloat
    let radio: CGFloat
    @State private var ancho: CGFloat = 0

    var body: some View {
        Color.clear
            .frame(height: alto)
            .frame(maxWidth: .infinity)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { ancho = $0 }
            .overlay(alignment: .leading) { Esqueleto(ancho: ancho * fraccion, alto: alto, radio: radio) }
    }
}
