import SwiftUI

/* «Guardar una lista remota» (a6 §3.1): rótulo, campos «Nombre» (60 como mucho) y «Dirección de la lista»
   (teclado URL, sin mayúsculas ni corrector), botones «Guardar M3U» (primario) y «Guardar HTML» (quieto) en una
   fila que salta, la nota de límites y la línea de estado (icono 16, 13 pt). */

struct FormularioLista: View {
    @Binding var nombre: String
    @Binding var url: String
    let errorURL: String?
    let pista: String?
    let ocupado: OperacionLista?
    let llenas: Bool
    let nota: NotaLista?
    let guardar: (WebSourceType) -> Void

    private var bloqueado: Bool { ocupado != nil || llenas }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RotuloBloque(titulo: "Guardar una lista remota")
            CampoTexto("Nombre", texto: nombreLimitado, marcador: "Nombre, por ejemplo: Principal")
                .autocorrectionDisabled()
            CampoTexto("Dirección de la lista", texto: $url, marcador: "https://…/lista.m3u", pista: pista, error: errorURL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .onSubmit { guardar(.m3u) }
            Flujo(horizontal: 8, vertical: 8) {
                BotonPalco("Guardar M3U", icono: .plus, variante: .primario, ocupado: ocupado == .guardar) { guardar(.m3u) }
                    .disabled(bloqueado && ocupado != .guardar)
                BotonPalco("Guardar HTML", icono: .plus, variante: .quieto) { guardar(.html) }
                    .disabled(bloqueado)
            }
            Text(llenas ? ErrorCatalog.mensaje(para: "source_limit") : ModeloListas.nota)
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
                .fixedSize(horizontal: false, vertical: true)
            if let nota { LineaNotaLista(nota: nota) }
        }
    }

    private var nombreLimitado: Binding<String> {
        Binding(get: { nombre }, set: { nombre = String($0.prefix(60)) })
    }
}

/// La línea de estado (a6 §3.1): refresh en `--text-2` guardando, check en `--ok-ink` hecho, aviso en
/// `--fail-ink` con el error.
private struct LineaNotaLista: View {
    let nota: NotaLista

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            IconoPalco(icono, tamano: 16).padding(.top, 1)
            Text(nota.texto)
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(tinta)
        .accessibilityElement(children: .combine)
    }

    private var icono: NombreIcono {
        switch nota.tono {
        case .info: .refresh
        case .ok: .check
        case .err: .aviso
        }
    }

    private var tinta: Color {
        switch nota.tono {
        case .info: Palco.text2
        case .ok: Palco.okInk
        case .err: Palco.failInk
        }
    }
}
