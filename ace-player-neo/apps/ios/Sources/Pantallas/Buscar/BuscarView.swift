import SwiftUI

/* «Buscar» (M5; a5 §4; SearchView.tsx): cabecera con «Pegar hash», el campo grande (60, radio 18, 17/560, ✕ con
   texto), «Enlace detectado» si lo escrito lleva un Content ID, «En tu biblioteca» (hasta 5) y «En el motor
   AceStream» con sus fases. Entrar no enfoca el campo (el teclado sube solo al tocarlo). */

struct BuscarView: View {
    @State private var modelo = ModeloBuscar()
    @Environment(Navegador.self) private var navegador
    @Environment(DatosApp.self) private var datos
    @Environment(TiempoReal.self) private var tiempoReal
    @Environment(\.vistaActiva) private var vistaActiva

    var body: some View {
        ColumnaBuscar(modelo: modelo)
            .mira(datos.biblioteca)
            .task(id: vistaActiva) {
                guard vistaActiva else { return }
                await datos.biblioteca.asegurar(tiempoRealAbierto: tiempoReal.abierto)
            }
            .task(id: modelo.texto) { await modelo.comprometerConEspera(navegador: navegador) }
            .onChange(of: navegador.textoBuscar, initial: true) { _, q in modelo.recibir(q) }
    }
}

private struct ColumnaBuscar: View {
    @Bindable var modelo: ModeloBuscar
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(PresentacionReproductor.self) private var presentacion
    @Environment(Reproductor.self) private var reproductor
    @Environment(Avisos.self) private var avisos
    @Environment(Haptica.self) private var haptica
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.vistaActiva) private var vistaActiva
    @FocusState private var enfocado: Bool
    @State private var posicion = ScrollPosition(edge: .top)

    private var miniVisible: Bool { presentacion.miniVisible(teatroVisible: false, inmersivo: false) }

    private var pegado: ReproducirPegado {
        ReproducirPegado(datos: datos, reproductor: reproductor, navegador: navegador, avisos: avisos, haptica: haptica)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                CabeceraVista("Buscar") {
                    BotonIcono(.paste, etiqueta: "Pegar un Content ID o enlace acestream://") { hojas.abrir(.pegar(.libre)) }
                }
                CampoBuscarMotor(texto: $modelo.texto, enfocado: $enfocado, alEnviar: enviar, borrar: limpiar)
                ResultadosBuscar(modelo: modelo, limpiar: limpiar)
            }
            .padding(.top, CGFloat(maquetacion.seguras.arriba))
            .padding(.leading, CGFloat(maquetacion.rellenoIzquierdo))
            .padding(.trailing, CGFloat(maquetacion.rellenoDerecho))
            .padding(.bottom, CGFloat(maquetacion.rellenoInferiorContenido(mini: miniVisible, teatro: false)))
            .subeConLaBarraDeEstado(vistaActiva)
        }
        .scrollPosition($posicion)
        .scrollDismissesKeyboard(.never)  // a5 §2.14
        .ignoresSafeArea(edges: .top)
        .background(Palco.bg.ignoresSafeArea())
        .onChange(of: navegador.subirArriba[.buscar]) { _, _ in
            withAnimation(Movimiento.estandar(false)) { posicion.scrollTo(edge: .top) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.pantalla("buscar"))
    }

    /// Intro: con enlace detectado, reproduce; si no, busca ya (sin los 450 ms). No baja el teclado.
    private func enviar() {
        enfocado = true
        if let hash = ModeloBusqueda.hashOEnlace(modelo.texto) {
            pegado.reproducir(hash)
        } else {
            modelo.comprometer(modelo.texto, navegador: navegador)
        }
    }

    /// Vaciar (✕, «Borrar la búsqueda», «Limpiar»): el foco vuelve al campo.
    private func limpiar() {
        modelo.texto = ""
        modelo.comprometer("", navegador: navegador)
        modelo.olvidarFallo()
        enfocado = true
    }
}

/// El campo del motor (a5 §4.5): alto 60, radio 18, `--surface`, borde `--line-strong` (oro con foco), 17/560,
/// ✕ «Borrar lo escrito» solo con texto; máximo 200 caracteres.
private struct CampoBuscarMotor: View {
    @Binding var texto: String
    var enfocado: FocusState<Bool>.Binding
    let alEnviar: () -> Void
    let borrar: () -> Void

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        HStack(spacing: 10) {
            IconoPalco(.buscar, tamano: 20).foregroundStyle(Palco.text2)
            TextField(
                "Buscar en el motor AceStream", text: $texto,
                prompt: Text("Nombre de un canal, o pega un enlace de AceStream…").foregroundStyle(Palco.text3)
            )
            .font(Font(Mona.uiFont(17, peso: 560)))
            .foregroundStyle(Palco.text)
            .focused(enfocado)
            .submitLabel(.search)
            .onSubmit(alEnviar)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .frame(minHeight: 58)
            .accessibilityIdentifier(IDUI.campoBuscar)
            if !texto.isEmpty { BotonIcono(.x, etiqueta: "Borrar lo escrito", accion: borrar) }
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .frame(minHeight: 60)
        .background(Palco.surface, in: forma)
        .overlay { forma.stroke(enfocado.wrappedValue ? Palco.accentEdge : Palco.lineStrong, lineWidth: 2).clipShape(forma) }
        .background { if enfocado.wrappedValue { forma.stroke(Palco.accentEdge.opacity(0.3), lineWidth: 6) } }
        .onChange(of: texto) { _, nuevo in
            if nuevo.count > ModeloBusqueda.maximoCampo { texto = String(nuevo.prefix(ModeloBusqueda.maximoCampo)) }
        }
    }
}
