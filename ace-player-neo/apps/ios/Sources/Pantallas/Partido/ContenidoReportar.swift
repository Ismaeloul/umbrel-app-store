import SwiftUI

/* Hoja «Reportar fuente» (ReportSheet.tsx; a4 §13.2, tamaño sm): «¿Qué ocurre con esta señal?», la fuente
   («Fuente 2 · M+ Liga de Campeones --> Faro · 3fa1c9d2e0b1»), cinco motivos con «No arranca» marcado cada vez
   que se abre, la nota y «Reportar y comprobar». Reportar NO cambia de fuente; la háptica de éxito y los avisos
   son de la sesión de fuentes (a4 §20.13). */

struct ContenidoReportar: View {
    let hash: String
    let numero: Int
    @Environment(CentroHojas.self) private var hojas
    @Environment(SesionFuentes.self) private var fuentes
    @Environment(DatosApp.self) private var datos
    @Environment(Avisos.self) private var avisos
    @State private var motivo: SourceReportReason = .notStarting
    @State private var ocupado = false

    /// El título de la fuente: de la sesión o, en un canal suelto con la sesión vacía, de la biblioteca.
    private var titulo: String? {
        fuentes.entradas.first { $0.id == hash }?.titulo ?? OtrasFuentes.item(datos.biblioteca.datos, hash: hash)?.title
    }

    var body: some View {
        ContenidoHoja(titulo: "Reportar fuente", descripcion: "¿Qué ocurre con esta señal?", tamano: .sm) {
            hojas.cerrar()
        } cuerpo: {
            VStack(alignment: .leading, spacing: 12) {
                if numero > 0, let titulo { cual(titulo).padding(.top, -14) }
                motivos
                Text("La fuente se apartará temporalmente y el segundo motor la comprobará en segundo plano.")
                    .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } pie: {
            BotonPalco("Reportar y comprobar", icono: .flag, bloque: true, ocupado: ocupado) { enviar() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.hojaReportar)
    }

    /// «Fuente 2 · {título} · {12 primeros del hash en mono}» (13, se parte donde sea).
    private func cual(_ titulo: String) -> some View {
        let mono: Text = Text(verbatim: String(hash.prefix(12))).font(Martian.fuente(13))
        let base: Text = Text(verbatim: "Fuente \(numero) · \(titulo) · ")
        return Text("\(base)\(mono)")
            .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
            .foregroundStyle(Palco.text2)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Caja de relleno 4, separación 2, radio 18, `--surface-2`; filas de 48, relleno 0 14, separación 12, radio 14,
    /// 15/560 con el círculo de 20 en `--accent-edge`; la marcada sobre `--surface` con borde `--line`.
    private var motivos: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        return VStack(spacing: 2) {
            ForEach(ReglasFuentes.motivosReporte) { opcion in
                FilaMotivo(texto: opcion.texto, marcada: opcion.motivo == motivo) { motivo = opcion.motivo }
            }
        }
        .padding(4)
        .background(Palco.surface2, in: forma)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Motivo")
    }

    private func enviar() {
        guard !ocupado else { return }
        ocupado = true
        let elegido = motivo
        Task {
            do {
                try await fuentes.reportar(hash, motivo: elegido)
                hojas.cerrar()
            } catch {
                avisos.avisar("No se pudo enviar el reporte", tono: .err)
            }
            ocupado = false
        }
    }
}

private struct FilaMotivo: View {
    let texto: String
    let marcada: Bool
    let accion: () -> Void

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        Button(action: accion) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().strokeBorder(Palco.accentEdge, lineWidth: 2)
                    if marcada { Circle().fill(Palco.accentEdge).frame(width: 10, height: 10) }
                }
                .frame(width: 20, height: 20)
                Text(texto).estilo(EstiloTexto(tamano: 15, peso: 560, altoLinea: 1.45)).foregroundStyle(Palco.text)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(marcada ? Palco.surface : Color.clear, in: forma)
            .bordeInterior(marcada ? Palco.line : Color.clear, forma: forma)
            .contentShape(forma)
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(forma)))
        .accessibilityAddTraits(marcada ? [.isSelected, .isButton] : .isButton)
    }
}
