import SwiftUI
import UIKit

/* Hoja «Reproducir otro hash» (M5; a5 §5; PasteHashSheet.tsx): «Fuente externa · Añádela solo a esta sesión»,
   el campo «Content ID o enlace AceStream» validado a cada tecla, «Hash detectado:», «Pegar del portapapeles»
   (botón con el aspecto de la web, pregunta A-5) y «Reproducir hash» (deshabilitado hasta que vale). En el
   centro de partido (`.partido`) entrega el hash a la sesión de fuentes en vez de reproducir. */

struct ContenidoPegar: View {
    let contexto: ContextoPegar
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(Avisos.self) private var avisos
    @Environment(Haptica.self) private var haptica
    @Environment(Reproductor.self) private var reproductor
    @Environment(SesionFuentes.self) private var fuentes
    @State private var valor = ""
    @FocusState private var enfocado: Bool

    private var hash: String? { ModeloBusqueda.normalizarHash(valor) }
    private var error: String? {
        valor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hash != nil ? nil : TextosPegar.invalido
    }

    var body: some View {
        ContenidoHoja(titulo: "Reproducir otro hash", tamano: .sm, alCerrar: cerrar) {
            VStack(alignment: .leading, spacing: 12) {
                entradilla.padding(.top, -14)  // la descripción de la hoja (2 20 0)
                campo
                if let hash { detectado(hash) }
                botonPortapapeles
            }
        } pie: {
            BotonPalco("Reproducir hash", icono: .play, bloque: true, accion: enviar)
                .disabled(hash == nil)
        }
        .accessibilityIdentifier(IDUI.hojaPegar)
        .onAppear { enfocado = true }
    }

    /// «**Fuente externa** · Añádela solo a esta sesión» (13 `--text-2`, «Fuente externa» en `--text` 650).
    private var entradilla: some View {
        let base = EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)
        return HStack(spacing: 0) {
            Text("Fuente externa").estilo(EstiloTexto(tamano: 13, peso: 650, altoLinea: 1.45)).foregroundStyle(Palco.text)
            Text(" · Añádela solo a esta sesión").estilo(base).foregroundStyle(Palco.text2)
        }
    }

    private var campo: some View {
        CampoTexto(
            "Content ID o enlace AceStream", texto: $valor, marcador: "acestream://…", icono: .hash, pista: TextosPegar.pista,
            error: error, enfocado: $enfocado
        ) {
            if !valor.isEmpty {
                BotonIcono(.x, etiqueta: "Borrar Content ID") {
                    valor = ""
                    enfocado = true
                }
                .padding(.trailing, -6)
            }
        }
        .keyboardType(.URL)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(.go)
        .onSubmit(enviar)
        .accessibilityIdentifier(IDUI.campoHash)
    }

    /// `.paste__ok`: caja verde con «Hash detectado:» y el hash en monoespaciada.
    private func detectado(_ hash: String) -> some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        return VStack(alignment: .leading, spacing: 4) {
            Text("Hash detectado:").estilo(EstiloTexto(tamano: 13, peso: 560, altoLinea: 1.45)).foregroundStyle(Palco.okInk)
            Text(hash).estilo(.mono).foregroundStyle(Palco.text)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PalcoMezcla.ok10SobreBgSunk, in: forma)
        .bordeInterior(Palco.ok.opacity(0.35), forma: forma)
        .accessibilityElement(children: .combine)
    }

    private var botonPortapapeles: some View {
        BotonPalco("Pegar del portapapeles", icono: .paste, variante: .quieto, tamano: .sm) {
            guard let texto = UIPasteboard.general.string else {
                avisos.avisar(TextosPegar.portapapelesFallo, tono: .warn)
                return
            }
            valor = texto.trimmingCharacters(in: .whitespacesAndNewlines)
            enfocado = true
        }
        .accessibilityIdentifier(IDUI.botonPegarPortapapeles)
    }

    private func cerrar() {
        valor = ""
        hojas.cerrar()
    }

    /// Intro / «Reproducir hash»: cierra, háptica de éxito y reproduce (o entrega el hash al partido).
    private func enviar() {
        guard let hash else {
            avisos.avisar(TextosPegar.invalidoAlEnviar, tono: .warn)
            return
        }
        cerrar()
        switch contexto {
        case .libre:
            ReproducirPegado(datos: datos, reproductor: reproductor, navegador: navegador, avisos: avisos, haptica: haptica)
                .reproducir(hash)
        case .partido:
            haptica.disparar(.exito)
            Task { try? await fuentes.pegar(hash) }
        }
    }
}
