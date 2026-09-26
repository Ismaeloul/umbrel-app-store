import SwiftUI

/* Hoja «¿Emparejar con otro servidor?» (b-arquitectura §2.8, M7; a2 §22.8): llega un enlace `aceneo://pair…`
   con la app ya emparejada. Dos notas (estilo de la nota de origen de a6 §8.8: fondo `--line-soft`, 13 pt,
   icono 18 en `--accent-ink`, el dato en 650 `--text`) y el botón «danger» «Emparejar de nuevo»: la hoja se
   cierra (háptica media), `sesion.desemparejar()` (para la reproducción y borra token, direcciones y cachés), la
   app vuelve a emparejar con la transición «atrás» y el enlace se canjea solo. Cerrar sin confirmar no hace nada
   más. */

struct ContenidoOtroServidor: View {
    let enlace: PairingLink
    @Environment(CentroHojas.self) private var hojas
    @Environment(SesionApp.self) private var sesion
    @Environment(Haptica.self) private var haptica
    @State private var ahora: String = ""

    init(enlace: PairingLink) {
        self.enlace = enlace
    }

    private var hostDelCodigo: String { ReglasEmparejar.host(enlace.servidor) }
    private var mismo: Bool { !ahora.isEmpty && ahora.lowercased() == hostDelCodigo.lowercased() }

    var body: some View {
        ContenidoHoja(
            titulo: "¿Emparejar con otro servidor?",
            descripcion: mismo
                ? "Se volverá a emparejar este iPhone con el código nuevo."
                : "Se olvidará el servidor actual y se usará el del código.",
            tamano: .sm, alCerrar: { hojas.cerrar() }
        ) {
            VStack(alignment: .leading, spacing: 8) {
                if !ahora.isEmpty { NotaServidor(icono: .link, texto: "Ahora: ", dato: ahora) }
                NotaServidor(icono: .qr, texto: mismo ? "El código es del mismo servidor: " : "El código es de: ",
                             dato: hostDelCodigo)
            }
        } pie: {
            BotonPalco("Emparejar de nuevo", icono: .qr, variante: .peligro, bloque: true, accion: emparejarDeNuevo)
                .accessibilityIdentifier(IDUI.botonEmparejarDeNuevo)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.hojaOtroServidor)
        .task { await leerServidorActual() }
    }

    /// El servidor al que se habla ahora (el que respondió), o la primera dirección guardada.
    private func leerServidorActual() async {
        let entorno = sesion.entorno
        if let activo = await entorno.servidores.conocido() {
            ahora = ReglasEmparejar.host(activo.url)
            return
        }
        let guardadas = entorno.configuracion.leer()
        if let url = guardadas.lan ?? guardadas.tailscale { ahora = ReglasEmparejar.host(url) }
    }

    private func emparejarDeNuevo() {
        hojas.cerrar()
        haptica.disparar(.media)
        let sesion = self.sesion
        let enlace = self.enlace
        Task {
            await sesion.desemparejar()
            // Ya en emparejar, la pantalla lo aplica (todas sus `u=`) y lo canjea sola (a2 §22.1).
            if sesion.fase != .app { sesion.enlaceParaEmparejar = enlace }
        }
    }
}

/// Una nota de la hoja: icono, texto y el dato en negrita.
private struct NotaServidor: View {
    let icono: NombreIcono
    let texto: String
    let dato: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            IconoPalco(icono, tamano: 18).foregroundStyle(Palco.accentInk).padding(.top, 1)
            let principio: Text = Text(texto).foregroundStyle(Palco.text2)
            let fuerte: Text = Text(dato).font(Mona.fuente(13, peso: 650)).foregroundStyle(Palco.text)
            Text("\(principio)\(fuerte)")
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
        .background(Palco.lineSoft, in: RoundedRectangle(cornerRadius: R.l, style: .circular))
        .accessibilityElement(children: .combine)
    }
}
