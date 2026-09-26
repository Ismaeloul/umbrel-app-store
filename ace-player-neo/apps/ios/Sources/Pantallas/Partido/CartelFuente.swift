import SwiftUI

/* Cartel de fuente (SourcePoster.tsx, sources.css; a4 §12.6): tesela 16:9 con la marca del canal (tono y dorsal
   del canal; arriba, en el sitio de la sigla, el PROVEEDOR), su número arriba a la derecha y «En pantalla» en oro
   abajo a la izquierda si es la que suena; alrededor, el filo del estado (oro en la que suena); debajo, el nombre
   del canal SIN el proveedor (dos líneas como mucho; NombreCartel, Isma 26-sep), el anillo con su palabra, la
   calidad y el tipo, y la frase. Toque: háptica rígida y elegir. Pulsación larga: menú «Fuente n» (sin háptica); las mismas opciones
   van a VoiceOver como acciones. Sirve igual para cualquier tipo de fuente (`FilaFuente` de la sesión, M3). */

struct CartelFuente: View {
    let fila: FilaFuente
    let enPartido: Bool
    var espacio: Namespace.ID?
    let video = EntornoVideo()
    @Environment(CentroHojas.self) private var hojas

    var body: some View {
        Button {
            video.haptica.disparar(.rigida)
            guard !fila.enPantalla else { return }
            video.elegirFuente(fila.id)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                TeselaCartel(fila: fila, espacio: espacio)
                CuerpoCartel(fila: fila)
            }
            .contentShape(RoundedRectangle(cornerRadius: R.m, style: .circular))
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(RoundedRectangle(cornerRadius: R.m, style: .circular))))
        .menuContextual(acciones)
        .accessibilityLabel(fila.descripcion)
        .accessibilityAddTraits(fila.activa ? .isSelected : [])
        .accessibilityIdentifier(IDUI.cartelFuente(fila.numero))
    }

    /// Las opciones del menú «Fuente n» (`rowMenu`, M3) con su acción (ninguna vibra).
    private var acciones: [AccionMenu] {
        OpcionesFuente.menu(fila, enPartido: enPartido).map { (opcion: OpcionMenu) -> AccionMenu in
            AccionMenu(opcion) { ejecutar(opcion.id) }
        }
    }

    private func ejecutar(_ id: String) {
        let hash = fila.id
        guard let opcion = OpcionFuente(rawValue: id) else { return }
        switch opcion {
        case .ver: video.elegirFuente(hash)
        case .copiarHash: video.copiar(hash, bien: "Hash copiado", mal: "No se pudo copiar el hash")
        case .abrir: video.abrirEnAceStream(hash)
        case .correcto:
            let fuentes = video.fuentes
            Task { await fuentes.confirmar(hash) }
        case .reportar: hojas.abrir(.reportar(hash: hash, numero: fila.numero))
        }
    }
}

/// La tesela con su filo, el número y «En pantalla».
private struct TeselaCartel: View {
    let fila: FilaFuente
    let espacio: Namespace.ID?
    @State private var alto: CGFloat = 90

    /// `.src-poster .dorsal__abbrev { max-width: calc(100% - var(--s) * 0.12 - 46px) }`: el proveedor acaba en «…»
    /// antes del número. MarcaCanal ya quita 0,24·s, así que aquí van 46 − 0,12·s.
    private var reserva: CGFloat { 46 - alto * 0.12 }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        ZStack {
            forma.fill(Palco.surface2)
            MarcaCanal(
                nombre: ReglasFuentes.nombreCanal(fila.entrada), forma: .tesela, tamano: alto,
                sigla: NombreCartel.proveedorTesela(fila.presentacion), reservaDerecha: reserva
            )
            .clipShape(forma)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { alto = max(1, $0) }
        .opacity(opacidad)
        .overlay(alignment: .topTrailing) { NumeroCartel(numero: fila.numero).padding(6) }
        .overlay(alignment: .bottomLeading) { enPantalla }
        .sombra(.s3, forma: forma)
        .padding(2)
        .overlay { FiloCartel(fila: fila) }
        .padding(-2)
        .accessibilityHidden(true)
    }

    private var opacidad: Double {
        if fila.enPantalla { return 1 }
        if fila.efectivo.reportada || fila.senal == .fail { return 0.42 }
        return fila.senal == .pending ? 0.7 : 1
    }

    @ViewBuilder private var enPantalla: some View {
        if fila.enPantalla {
            Capsula("En pantalla", tono: .oro, tamano: .sm, icono: .senal)
                .modifier(ViajeEnPantalla(espacio: espacio))
                .sombra([CapaSombra(y: 4, desenfoque: 12, expansion: -4, color: Color.black.opacity(0.55))], forma: Capsule())
                .padding(6)
        }
    }
}

/// Número de la fuente: pastilla de 26 (mín.), relleno 0 7, negro al 58 %, borde blanco al 14 %, cifra 13.
private struct NumeroCartel: View {
    let numero: Int

    var body: some View {
        Num(String(numero), tamano: 13)
            .foregroundStyle(Palco.onVideo)
            .padding(.horizontal, 7)
            .frame(minWidth: 26, minHeight: 26)
            .background(Capsule().fill(Color.black.opacity(0.58)))
            .bordeInterior(Color.white.opacity(0.14), forma: Capsule())
    }
}

/// El filo del estado alrededor de la tesela (2; 3 en la activa y en la que suena), a 2 de ella, radio 16:
/// continuo (ok, sin señal, en pantalla oro), discontinuo (floja, comprobando) o punteado (pendiente, reportada).
private struct FiloCartel: View {
    let fila: FilaFuente

    private enum Trazo { case continuo, discontinuo, punteado }

    private var estilo: (color: Color, trazo: Trazo) {
        if fila.enPantalla { return (Palco.accent, .continuo) }
        if fila.efectivo.reportada { return (Palco.weak, .punteado) }
        switch fila.senal {
        case .ok: return (Palco.ok, .continuo)
        case .weak: return (Palco.weak, .discontinuo)
        case .checking: return (Palco.text2, .discontinuo)
        case .pending: return (Palco.text3, .punteado)
        case .fail: return (Palco.fail, .continuo)
        }
    }

    var body: some View {
        let grosor: CGFloat = fila.activa || fila.enPantalla ? 3 : 2
        let e = estilo
        let dash: [CGFloat] =
            switch e.trazo {
            case .continuo: []
            case .discontinuo: [3 * grosor, 3 * grosor]
            case .punteado: [0.01, 2 * grosor]
            }
        RoundedRectangle(cornerRadius: 16, style: .circular)
            .inset(by: -grosor / 2)
            .stroke(e.color, style: StrokeStyle(lineWidth: grosor, lineCap: .round, dash: dash))
            .allowsHitTesting(false)
    }
}

/// De arriba abajo (SourcePoster.tsx, web 613f80e): el nombre del canal sin el proveedor (15/650/88, dos líneas con
/// «…»); el anillo 14 con su palabra, en su línea; los datos técnicos, una etiqueta entera por dato que baja de línea
/// si no cabe (sin datos, sin línea); y la frase (12, dos líneas) solo si no repite el estado.
private struct CuerpoCartel: View {
    let fila: FilaFuente

    /// El anillo del medidor (`ringStateOf`): la reportada tiene dibujo propio y la que está en pantalla, oro.
    private var anillo: EstadoAnillo {
        if fila.enPantalla { return .activa }
        if fila.efectivo.reportada { return .reportada }
        return .senal(fila.senal)
    }

    var body: some View {
        let etiquetas: [DatosCartel.Etiqueta] = DatosCartel.etiquetas(fila.entrada, fila.presentacion)
        let frase: String? = DatosCartel.frase(palabra: fila.palabra, detalle: fila.detalle)
        VStack(alignment: .leading, spacing: 0) {
            Text(NombreCartel.nombre(fila.entrada, fila.presentacion))
                .estilo(EstiloTexto(tamano: 15, peso: 650, anchura: 88, altoLinea: 1.1))
                .foregroundStyle(Palco.text)
                .lineLimit(2)
                .truncationMode(.tail)
                .fixedSize(horizontal: false, vertical: true)
            AnilloSenal(anillo, tamano: 14, palabra: fila.palabra)
                .padding(.top, 3)
            if !etiquetas.isEmpty {
                Flujo(horizontal: 4, vertical: 4) {
                    ForEach(etiquetas, id: \.self) { EtiquetaCartel(etiqueta: $0) }
                }
                .padding(.top, 5)
            }
            if let frase {
                Text(frase)
                    .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.25))
                    .foregroundStyle(Palco.text2)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 5)
            }
        }
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .multilineTextAlignment(.leading)
        .accessibilityHidden(true)
    }
}

/// `.src-poster__tag`: la cápsula sm neutra a 20 de alto y relleno 0 7, tinta `--text-2`, siempre entera. La calidad,
/// rellena (`--line-soft`); el tipo de fuente, solo con el filo (`inset 0 0 0 1px --line-strong`).
private struct EtiquetaCartel: View {
    let etiqueta: DatosCartel.Etiqueta

    var body: some View {
        let tipo: Bool = etiqueta.clase == .tipo
        Text(etiqueta.texto)
            .estilo(.capsulaSm)
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(Palco.text2)
            .padding(.horizontal, 7)
            .frame(height: 20)
            .background(Capsule().fill(tipo ? Color.clear : Palco.lineSoft))
            .overlay { if tipo { Capsule().strokeBorder(Palco.lineStrong, lineWidth: 1) } }
    }
}

/// La cápsula «En pantalla» es la misma pieza en cualquier cartel: viaja de uno a otro.
private struct ViajeEnPantalla: ViewModifier {
    let espacio: Namespace.ID?

    func body(content: Content) -> some View {
        if let espacio {
            content.matchedGeometryEffect(id: "en-pantalla", in: espacio)
        } else {
            content
        }
    }
}
