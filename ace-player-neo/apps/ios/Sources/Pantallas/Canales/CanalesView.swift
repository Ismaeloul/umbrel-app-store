import SwiftUI

/* «Canales» (la biblioteca) (M5; a5 §3; LibraryView.tsx): cabecera con «Pegar hash», el buscador local (140 ms),
   «Emitiendo ahora», las pestañas Favoritos / Recientes / Listas con su contador, el panel de la pestaña y el
   pie. Deslizar a los lados sobre el panel cambia de pestaña (sin seguir el dedo, como la web). */

struct CanalesView: View {
    @State private var modelo = ModeloCanales()
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(RelojCompartido.self) private var reloj
    @Environment(TiempoReal.self) private var tiempoReal
    @Environment(\.vistaActiva) private var vistaActiva

    var body: some View {
        ColumnaCanales(modelo: modelo)
            .mira(datos.biblioteca)
            .mira(datos.agenda)
            .task(id: vistaActiva) {
                guard vistaActiva else { return }
                await datos.biblioteca.asegurar(tiempoRealAbierto: tiempoReal.abierto)
            }
            .task(id: vistaActiva) {
                guard vistaActiva else { return }
                await datos.agenda.asegurar(tiempoRealAbierto: tiempoReal.abierto)
            }
            .task(id: vistaActiva) { await relojDeCanales() }
            .task(id: claveMarcadores) { await sondearMarcadores() }
            .task(id: modelo.texto) { await modelo.aplicarConEspera() }
            .onChange(of: datos.biblioteca.datos != nil, initial: true) { _, hay in
                if hay, let biblioteca = datos.biblioteca.datos { modelo.decidirInicial(biblioteca, navegador: navegador) }
            }
    }

    private var indice: IndiceAntena { IndiceAntena(agenda: datos.agenda.datos, reloj: RelojMadrid(reloj.ahora)) }

    private var claveMarcadores: String { "\(vistaActiva)|\(indice.hacenFaltaMarcadores())" }

    /// El reloj de «Emitiendo ahora» avanza cada 30 s (on-air.ts `useNow(30_000)`).
    private func relojDeCanales() async {
        guard vistaActiva else { return }
        reloj.empezarAMirar()
        defer { reloj.dejarDeMirar() }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(IndiceAntena.tic))
            guard !Task.isCancelled else { return }
            reloj.empezarAMirar()
            reloj.dejarDeMirar()
        }
    }

    /// Marcadores solo si hoy hay algo de 15 min antes a 3,5 h después; 8 s con algo en juego, si no 45 s.
    private func sondearMarcadores() async {
        guard vistaActiva, indice.hacenFaltaMarcadores() else { return }
        while !Task.isCancelled {
            await datos.marcadores.refrescar()
            try? await Task.sleep(for: .seconds(Marcadores.intervalo(datos.marcadores.datos?.scores)))
        }
    }
}

/// La columna que se desplaza.
private struct ColumnaCanales: View {
    @Bindable var modelo: ModeloCanales
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(PresentacionReproductor.self) private var presentacion
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.vistaActiva) private var vistaActiva
    @State private var posicion = ScrollPosition(edge: .top)

    private var miniVisible: Bool { presentacion.miniVisible(teatroVisible: false, inmersivo: false) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                CabeceraVista("Canales") {
                    BotonIcono(.paste, etiqueta: "Pegar un Content ID o enlace acestream://") { hojas.abrir(.pegar(.libre)) }
                }
                buscador
                ContenidoCanales(modelo: modelo)
            }
            .padding(.top, CGFloat(maquetacion.seguras.arriba))
            .padding(.leading, CGFloat(maquetacion.rellenoIzquierdo))
            .padding(.trailing, CGFloat(maquetacion.rellenoDerecho))
            .padding(.bottom, CGFloat(maquetacion.rellenoInferiorContenido(mini: miniVisible, teatro: false)))
            .subeConLaBarraDeEstado(vistaActiva)
        }
        .scrollPosition($posicion)
        .scrollDismissesKeyboard(.never)  // a5 §2.14: desplazar no baja el teclado
        .ignoresSafeArea(edges: .top)
        .background(Palco.bg.ignoresSafeArea())
        .onChange(of: navegador.subirArriba[.canales]) { _, _ in
            withAnimation(Movimiento.estandar(false)) { posicion.scrollTo(edge: .top) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.pantalla("biblioteca"))
    }

    /// «Buscar canal…»: cápsula de 52, sin foco al entrar; Intro aplica el filtro ya y no baja el teclado.
    private var buscador: some View {
        CampoTexto("Buscar canal", texto: $modelo.texto, marcador: "Buscar canal…", icono: .buscar, piel: .buscador, ocultarEtiqueta: true)
            .submitLabel(.search)
            .onSubmit { modelo.aplicarYa() }
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .accessibilityIdentifier(IDUI.buscadorBiblioteca)
    }
}
