import SwiftUI

/* Las filas de aviso de la pantalla de emparejar: la de error (a2 §22.5, fail 14 % sobre `--bg` con borde
   fail 40 %, icono `aviso` en `--fail-ink`, rol alerta) y la de acceso perdido (a2 §23.3, weak 14 % con borde
   weak 40 %, icono en `--weak-ink`, rol estado). Separación 10, relleno 10 14, radio 18, texto 13/1,45 en
   `--text`, icono 18 con margen superior 1. Entran con fundido de 320 ms. */

struct FilaAvisoEmparejar: View {
    enum Tono: Sendable { case error, acceso }

    let texto: String
    let tono: Tono

    private var color: Color { tono == .error ? Palco.fail : Palco.weak }
    private var tinta: Color { tono == .error ? Palco.failInk : Palco.weakInk }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        HStack(alignment: .top, spacing: 10) {
            IconoPalco(.aviso, tamano: 18)
                .foregroundStyle(tinta)
                .padding(.top, 1)
            Text(texto)
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
        .background(color.opacity(0.14), in: forma)
        .bordeInterior(color.opacity(0.4), forma: forma)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(tono == .error ? IDUI.errorEmparejar : IDUI.avisoAcceso)
        .transition(.opacity.animation(Movimiento.salida))
    }
}
