import SwiftUI

/* «Necesita la 0.8.1» (a9 §9.1.2; a6 §8.10.6 variante de aviso): la nota de origen de la web en variante de
   aviso —fila con separación 10, relleno 10 14, radio 18, weak 14 % sobre la tarjeta, borde 1 weak 40 %, texto
   13/1,45 en `--text`, icono `aviso` 18 en `--weak-ink`—. Con un servidor 0.8.0 las rutas de administración
   dan 403 `origin_forbidden` y la sección lo dice sin error feo (a6 §8.10.8, §9.6). La misma pieza sirve para la
   nota de direcciones en su variante de aviso. */

struct AvisoVersion: View {
    let frase: String

    /// Texto de a6: «Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel.» + la frase de la sección.
    static let base = "Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel."
    static let dispositivos = "Mientras, empareja y revoca dispositivos desde la web: Ajustes › Dispositivos."
    static let salud = "Mientras, mira la salud completa desde la web."
    static let ajuste = "Mientras, cámbiala desde la web."

    var body: some View {
        NotaAjustes(icono: .aviso, aviso: true, trozos: [
            NotaDirecciones.Trozo(texto: "Esta opción necesita ", fuerte: false),
            NotaDirecciones.Trozo(texto: "Ace Player Neo 0.8.1", fuerte: true),
            NotaDirecciones.Trozo(texto: " o posterior en tu Umbrel. \(frase)", fuerte: false),
        ])
    }
}

/// La nota de la web (`.disp-origin`, a6 §8.8): fondo `--line-soft`, texto `--text-2`, icono `--accent-ink`,
/// lo fuerte en 650 `--text`; en variante de aviso, weak 14 % con borde weak 40 %, texto `--text` e icono
/// `--weak-ink`.
struct NotaAjustes: View {
    let icono: NombreIcono
    let aviso: Bool
    let trozos: [NotaDirecciones.Trozo]

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        HStack(alignment: .top, spacing: 10) {
            IconoPalco(icono, tamano: 18)
                .foregroundStyle(aviso ? Palco.weakInk : Palco.accentInk)
                .padding(.top, 1)
            texto
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
        .background(aviso ? Palco.weak.opacity(0.14) : Palco.lineSoft, in: forma)
        .bordeInterior(aviso ? Palco.weak.opacity(0.4) : Color.clear, forma: forma)
        .accessibilityElement(children: .combine)
    }

    private var texto: Text {
        var salida = Text(verbatim: "")
        for trozo in trozos {
            let pieza: Text = trozo.fuerte
                ? Text(verbatim: trozo.texto).font(Mona.fuente(13, peso: 650)).foregroundStyle(Palco.text)
                : Text(verbatim: trozo.texto).foregroundStyle(aviso ? Palco.text : Palco.text2)
            salida = Text("\(salida)\(pieza)")
        }
        return salida
    }
}
