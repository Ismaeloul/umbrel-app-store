import SwiftUI

/* La tarjeta «Escribir el código» (a2 §22.4): la tarjeta de sección de Ajustes (a6 §1.1) con su cabecera
   (cuadro 44 oro lavado con `hash` y el título 22/800/125), la descripción, el código de seis celdas, las dos
   direcciones (teclado URL, sin mayúsculas ni corrector; «siguiente» y «ir») con su pista común y el botón
   primario «Emparejar» a todo el ancho. */

struct TarjetaCodigo: View {
    @Bindable var modelo: ModeloEmparejar
    let focoCodigo: FocusState<Bool>.Binding
    let focoCasa: FocusState<Bool>.Binding
    let focoTailscale: FocusState<Bool>.Binding
    let alEnviar: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            cabecera
            Text("Los seis dígitos que salen debajo del QR en la web y la dirección de tu Ace Player Neo.")
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, -8)
            CeldasCodigo(codigo: $modelo.codigo, error: modelo.bordeCodigo ? modelo.fila : nil, enfocado: focoCodigo)
            direcciones
            boton
        }
        .tarjeta()
    }

    private var cabecera: some View {
        HStack(spacing: 12) {
            IconoPalco(.hash, tamano: 24)
                .foregroundStyle(Palco.accentInk)
                .frame(width: 44, height: 44)
                .background(Palco.accentWash, in: RoundedRectangle(cornerRadius: R.m, style: .circular))
                .accessibilityHidden(true)
            Text("Escribir el código")
                .estilo(EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1))
                .foregroundStyle(Palco.text)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private var direcciones: some View {
        VStack(alignment: .leading, spacing: 16) {
            CampoTexto("Dirección en casa", texto: $modelo.direccionCasa, marcador: "http://umbrel.local:7792",
                       error: modelo.erroresCampo[.casa], enfocado: focoCasa)
                .submitLabel(.next)
                .onSubmit { focoTailscale.wrappedValue = true }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(IDUI.campoLan)
            CampoTexto("Dirección por Tailscale", texto: $modelo.direccionTailscale,
                       marcador: "http://umbrel.tu-red.ts.net:7792",
                       pista: "Pon una o las dos: la app usa la que responda y cambia sola al salir de casa.",
                       error: modelo.erroresCampo[.tailscale], enfocado: focoTailscale)
                .submitLabel(.go)
                .onSubmit(alEnviar)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(IDUI.campoTailscale)
        }
        .keyboardType(.URL)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
    }

    private var boton: some View {
        BotonPalco(tituloBoton, icono: modelo.hecho ? .check : .link, variante: .primario, bloque: true,
                   ocupado: modelo.enviando, accion: alEnviar)
            .disabled(!(modelo.puedeEnviar || modelo.enviando || modelo.hecho))
            .accessibilityIdentifier(IDUI.botonEmparejar)
    }

    private var tituloBoton: String {
        if modelo.enviando { return "Emparejando…" }
        if modelo.hecho { return "Emparejado" }
        return "Emparejar"
    }
}
