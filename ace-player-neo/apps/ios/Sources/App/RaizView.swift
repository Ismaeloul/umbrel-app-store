import SwiftUI
import UIKit

/// Raíz de la app (b-arquitectura §2.3, I0→M4): las dos fases emparejar ↔ app (a2 §27.2), los valores
/// y los objetos de proceso en el entorno, la háptica central, la fuente raíz y la medida de la ventana
/// (`Maquetacion`, leída de la ventana clave). Los valores y los objetos van en modificadores pequeños para que
/// el compilador no tarde en tiparlo (§5.1.6).
///
/// En Debug, `-AceNeoLaboratorio` y `-AceNeoSistema` (§3.3.1) abren el banco de Palco o la galería «Sistema» en
/// lugar de las dos fases, con el MISMO entorno: la háptica central, las hojas de `CentroHojas` y el tema de
/// `PreferenciasLocales` que aplica `HostingRaiz`.
struct RaizView: View {
    let contenedor: ContenedorApp
    @Environment(\.accessibilityReduceMotion) private var reducirMovimiento
    @Environment(\.accessibilityReduceTransparency) private var reducirTransparencia
    @State private var maquetacion = Maquetacion.referencia

    var body: some View {
        let reducido: Bool = reducirMovimiento || ModoEjecucion.movimientoReducido
        let opaco: Bool = reducirTransparencia || contenedor.preferencias.transparenciaReducida
        let fundidos: Bool = reducido || UIAccessibility.prefersCrossFadeTransitions  // a2 §26: preferir fundidos
        contenido
            .background { MedidaVentana { maquetacion = $0 } }
            .modifier(ValoresRaiz(reducido: reducido, opaco: opaco, imagenes: contenedor.entorno.imagenes))
            .environment(\.maquetacion, maquetacion)
            .modifier(ObjetosDeInterfaz(contenedor: contenedor))
            .modifier(ObjetosDelArmazon(contenedor: contenedor))
            .modifier(ObjetosDeDatos(contenedor: contenedor))
            .modifier(ObjetosDeReproduccion(contenedor: contenedor))
            .modifier(HapticaRaiz(haptica: contenedor.haptica))
            .modifier(FasesDeLaSesion(contenedor: contenedor, reducido: fundidos))
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
                FasesRaiz(raiz: contenedor.raiz)
            }
        #else
            FasesRaiz(raiz: contenedor.raiz)
        #endif
    }
}

/// Emparejar ↔ app (a2 §27.2): dos contenedores montados a la vez mientras se cruzan; se anima su opacidad.
private struct FasesRaiz: View {
    let raiz: Raiz

    var body: some View {
        ZStack {
            Palco.bg
            if raiz.armazonMontado {
                AppShell()
                    .opacity(raiz.app ? 1 : 0)
                    .offset(x: raiz.entradaApp)
                    .allowsHitTesting(raiz.app)
                    .accessibilityHidden(!raiz.app)
            }
            if raiz.emparejarMontado {
                PantallaEmparejar(motivo: raiz.motivo)
                    .opacity(raiz.app ? 0 : 1)
                    .offset(x: raiz.entradaEmparejar)
                    .allowsHitTesting(!raiz.app)
                    .accessibilityHidden(raiz.app)
            }
        }
        .ignoresSafeArea()
    }
}

/// La raíz sigue a la fase de la sesión (M1): emparejado → entra en la app; acceso perdido u olvidar → vuelve a
/// emparejar con su motivo (a2 §22.6, §23.3).
private struct FasesDeLaSesion: ViewModifier {
    let contenedor: ContenedorApp
    let reducido: Bool

    func body(content: Content) -> some View {
        content.onChange(of: contenedor.sesion.fase) { _, _ in
            let contenedor = self.contenedor
            let reducido = self.reducido
            Task { await FasesDeLaSesion.seguir(contenedor, reducido: reducido) }
        }
    }

    /// Lleva la raíz a la fase de la sesión. Si la fase cambia mientras la raíz cruza (p. ej. un 401 durante los
    /// ~940 ms de entrar en la app, cuando `Raiz` ignora otra petición), al acabar se vuelve a mirar (I1).
    @MainActor static func seguir(_ contenedor: ContenedorApp, reducido: Bool) async {
        let raiz = contenedor.raiz
        for _ in 0..<3 {
            guard !raiz.cambiando else { return }  // la que está cruzando volverá a mirar al acabar
            switch contenedor.sesion.fase {
            case .app:
                guard !raiz.app else { return }
                contenedor.reproductor.dispositivoId = contenedor.sesion.dispositivo
                let host: String = FasesDeLaSesion.host(contenedor.entorno.configuracion.leer())
                await raiz.entrarEnLaApp(host: host, reducido: reducido)
            case .emparejar(let motivo):
                guard raiz.app else { return }
                await raiz.volverAEmparejar(motivo: motivo ?? .olvidadoAqui, reducido: reducido)
            }
        }
    }

    /// «Emparejado con {host}»: la dirección con la que se canjeó (la de casa primero, como `candidatas`).
    static func host(_ configuracion: ServerConfig) -> String {
        configuracion.candidatas.first?.url.host() ?? ""
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

/// Sesión, consultas, tiempo real, señales, marcadores destapados y el repartidor de eventos.
private struct ObjetosDeDatos: ViewModifier {
    let contenedor: ContenedorApp
    func body(content: Content) -> some View {
        content.environment(contenedor.sesion).environment(contenedor.datos)
            .environment(contenedor.tiempoReal).environment(contenedor.senales)
            .environment(contenedor.destapados)
            .environment(\.repartidor, contenedor.repartidor)
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
