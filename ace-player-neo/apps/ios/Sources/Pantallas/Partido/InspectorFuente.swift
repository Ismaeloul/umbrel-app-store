import SwiftUI

/* Inspector de la fuente activa (SourceInspector.tsx, `.src-inspector` de sources.css; a4 §12.8): una cápsula
   que se desliza en horizontal con las acciones de la fuente en pantalla (o del canal suelto): Favorito ·
   Rebuscar (partido) · Pegar hash · Copiar hash · Es el canal correcto (partido) · Reportar · Abrir en….
   Los bordes por los que quedan acciones se funden en 36 pt. Sin fuente activa en un partido: solo «Pegar
   hash», a todo el ancho. */

struct ObjetivoInspector: Hashable {
    var hash: String
    var titulo: String
    var ih: Bool
    var aprendida: Bool
    /// Número de la fuente (para «Reportar fuente»), 0 si no es de la lista.
    var numero: Int
}

struct InspectorFuente: View {
    let objetivo: ObjetivoInspector?
    let enPartido: Bool
    let partidoId: String?
    let video = EntornoVideo()
    @Environment(CentroHojas.self) private var hojas
    @Environment(BajasPendientes.self) private var bajas

    var body: some View {
        if let objetivo {
            CarrilInspector { acciones(objetivo) }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Acciones de la fuente")
        } else if enPartido {
            soloPegar
        }
    }

    /// Sin fuente activa solo queda «Pegar hash» (regla 26): un botón normal que llena la cápsula, alto 48.
    private var soloPegar: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        return Button { pegar() } label: {
            HStack(spacing: S.s2) {
                IconoPalco(.paste, tamano: 18)
                Text("Pegar hash").estilo(.botonSm)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(RoundedRectangle(cornerRadius: R.l - 4, style: .circular))))
        .foregroundStyle(Palco.text)
        .padding(4)
        .background(Palco.surface, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Pegar hash")
    }

    @ViewBuilder private func acciones(_ o: ObjetivoInspector) -> some View {
        let favorito = video.datos.biblioteca.datos?.favorites.contains { $0.id == o.hash } ?? false
        AccionInspector(favorito ? "En favoritos" : "Favorito", icono: favorito ? .starF : .star, pulsado: favorito) {
            alternarFavorito(o, guardado: favorito)
        }
        if enPartido {
            let rebuscando: Bool = video.fuentes.rebuscando
            AccionInspector(rebuscando ? "Rebuscando…" : "Rebuscar", icono: .refresh, girando: rebuscando) {
                let fuentes = video.fuentes
                Task { await fuentes.rebuscar() }
            }
            .disabled(rebuscando)
        }
        AccionInspector("Pegar hash", icono: .paste) { pegar() }
        AccionInspector("Copiar hash", icono: .copy) {
            video.copiar(o.hash, bien: "Hash copiado", mal: "No se pudo copiar el hash")
        }
        if enPartido {
            AccionInspector(o.aprendida ? "✓ Canal aprendido" : "Es el canal correcto", icono: o.aprendida ? .check : .learn,
                            pulsado: o.aprendida) {
                let fuentes = video.fuentes
                Task { await fuentes.confirmar(o.hash) }
            }
            .disabled(o.aprendida)
        }
        AccionInspector("Reportar", icono: .flag) { hojas.abrir(.reportar(hash: o.hash, numero: o.numero)) }
        AbrirEnOtraApp(hash: o.hash, ih: o.ih)
    }

    private func pegar() {
        hojas.abrir(.pegar(partidoId.map { ContextoPegar.partido(id: $0) } ?? .libre))
    }

    /// Añadir abre «Guardar favorito» (nombre, categoría «Fútbol»); quitar borra con «Deshacer» (biblioteca).
    private func alternarFavorito(_ o: ObjetivoInspector, guardado: Bool) {
        let canal = RefCanal(hash: o.hash, titulo: o.titulo, coleccion: .favorites, ih: o.ih)
        if guardado {
            bajas.quitar(canal, datos: video.datos, avisos: video.avisos)
        } else {
            hojas.abrir(.guardarFavorito(canal))
        }
    }
}

/// «Abrir en…» con el mismo dibujo que las demás acciones: menú «Abrir en otra app» (a4 §12.8).
private struct AbrirEnOtraApp: View {
    let hash: String
    let ih: Bool
    let video = EntornoVideo()

    var body: some View {
        Menu {
            ContenidoMenu(acciones: acciones)
        } label: {
            EtiquetaAccion(titulo: "Abrir en…", icono: .externo, pulsado: false, girando: false)
        }
        .menuOrder(.fixed)
        .accessibilityLabel("Abrir en otra app")
    }

    private var acciones: [AccionMenu] {
        [
            AccionMenu(OpcionMenu(id: "app", titulo: "Abrir en la app de AceStream", icono: .externo)) {
                video.abrirEnAceStream(hash)
                video.avisos.avisar("Abriendo en AceStream… Si no se abre, instala la app de AceStream.", tono: .info)
            },
            AccionMenu(OpcionMenu(id: "vlc", titulo: "Copiar URL del stream (VLC)", icono: .link)) {
                video.copiarURLStream(hash, infohash: ih)
            },
            AccionMenu(OpcionMenu(id: "enlace", titulo: "Copiar enlace acestream://", icono: .copy)) {
                video.copiar("acestream://\(hash)", bien: "Enlace acestream:// copiado", mal: "No se pudo copiar", icono: .link)
            },
        ]
    }
}

/// Una acción: columna con icono 18 y rótulo 12/650/88, mín. 76×62, relleno 6 8, radio 14. Pulsada: tinta
/// `--accent-ink` sobre `--accent-wash`.
private struct AccionInspector: View {
    let titulo: String
    let icono: NombreIcono
    let pulsado: Bool
    let girando: Bool
    let accion: () -> Void

    init(_ titulo: String, icono: NombreIcono, pulsado: Bool = false, girando: Bool = false, accion: @escaping () -> Void) {
        self.titulo = titulo
        self.icono = icono
        self.pulsado = pulsado
        self.girando = girando
        self.accion = accion
    }

    var body: some View {
        Button(action: accion) {
            EtiquetaAccion(titulo: titulo, icono: icono, pulsado: pulsado, girando: girando)
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(RoundedRectangle(cornerRadius: R.m, style: .circular))))
        .accessibilityAddTraits(pulsado ? .isSelected : [])
    }
}

private struct EtiquetaAccion: View {
    let titulo: String
    let icono: NombreIcono
    let pulsado: Bool
    let girando: Bool
    @Environment(\.isEnabled) private var habilitado

    var body: some View {
        VStack(spacing: 4) {
            IconoGiratorio(icono: icono, girando: girando)
            Text(titulo).estilo(EstiloTexto(tamano: 12, peso: 650, anchura: 88, altoLinea: 1.1)).lineLimit(1).fixedSize()
        }
        .foregroundStyle(pulsado ? Palco.accentInk : Palco.text)
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .frame(minWidth: 76, minHeight: 62)
        .background(pulsado ? Palco.accentWash : Color.clear, in: RoundedRectangle(cornerRadius: R.m, style: .circular))
        .opacity(habilitado || pulsado ? 1 : 0.5)
        .contentShape(RoundedRectangle(cornerRadius: R.m, style: .circular))
    }
}

/// El icono de «Rebuscar» gira 900 ms lineal mientras rebusca (con movimiento reducido, quieto).
struct IconoGiratorio: View {
    let icono: NombreIcono
    let girando: Bool
    var tamano: CGFloat = 18
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        if girando && !reducido {
            TimelineView(.animation) { contexto in
                let vuelta: Double = contexto.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 0.9) / 0.9
                IconoPalco(icono, tamano: tamano).rotationEffect(.degrees(vuelta * 360))
            }
        } else {
            IconoPalco(icono, tamano: tamano)
        }
    }
}

/// La cápsula que se desliza: relleno 4, separación 4, radio 18, `--surface`, borde 1 `--line-soft`; fundido de
/// 36 pt en los bordes por los que quedan acciones (solo derecha al principio, los dos en medio, izquierda al final).
private struct CarrilInspector<Contenido: View>: View {
    @ViewBuilder let contenido: () -> Contenido
    @State private var borde: (inicio: Bool, fin: Bool) = (false, true)

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) { contenido() }
                .padding(4)
                .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .onScrollGeometryChange(for: [Bool].self) { geo in
            let maximo = geo.contentSize.width - geo.containerSize.width
            return [geo.contentOffset.x > 1, geo.contentOffset.x < maximo - 1]
        } action: { _, nuevo in
            borde = (nuevo[0], nuevo[1])
        }
        .mask { MascaraBordes(inicio: borde.inicio, fin: borde.fin) }
        .background(Palco.surface, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .clipShape(forma)
    }
}

private struct MascaraBordes: View {
    let inicio: Bool
    let fin: Bool

    var body: some View {
        HStack(spacing: 0) {
            borde(fundido: inicio, colores: [.clear, .black])
            Color.black
            borde(fundido: fin, colores: [.black, .clear])
        }
    }

    @ViewBuilder private func borde(fundido: Bool, colores: [Color]) -> some View {
        if fundido {
            LinearGradient(colors: colores, startPoint: .leading, endPoint: .trailing).frame(width: 36)
        } else {
            Color.black.frame(width: 36)
        }
    }
}
