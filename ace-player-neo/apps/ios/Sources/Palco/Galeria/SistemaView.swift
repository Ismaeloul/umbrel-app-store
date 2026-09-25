import Observation
import SwiftUI
import UIKit

/// La galería «Sistema» de la web (a1 §11; app/sistema/SistemaPage.tsx): cada token y cada primitiva de Palco
/// en sus estados, con los textos literales, para compararla lado a lado con la web en el mismo iPhone. Se
/// abre con 7 toques en «Versión» (Ajustes › Acerca de, M7) o con `-AceNeoSistema` en Debug. Sus datos son de
/// muestra: no toca el servidor ni la biblioteca.
struct SistemaView: View {
    @State private var galeria = EstadoGaleria()
    @Environment(\.cristalOpaco) private var cristalOpacoSistema
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.modoDemo) private var modoDemo

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                CabeceraVista("Sistema", subtitulo: "Tokens y componentes de la piel «Palco»") {
                    MenuMuestra(galeria: galeria)
                }
                VStack(alignment: .leading, spacing: S.s8) {
                    SeccionesSistemaA(galeria: galeria)
                    SeccionesSistemaB(galeria: galeria)
                    SeccionesSistemaC(galeria: galeria)
                }
            }
            .padding(.horizontal, S.gutter)
            .padding(.bottom, 120)
            .subeConLaBarraDeEstado(true)
        }
        .scrollPosition($posicion)
        .background(Palco.bg.ignoresSafeArea())
        .environment(\.cristalOpaco, cristalOpacoSistema || galeria.transparenciaReducida)
        .environment(\.movimientoReducido, reducido || ModoGaleria.movimientoReducido)
        .environment(\.modoDemo, modoDemo || ModoGaleria.demo)
        .overlay(alignment: .bottom) { AvisosGaleria(galeria: galeria) }
        .onAppear {
            galeria.aplicarTemaInicial()
        }
        .task {
            guard ModoGaleria.desplazamiento > 0 else { return }
            try? await Task.sleep(for: .milliseconds(500))
            posicion.scrollTo(point: CGPoint(x: 0, y: ModoGaleria.desplazamiento))
        }
    }

    @State private var posicion = ScrollPosition(edge: .top)
}

/// Estado de la galería: tema, transparencia, interruptores de muestra y los avisos de ejemplo.
@MainActor @Observable final class EstadoGaleria {
    enum Tema: String, Hashable, Sendable { case sistema, claro, oscuro }

    private(set) var tema: Tema = .sistema

    func cambiarTema(_ nuevo: Tema) {
        tema = nuevo
        aplicarTema()
    }
    var transparenciaReducida = ModoGaleria.transparenciaReducida
    var pulsado = false
    var filtro = "para-ti"
    var pestana = "favoritos"
    var consulta = ""
    var progreso = 0.8
    private(set) var toast: Toast?
    private(set) var linea: ContenidoLinea?
    @ObservationIgnored private var tareaToast: Task<Void, Never>?
    @ObservationIgnored private var tareaLinea: Task<Void, Never>?
    @ObservationIgnored private var siguiente = 1

    /// La app aplica el tema en la ventana (`window.overrideUserInterfaceStyle`, b-arquitectura §0.3). Cuando
    /// exista `PreferenciasLocales` (M4), el segmentado llama a `cambiarTema` y esto desaparece.
    func aplicarTema() {
        let estilo: UIUserInterfaceStyle
        switch tema {
        case .sistema: estilo = .unspecified
        case .claro: estilo = .light
        case .oscuro: estilo = .dark
        }
        VentanaPalco.clave?.overrideUserInterfaceStyle = estilo
    }

    /// `-AceNeoApariencia claro|oscuro` (capturas).
    func aplicarTemaInicial() {
        // Como el `prefers-color-scheme` de las capturas de la web: el segmentado sigue en «Sistema».
        switch ModoGaleria.apariencia {
        case "claro": VentanaPalco.clave?.overrideUserInterfaceStyle = .light
        case "oscuro": VentanaPalco.clave?.overrideUserInterfaceStyle = .dark
        default: break
        }
    }

    /// Un toast de muestra (2,8 s; con «Deshacer», 6 s). Mismo texto y tono → «×n».
    func avisar(_ texto: String, tono: TonoAviso, accion: String? = nil) {
        let clave = "\(tono.rawValue)|\(texto)"
        let repeticiones = toast?.clave == clave ? (toast?.repeticiones ?? 1) + 1 : 1
        toast = Toast(id: siguiente, clave: clave, texto: texto, tono: tono, icono: nil, tituloAccion: accion,
                      repeticiones: repeticiones, saliendo: false)
        siguiente += 1
        tareaToast?.cancel()
        let plazo: Duration = accion == nil ? .milliseconds(2800) : .seconds(6)
        tareaToast = Task { [weak self] in
            try? await Task.sleep(for: plazo)
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    func cerrarToast() {
        tareaToast?.cancel()
        toast = nil
    }

    /// La línea de estado de muestra (4,5 s sobre su base).
    func mostrarLinea(_ contenido: ContenidoLinea) {
        linea = contenido
        tareaLinea?.cancel()
        tareaLinea = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(4500))
            guard !Task.isCancelled else { return }
            self?.linea = nil
        }
    }
}

/// Argumentos de lanzamiento de la galería y del laboratorio (solo Debug; b-arquitectura §3.3.1).
enum ModoGaleria {
    private static var argumentos: [String] { ProcessInfo.processInfo.arguments }
    static var laboratorio: Bool { debug && argumentos.contains("-AceNeoLaboratorio") }
    static var sistema: Bool { debug && argumentos.contains("-AceNeoSistema") }
    static var transparenciaReducida: Bool { debug && argumentos.contains("-AceNeoTransparenciaReducida") }
    static var movimientoReducido: Bool { debug && argumentos.contains("-AceNeoMovimientoReducido") }
    static var demo: Bool { debug && argumentos.contains("-AceNeoDemo") }
    static var apariencia: String? { debug ? ModoEjecucion.aparienciaForzada : nil }
    /// `-AceNeoDesplazar <pt>`: la galería o el banco abren desplazados (capturas por tramos).
    static var desplazamiento: CGFloat { CGFloat(Double(valor("-AceNeoDesplazar") ?? "") ?? 0) }
    /// `-AceNeoLaboratorioSeccion <n>`: solo ese bloque del banco.
    static var seccionLaboratorio: Int? { Int(valor("-AceNeoLaboratorioSeccion") ?? "") }

    /// El valor que sigue a un argumento (`-Nombre valor`).
    static func valor(_ nombre: String) -> String? {
        let lista = argumentos
        guard debug, let i = lista.firstIndex(of: nombre), i + 1 < lista.count else { return nil }
        return lista[i + 1]
    }

    private static var debug: Bool {
        #if DEBUG
            true
        #else
            false
        #endif
    }
}

/// La ventana de la app (para el tema y para presentar lo que el laboratorio abre con UIKit).
@MainActor enum VentanaPalco {
    static var clave: UIWindow? {
        let escenas = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let ventanas = escenas.flatMap(\.windows)
        return ventanas.first(where: \.isKeyWindow) ?? ventanas.first
    }

    /// El controlador de arriba del todo (para presentar encima).
    static var arriba: UIViewController? {
        var actual = clave?.rootViewController
        while let presentado = actual?.presentedViewController { actual = presentado }
        return actual
    }
}

/// El menú «Más opciones» de la galería (a1 §10.19): el `Menu` del sistema con las opciones de la web.
struct MenuMuestra: View {
    let galeria: EstadoGaleria

    var body: some View {
        Menu {
            Section {
                boton("Guardar en favoritos", .star) { galeria.avisar("«DAZN 1» guardado en favoritos", tono: .ok) }
                boton("Copiar hash", .copy) { galeria.avisar("Hash copiado", tono: .ok) }
                boton("Abrir en…", .externo) { galeria.avisar("Abriendo en el reproductor externo…", tono: .info) }
                Toggle(isOn: .constant(false)) { etiqueta("Datos técnicos", .nerd) }
            }
            Section {
                Button(role: .destructive) {
                    galeria.avisar("Fuente reportada", tono: .warn)
                } label: {
                    etiqueta("Reportar la fuente", .flag)
                }
            }
        } label: {
            IconoPalco(.more, tamano: 24).frame(width: 44, height: 44).foregroundStyle(Palco.text2)
        }
        .menuOrder(.fixed)
        .accessibilityLabel("Más opciones")
    }

    private func boton(_ titulo: String, _ icono: NombreIcono, accion: @escaping () -> Void) -> some View {
        Button(action: accion) { etiqueta(titulo, icono) }
    }

    private func etiqueta(_ titulo: String, _ icono: NombreIcono) -> some View {
        Label {
            Text(titulo)
        } icon: {
            Image(uiImage: IconoImagen.imagen(icono, tamano: 20))
        }
    }
}

/// Toasts y línea de estado de muestra, abajo (en la app los pinta `Avisos`, M4).
private struct AvisosGaleria: View {
    let galeria: EstadoGaleria
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        VStack(spacing: 8) {
            if let toast = galeria.toast {
                ToastVista(toast, alAccion: {
                    galeria.cerrarToast()
                    galeria.avisar("Recuperado", tono: .ok)
                }, alCerrar: { galeria.cerrarToast() })
                .id(toast.id)
                .transition(.opacity.combined(with: .offset(y: 12)))
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 12)
        .animation(Movimiento.estandar(reducido), value: galeria.toast?.id)
    }
}

/// Un título de sección de la galería (17/720/125) y su contenido con separación 12.
struct SeccionGaleria<Contenido: View>: View {
    let titulo: String
    let contenido: Contenido

    init(_ titulo: String, @ViewBuilder contenido: () -> Contenido) {
        self.titulo = titulo
        self.contenido = contenido()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            Text(titulo).estilo(.tituloSeccion).foregroundStyle(Palco.text).accessibilityAddTraits(.isHeader)
            contenido
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
