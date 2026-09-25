import SwiftUI

/// Raíz de la app (b-arquitectura §2.3, I0→M4): las dos fases emparejar ↔ app (a2 §27.2), los valores
/// y los objetos de proceso en el entorno, la háptica central y la fuente raíz. Los valores y los objetos
/// van en modificadores pequeños para que el compilador no tarde en tiparlo (§5.1.6).
///
/// En Debug, `-AceNeoLaboratorio` y `-AceNeoSistema` (§3.3.1) abren el banco de Palco o la galería «Sistema» en
/// lugar de las dos fases, con el MISMO entorno: la háptica central, las hojas de `CentroHojas` y el tema de
/// `PreferenciasLocales` que aplica `HostingRaiz`.
struct RaizView: View {
    let contenedor: ContenedorApp
    @Environment(\.accessibilityReduceMotion) private var reducirMovimiento
    @Environment(\.accessibilityReduceTransparency) private var reducirTransparencia

    var body: some View {
        let reducido: Bool = reducirMovimiento || ModoEjecucion.movimientoReducido
        let opaco: Bool = reducirTransparencia || contenedor.preferencias.transparenciaReducida
        contenido
            .modifier(ValoresRaiz(reducido: reducido, opaco: opaco, imagenes: contenedor.entorno.imagenes))
            .modifier(ObjetosDeInterfaz(contenedor: contenedor))
            .modifier(ObjetosDelArmazon(contenedor: contenedor))
            .modifier(ObjetosDeDatos(contenedor: contenedor))
            .modifier(ObjetosDeReproduccion(contenedor: contenedor))
            .modifier(HapticaRaiz(haptica: contenedor.haptica))
            .onChange(of: reducido, initial: true) { _, valor in contenedor.haptica.reducirMovimiento = valor }
    }

    /// Las dos fases o, en Debug, el banco o la galería (con las hojas de la app).
    @ViewBuilder private var contenido: some View {
        #if DEBUG
            if ModoEjecucion.laboratorio {
                LaboratorioView().hojasDeLaApp(contenedor.hojas)
            } else if ModoEjecucion.sistema {
                SistemaView().hojasDeLaApp(contenedor.hojas)
            } else {
                fases
            }
        #else
            fases
        #endif
    }

    private var fases: some View {
        ZStack {
            Palco.bg.ignoresSafeArea()
            if contenedor.raiz.armazonMontado { AppShell() }
            if contenedor.raiz.emparejarMontado { PantallaEmparejar(motivo: contenedor.raiz.motivo) }
        }
    }
}

/// Fuente raíz, idioma y los valores de entorno de Palco (§2.2.10).
private struct ValoresRaiz: ViewModifier {
    let reducido: Bool
    let opaco: Bool
    let imagenes: CacheImagenes

    func body(content: Content) -> some View {
        content
            .font(Mona.fuente(15, peso: 450))
            .environment(\.locale, Locale(identifier: "es_ES"))
            .environment(\.modoDemo, ModoEjecucion.demo)
            .environment(\.cristalOpaco, opaco)
            .environment(\.movimientoReducido, reducido)
            .environment(\.cacheImagenes, imagenes)
    }
}

/// Háptica, ventana, ciclo de vida, preferencias y navegación.
private struct ObjetosDeInterfaz: ViewModifier {
    let contenedor: ContenedorApp
    func body(content: Content) -> some View {
        content.environment(contenedor.haptica).environment(contenedor.estadoVentana)
            .environment(contenedor.cicloVida).environment(contenedor.preferencias)
            .environment(contenedor.navegador)
    }
}

/// Hojas, avisos, transición y raíz.
private struct ObjetosDelArmazon: ViewModifier {
    let contenedor: ContenedorApp
    func body(content: Content) -> some View {
        content.environment(contenedor.hojas).environment(contenedor.avisos)
            .environment(contenedor.transicion).environment(contenedor.raiz)
    }
}

/// Sesión, consultas, tiempo real, señales y marcadores destapados.
private struct ObjetosDeDatos: ViewModifier {
    let contenedor: ContenedorApp
    func body(content: Content) -> some View {
        content.environment(contenedor.sesion).environment(contenedor.datos)
            .environment(contenedor.tiempoReal).environment(contenedor.senales)
            .environment(contenedor.destapados)
    }
}

/// Reproductor, presentación, sesión de fuentes, reloj compartido, bajas pendientes y la capa de vídeo con su PiP.
private struct ObjetosDeReproduccion: ViewModifier {
    let contenedor: ContenedorApp
    func body(content: Content) -> some View {
        content.environment(contenedor.reproductor).environment(contenedor.presentacion)
            .environment(contenedor.fuentes).environment(contenedor.relojCompartido)
            .environment(contenedor.bajas).environment(contenedor.pip)
            .environment(\.servidores, contenedor.entorno.servidores)
    }
}
