import SwiftUI

enum PielCampo: Sendable { case normal, buscador }

/// `<TextField>` de la web (a1 §10.22; ui/Field.css). Etiqueta 13/650 en `--text-2`; caja de 52 con radio 14,
/// `--surface` y borde `--line-strong` (buscador: cápsula `--surface-2`, relleno 0 8 0 18); enfocada, borde oro
/// y halo exterior de 3 al 30 %; con error, borde 1,5 `--fail` (sin halo). Entrada a 16 (evita el zoom) con la
/// Mona Sans original. Pista 12 en `--text-2`; error 13/560 en `--fail-ink`.
struct CampoTexto<Derecha: View>: View {
    let etiqueta: String
    @Binding var texto: String
    let marcador: String
    let icono: NombreIcono?
    let piel: PielCampo
    let pista: String?
    let error: String?
    let ocultarEtiqueta: Bool
    let enfocado: FocusState<Bool>.Binding?
    let derecha: Derecha
    @FocusState private var focoPropio: Bool

    init(_ etiqueta: String, texto: Binding<String>, marcador: String = "", icono: NombreIcono? = nil,
         piel: PielCampo = .normal, pista: String? = nil, error: String? = nil, ocultarEtiqueta: Bool = false,
         enfocado: FocusState<Bool>.Binding? = nil, @ViewBuilder derecha: () -> Derecha) {
        self.etiqueta = etiqueta
        self._texto = texto
        self.marcador = marcador
        self.icono = icono
        self.piel = piel
        self.pista = pista
        self.error = error
        self.ocultarEtiqueta = ocultarEtiqueta
        self.enfocado = enfocado
        self.derecha = derecha()
    }

    private var tieneFoco: Bool { enfocado?.wrappedValue ?? focoPropio }
    private var buscador: Bool { piel == .buscador }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !ocultarEtiqueta {
                Text(etiqueta).estilo(.etiquetaCampo).foregroundStyle(Palco.text2)
            }
            caja
            if let error {
                Text(error).estilo(.errorCampo).foregroundStyle(Palco.failInk)
                    .accessibilityAddTraits(.isStaticText)
            } else if let pista {
                Text(pista).estilo(.pista).foregroundStyle(Palco.text2)
            }
        }
    }

    private var caja: some View {
        HStack(spacing: 10) {
            if let icono { IconoPalco(icono, tamano: 20).foregroundStyle(Palco.text2) }
            TextField(etiqueta, text: $texto, prompt: Text(marcador).foregroundStyle(Palco.text3))
                .font(Font(Mona.uiFont(16, peso: 450)))
                .foregroundStyle(Palco.text)
                .focused(enfocado ?? $focoPropio)
                .frame(minHeight: 50)
            derecha
        }
        .padding(.leading, buscador ? 18 : 16)
        .padding(.trailing, buscador ? 8 : 16)
        .frame(minHeight: Alturas.campo)
        .background(MarcoCampo(buscador: buscador, foco: tieneFoco, error: error != nil))
    }
}

extension CampoTexto where Derecha == EmptyView {
    init(_ etiqueta: String, texto: Binding<String>, marcador: String = "", icono: NombreIcono? = nil,
         piel: PielCampo = .normal, pista: String? = nil, error: String? = nil, ocultarEtiqueta: Bool = false,
         enfocado: FocusState<Bool>.Binding? = nil) {
        self.init(etiqueta, texto: texto, marcador: marcador, icono: icono, piel: piel, pista: pista, error: error,
                  ocultarEtiqueta: ocultarEtiqueta, enfocado: enfocado) { EmptyView() }
    }
}

/// Fondo, borde y halo del campo según piel, foco y error.
private struct MarcoCampo: View {
    let buscador: Bool
    let foco: Bool
    let error: Bool

    private var forma: AnyShape {
        buscador ? AnyShape(Capsule()) : AnyShape(RoundedRectangle(cornerRadius: R.m, style: .circular))
    }

    var body: some View {
        forma
            .fill(buscador ? Palco.surface2 : Palco.surface)
            .overlay { borde }
            .background { if foco && !error { forma.stroke(Palco.accentEdge.opacity(0.3), lineWidth: 6) } }
    }

    @ViewBuilder private var borde: some View {
        if error {
            forma.stroke(Palco.fail, lineWidth: 3).clipShape(forma)
        } else if foco {
            forma.stroke(Palco.accentEdge, lineWidth: 2).clipShape(forma)
        } else {
            forma.stroke(Palco.lineStrong, lineWidth: 2).clipShape(forma)
        }
    }
}
