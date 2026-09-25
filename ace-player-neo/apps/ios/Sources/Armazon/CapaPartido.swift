import SwiftUI

/* La capa del teatro (b-arquitectura §2.4.6 y §3.5, M4): `TeatroView(destino:)` para `.partido`/`.canal` y la
   galería «Sistema» para `.sistema`, encima de las pestañas, con fondo opaco `--bg`. Sigue a `Navegador.capa`
   y deja que `TransicionTeatro` la anime: zoom de ida desde la tarjeta, vuelta de la web, borde izquierdo
   (a2 §2.4) y la acción «escape» de VoiceOver (el mismo atrás). Un partido distinto empieza arriba (a2 §12:
   `.id(destino)`). */

struct CapaPartido: View {
    let inmersivo: Bool
    @Environment(Navegador.self) private var navegador
    @Environment(TransicionTeatro.self) private var transicion
    @Environment(Reproductor.self) private var reproductor
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let destino = transicion.mostrado {
                contenido(destino)
                    .id(destino)
                    .frame(width: maquetacion.ancho, height: maquetacion.alto, alignment: .topLeading)
                    .background(Palco.bg)
                    .modifier(ZoomTeatro(progreso: transicion.progreso, origen: transicion.origen,
                                         radio: transicion.radioOrigen, foto: transicion.fotoOrigen,
                                         opacidadFoto: transicion.opacidadFoto,
                                         ventana: ventana))
                    .opacity(transicion.opacidadTeatro)
                    .offset(x: transicion.entradaTeatro + transicion.arrastreBorde)
                    .gesture(borde(destino))
                    .accessibilityAction(.escape) { navegador.atras() }
            }
        }
        .onChange(of: maquetacion, initial: true) { _, valor in transicion.maquetacion = valor }
        .onChange(of: navegador.capa, initial: true) { antes, ahora in seguir(antes: antes, ahora: ahora) }
    }

    private var ventana: CGRect { CGRect(x: 0, y: 0, width: maquetacion.ancho, height: maquetacion.alto) }

    @ViewBuilder private func contenido(_ destino: Destino) -> some View {
        if destino.esTeatro {
            TeatroView(destino: destino)
        } else {
            SistemaView()
        }
    }

    /// El borde solo con el teatro en vertical (a2 §2.4), sin inmersivo y sin una transición en marcha.
    private func borde(_ destino: Destino) -> BordeAtras {
        let activo: Bool = destino.esTeatro && !inmersivo && navegador.capa == destino && !transicion.activa
        let transicion = self.transicion
        let navegador = self.navegador
        let reducido = self.reducido
        return BordeAtras(activo: activo) { dx in
            transicion.arrastrarBorde(Double(dx))
        } alSoltar: { dx, vx in
            guard transicion.soltarBorde(dx: Double(dx), vx: Double(vx), reducido: reducido) else { return }
            navegador.haptica?.disparar(.ligera)  // a2 §2.4: la háptica de «minimizar»
            navegador.atras()
        }
    }

    /// La capa sigue a la ruta: abrir, cambiar de teatro sin transición o cerrar con la vuelta de la web.
    private func seguir(antes: Destino?, ahora: Destino?) {
        let transicion = self.transicion
        let reducido = self.reducido
        guard let ahora else {
            guard transicion.mostrado != nil else { return }
            let suena: Bool = reproductor.canal != nil
            let marcoVideo: CGRect? = escenario(de: transicion.mostrado)
            Task { await transicion.cerrar(haciaMini: suena, desde: marcoVideo, reducido: reducido) }
            return
        }
        if transicion.mostrado == nil && antes == ahora {  // arranque con la capa ya puesta
            transicion.mostrarYa(ahora)
        } else if transicion.mostrado == nil || transicion.mostrado == ahora {
            let origen = navegador.origenApertura
            Task { await transicion.abrir(ahora, desde: origen, reducido: reducido) }
        } else {
            transicion.mostrarYa(ahora)  // de un teatro a otro (zapping, «Otras fuentes»)
        }
    }

    private func escenario(de destino: Destino?) -> CGRect? {
        guard case .partido(let id) = destino else { return nil }
        return transicion.marcos[ClaveMarco(pieza: .escenario, partido: id)]
    }
}

/// El zoom de la ida (§3.5): la capa entera escala uniformemente desde el origen, recortada a un marco que crece
/// del origen a la ventana con el radio del origen → 0; encima, la foto de la tarjeta se funde. Todo sale de
/// `progreso` con funciones lineales, así que SwiftUI anima la escala, el desplazamiento y el recorte (forma
/// animable) con el mismo muelle, igual que si animara `progreso`. Sin origen (o al acabar) todo vale la identidad:
/// los mismos modificadores siempre, sin ramas, para que el teatro no se rehaga (perdería su estado) al terminar.
private struct ZoomTeatro: ViewModifier {
    let progreso: Double
    let origen: CGRect?
    let radio: Double
    let foto: UIView?
    let opacidadFoto: Double
    let ventana: CGRect

    func body(content: Content) -> some View {
        let desdeRect: CGRect = origen ?? ventana
        let desde = Marco(x: desdeRect.minX, y: desdeRect.minY, ancho: desdeRect.width, alto: desdeRect.height)
        let hasta = Marco(x: 0, y: 0, ancho: ventana.width, alto: ventana.height)
        let t: TransformacionVuelo = GeometriaVuelo.zoom(origen: desde, destino: hasta, progreso: progreso)
        let recorte: Marco = GeometriaVuelo.marco(desde: desde, hasta: hasta, progreso: progreso)
        let esquinas: CGFloat = CGFloat(GeometriaVuelo.radio(inicial: radio, progreso: progreso))
        let marco = CGRect(x: recorte.x, y: recorte.y, width: recorte.ancho, height: recorte.alto)
        return content
            .scaleEffect(CGFloat(t.escala), anchor: .topLeading)
            .offset(x: CGFloat(t.dx), y: CGFloat(t.dy))
            .overlay(alignment: .topLeading) { fotoQueSeFunde(marco) }
            .clipShape(RecorteZoom(marco: marco, radio: esquinas))
    }

    @ViewBuilder private func fotoQueSeFunde(_ marco: CGRect) -> some View {
        if let foto {
            FotoVuelo(foto: foto)
                .frame(width: marco.width, height: marco.height)
                .offset(x: marco.minX, y: marco.minY)
                .opacity(opacidadFoto)
                .allowsHitTesting(false)
        }
    }
}

/// Un rectángulo redondeado en un marco de la capa (el recorte del zoom), animable.
private struct RecorteZoom: Shape {
    var marco: CGRect
    var radio: CGFloat

    var animatableData: AnimatablePair<CGRect.AnimatableData, CGFloat> {
        get { AnimatablePair(marco.animatableData, radio) }
        set {
            marco.animatableData = newValue.first
            radio = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        Path(roundedRect: marco, cornerRadius: max(0, radio), style: .circular)
    }
}
