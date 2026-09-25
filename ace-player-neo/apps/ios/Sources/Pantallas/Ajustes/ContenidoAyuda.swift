import SwiftUI

/* Hoja «Atajos de teclado» (b-arquitectura §2.8, M7; a6 §12; help/panel.tsx, help/gestures.ts): con el dedo, el
   orden es Gestos · Teclado · Ratón, separados 32. Titular de bloque con la pastilla de 34 en oro lavado y el
   título 22/800/125. Filas de 48 como mínimo con la línea de abajo; por debajo de 480 de ancho, una columna (la
   «tecla de palabra» y debajo lo que hace), desde 480 dos columnas. En «Gestos», las filas de la web más las de
   los gestos que la app añade (b-arquitectura §0.5, A-7) con el mismo formato; las del mini dicen los gestos del
   mini de la app (abajo lo detiene, a los lados cambia de fuente: §3.7). */

struct ContenidoAyuda: View {
    @Environment(CentroHojas.self) private var hojas
    @Environment(\.maquetacion) private var maquetacion

    /// (gesto, qué hace) de «Gestos».
    static let gestos: [(String, String)] = [
        ("Desliza a los lados", "Agenda: cambia de día"),
        ("Tira hacia abajo", "Agenda: la actualiza"),
        ("Desliza a los lados", "Canales: cambia de pestaña"),
        ("Desliza a los lados", "Partido, en la barra «Emitiendo»: pasa a otra fuente"),
        ("Desliza hacia abajo", "Vídeo: lo minimiza y sigue sonando"),
        ("Desliza el vídeo a los lados", "Vídeo: pasa a otra fuente"),
        ("Toca el vídeo", "Enseña u oculta los controles"),
        ("Toca dos veces el vídeo", "Pantalla completa"),
        ("Desliza desde el borde izquierdo", "Partido: vuelve atrás"),
        ("Desliza hacia arriba", "Mini-reproductor: lo abre en grande"),
        ("Desliza hacia abajo", "Mini-reproductor: lo detiene (con «Deshacer»)"),
        ("Desliza a los lados", "Mini-reproductor: pasa a otra fuente"),
        ("Desliza el asa hacia abajo", "Una hoja: la cierra"),
        ("Mantén pulsado", "Un partido, un canal, un dispositivo o el vídeo: sus opciones"),
        ("Toca la pestaña activa", "Vuelve arriba"),
    ]

    /// Los atajos registrados desde Ajustes (Shell.tsx y player/index.tsx): (grupo, [(teclas, qué hace)]).
    static let teclado: [(String, [([String], String)])] = [
        ("General", [(["?"], "Enseña esta ayuda"), (["/"], "Abre la biblioteca y enfoca el buscador")]),
        ("Reproductor", [
            (["Espacio", "K"], "Pausa y reanuda"), (["M"], "Silencia o devuelve el sonido"), (["J"], "Retrocede 30 s"),
            (["F"], "Pantalla completa"), (["P"], "Imagen dentro de imagen"), (["S"], "Datos técnicos"),
            (["G"], "Favorito del canal que suena"), (["←"], "Canal anterior"), (["→"], "Canal siguiente"),
        ]),
    ]

    static let raton: [(String, String)] = [
        ("Clic en el vídeo", "Pausa o reanuda"),
        ("Doble clic en el vídeo", "Pantalla completa"),
        ("Clic derecho", "Un partido, un canal, un dispositivo o el vídeo: sus opciones"),
        ("Doble clic en un partido", "Lo abre en el centro de partido"),
        ("Rueda del ratón", "Desplaza a los lados la tira de días y las filas de carteles"),
    ]

    private var dosColumnas: Bool { maquetacion.ancho >= 480 }

    var body: some View {
        ContenidoHoja(titulo: "Atajos de teclado", tamano: .md, alCerrar: { hojas.cerrar() }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    BloqueAyuda(titulo: "Gestos", icono: .movil) {
                        ForEach(Array(Self.gestos.enumerated()), id: \.offset) { (par: (offset: Int, element: (String, String))) in
                            FilaAyuda(dosColumnas: dosColumnas, que: par.element.1) { TeclaPalabra(texto: par.element.0) }
                        }
                    }
                    bloqueTeclado
                    BloqueAyuda(titulo: "Ratón", icono: .pantalla) {
                        ForEach(Array(Self.raton.enumerated()), id: \.offset) { (par: (offset: Int, element: (String, String))) in
                            FilaAyuda(dosColumnas: dosColumnas, que: par.element.1) { TeclaPalabra(texto: par.element.0) }
                        }
                    }
                }
                .padding(.bottom, 20)
            }
            .scrollIndicators(.hidden)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.hojaAyuda)
    }

    private var bloqueTeclado: some View {
        BloqueAyuda(titulo: "Teclado", icono: .kbd) {
            ForEach(Array(Self.teclado.enumerated()), id: \.offset) { (grupo: (offset: Int, element: (String, [([String], String)]))) in
                Text(grupo.element.0)
                    .estilo(.kicker)
                    .foregroundStyle(Palco.text3)
                    .padding(.top, grupo.offset == 0 ? 0 : 12)
                    .accessibilityAddTraits(.isHeader)
                ForEach(Array(grupo.element.1.enumerated()), id: \.offset) { (fila: (offset: Int, element: ([String], String))) in
                    FilaAyuda(dosColumnas: dosColumnas, que: fila.element.1) { TeclasAtajo(teclas: fila.element.0) }
                }
            }
            Text("Los atajos no funcionan mientras escribes en un campo (salvo Esc).")
                .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
                .padding(.top, 12)
        }
    }
}

/// Un bloque: pastilla de 34 (radio 10, oro lavado, icono 20 en `--accent-ink`) y el título 22/800/125.
private struct BloqueAyuda<Contenido: View>: View {
    let titulo: String
    let icono: NombreIcono
    let contenido: Contenido

    init(titulo: String, icono: NombreIcono, @ViewBuilder contenido: () -> Contenido) {
        self.titulo = titulo
        self.icono = icono
        self.contenido = contenido()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                IconoPalco(icono, tamano: 20)
                    .foregroundStyle(Palco.accentInk)
                    .frame(width: 34, height: 34)
                    .background(Palco.accentWash, in: RoundedRectangle(cornerRadius: R.s, style: .circular))
                    .accessibilityHidden(true)
                Text(titulo)
                    .estilo(EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1))
                    .foregroundStyle(Palco.text)
                    .accessibilityAddTraits(.isHeader)
            }
            .padding(.bottom, 8)
            contenido
        }
    }
}

/// Una fila: la tecla (o las teclas) y lo que hace, con la línea de abajo.
private struct FilaAyuda<Tecla: View>: View {
    let dosColumnas: Bool
    let que: String
    let tecla: Tecla

    init(dosColumnas: Bool, que: String, @ViewBuilder tecla: () -> Tecla) {
        self.dosColumnas = dosColumnas
        self.que = que
        self.tecla = tecla()
    }

    var body: some View {
        Group {
            if dosColumnas {
                HStack(spacing: 12) {
                    texto.frame(maxWidth: .infinity, alignment: .leading)
                    tecla
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    tecla
                    texto
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.vertical, 10)
        .frame(minHeight: 48)
        .overlay(alignment: .bottom) { Rectangle().fill(Palco.lineSoft).frame(height: 1) }
        .accessibilityElement(children: .combine)
    }

    private var texto: some View {
        Text(que)
            .estilo(EstiloTexto(tamano: 15, peso: 450, altoLinea: 1.25))
            .foregroundStyle(Palco.text)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// «Tecla de palabra» de un gesto: relleno 5 10, radio 6, `--surface-2`, borde `--line` y canto de 2
/// `--line-strong`, texto 13/650/88.
private struct TeclaPalabra: View {
    let texto: String

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.xs, style: .circular)
        Text(texto)
            .estilo(EstiloTexto(tamano: 13, peso: 650, anchura: 88, altoLinea: 1.25))
            .foregroundStyle(Palco.text)
            .padding(.vertical, 5)
            .padding(.horizontal, 10)
            .background(Palco.surface2, in: forma)
            .bordeInterior(Palco.line, forma: forma)
            .overlay(alignment: .bottom) {
                forma.fill(Palco.lineStrong).mask(alignment: .bottom) { Rectangle().frame(height: 2) }
            }
    }
}

/// Las teclas de un atajo (30 × 30 como mínimo, relleno 0 9), unidas con « o ».
private struct TeclasAtajo: View {
    let teclas: [String]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(teclas.enumerated()), id: \.offset) { (par: (offset: Int, element: String)) in
                if par.offset > 0 {
                    Text("o").estilo(EstiloTexto(tamano: 12, peso: 450)).foregroundStyle(Palco.text3)
                }
                TeclaPalabra(texto: par.element).frame(minWidth: 30, minHeight: 30)
            }
        }
    }
}
