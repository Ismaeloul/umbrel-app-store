import SwiftUI

/// Galería «Sistema», bloques 11-16 de a1 §11: cristal, avisos, hojas y menús, campos, carga y vacío, iconos.
struct SeccionesSistemaC: View {
    let galeria: EstadoGaleria

    var body: some View {
        SeccionGaleria("Cristal") { BloqueCristal() }
        SeccionGaleria("Avisos y línea de estado") { BloqueAvisos(galeria: galeria) }
        SeccionGaleria("Hojas y menús") { BloqueHojas(galeria: galeria) }
        SeccionGaleria("Campos") { BloqueCampos(galeria: galeria) }
        SeccionGaleria("Carga y vacío") { BloqueCarga() }
        SeccionGaleria("Iconos") { RejillaIconos() }
    }
}

/// Los tres cristales sobre la retransmisión de mentira (paneles de 72, texto 650 centrado).
struct BloqueCristal: View {
    var body: some View {
        VStack(spacing: S.s3) {
            panel("Regular (sobre contenido)", .regular)
            panel("Denso (sobre listas)", .denso)
            panel("Sobre vídeo (siempre oscuro)", .video)
        }
        .padding(.vertical, S.s6)
        .padding(.horizontal, S.s4)
        .background(FondoRetransmision())
        .clipShape(RoundedRectangle(cornerRadius: R.xl, style: .circular))
    }

    private func panel(_ titulo: String, _ tipo: TipoCristal) -> some View {
        Text(titulo)
            .estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.45))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 72 - 2 * S.s3)
            .panelCristal(tipo)
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
            if let linea = galeria.linea { LineaEstadoVista(linea) }
            LineaEstadoVista(ContenidoLinea(texto: "Fuente 1 verificada. Vas en directo.", tono: .ok, senal: .ok,
                                            dato: "6 s de retraso"))
            LineaEstadoVista(ContenidoLinea(texto: "Sin señal en la fuente 3. Probando la 4.", tono: .err, senal: .fail,
                                            dato: "reintento 20:51"))
            ToastVista(Toast(id: 0, clave: "ok|Hash copiado", texto: "Hash copiado", tono: .ok, icono: nil,
                             tituloAccion: nil, repeticiones: 3, saliendo: false), alAccion: {}, alCerrar: {})
        }
    }
}

private struct BloqueHojas: View {
    let galeria: EstadoGaleria

    var body: some View {
        Flujo(horizontal: S.s2, vertical: S.s2) {
            BotonPalco("Abrir hoja", icono: .plus, variante: .quieto) { HojaMuestra.abrir() }
            BotonPalco("Panel lateral", icono: .panel, variante: .quieto) { HojaMuestra.abrirLateral() }
            ZonaMenuContextual()
        }
    }
}

/// `.sis-context`: la zona de la pulsación larga (44 de alto, relleno 0 16, radio 14, borde discontinuo).
/// El menú contextual con vista previa sale del canario C7 hasta que exista `Armazon/Menus.swift` (M4).
struct ZonaMenuContextual: View {
    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        Text("Clic derecho o pulsación larga aquí")
            .estilo(EstiloTexto(tamano: 13, peso: 450))
            .foregroundStyle(Palco.text2)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(Palco.bg, in: forma)
            .overlay(forma.strokeBorder(Palco.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
            .sondaMenuContextual(acciones) {
                Text("Acciones de la fuente").estilo(.menu).padding(20).background(Palco.surface)
            }
    }

    private var acciones: [SondaAccionMenu] {
        [
        SondaAccionMenu(opcion: SondaOpcionMenu(id: "fav", titulo: "Guardar en favoritos"), ejecutar: {}),
        SondaAccionMenu(opcion: SondaOpcionMenu(id: "copiar", titulo: "Copiar hash"), ejecutar: {}),
        SondaAccionMenu(opcion: SondaOpcionMenu(id: "abrir", titulo: "Abrir en…"), ejecutar: {}),
        SondaAccionMenu(opcion: SondaOpcionMenu(id: "nerd", titulo: "Datos técnicos", marcada: true), ejecutar: {}),
        SondaAccionMenu(opcion: SondaOpcionMenu(id: "reportar", titulo: "Reportar la fuente", peligro: true,
                                                separadaAntes: true), ejecutar: {}),
        ]
    }
}

/// La hoja «Reproducir otro hash» y el panel «Atajos de ejemplo» de la galería.
@MainActor enum HojaMuestra {
    static func abrir() {
        PresentadorHoja.presentar {
            ContenidoHoja(titulo: "Reproducir otro hash", descripcion: "Pega un Content ID o un enlace acestream://",
                          tamano: .sm, alCerrar: { PresentadorHoja.cerrar() }) {
                CampoTexto("Content ID o enlace", texto: .constant(""), marcador: "acestream://…",
                           pista: "40 caracteres hexadecimales.")
            } pie: {
                BotonPalco("Cancelar", variante: .quieto, bloque: true) { PresentadorHoja.cerrar() }
                BotonPalco("Reproducir", icono: .play, bloque: true) { PresentadorHoja.cerrar() }
            }
            .background(Palco.glassSolid)
        }
    }

    static func abrirLateral() {
        PresentadorHoja.presentar(grande: true) {
            ContenidoHoja(titulo: "Atajos de ejemplo", alCerrar: { PresentadorHoja.cerrar() }) {
                HStack(spacing: 4) {
                    Text("Pulsa").estilo(.cuerpo)
                    Tecla("?")
                    Text("en cualquier sitio para ver los atajos de verdad.").estilo(.cuerpo)
                }
                .foregroundStyle(Palco.text2)
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Palco.glassSolid)
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

/// `.sis-icons`: rejilla `minmax(96, 1fr)` (3 columnas a 390), cada celda con el icono de 24 y su nombre.
struct RejillaIconos: View {
    private let columnas = [GridItem(.adaptive(minimum: 96), spacing: S.s2)]

    var body: some View {
        LazyVGrid(columns: columnas, spacing: S.s2) {
            ForEach(NombreIcono.allCases, id: \.self) { nombre in
                CeldaIcono(nombre: nombre)
            }
        }
    }
}

private struct CeldaIcono: View {
    let nombre: NombreIcono

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        VStack(spacing: 6) {
            IconoPalco(nombre, tamano: 24).foregroundStyle(Palco.text)
            Text(nombre.rawValue).font(Martian.fuente(11)).altoDeLineaMartian(1.45, tamano: 11).foregroundStyle(Palco.text2)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity)
        .background(Palco.surface, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
    }
}
