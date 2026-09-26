#if DEBUG
    import Foundation

    /* Argumentos de lanzamiento del armazón, solo en Debug (b-arquitectura §3.3.1 y §3.5, M4), para los flujos de
       interfaz con las pantallas de otros módulos aún en stub:

       - `-AceNeoVista <vista>`: la app arranca en esa ruta de la web (`?vista=`, `Destino(vista:)`), p. ej.
         `partido/demo-1` para probar el borde izquierdo sin tocar una tarjeta.
       - `-AceNeoAvisoDeshacer`: al montar el armazón sale el toast de la web «Reproducción detenida» con «Deshacer»
         (el del mini, a2 §7 y a4 §19.3; info, icono `stop`; 30 s en vez de 6) para probar la capa de avisos.
       En Release no existen. `ModoEjecucion` (Entorno.swift) es de M1: estos se leen aquí para no tocarlo. */

    @MainActor enum ArgumentosArmazon {
        static var vista: Destino? {
            valor("-AceNeoVista").flatMap(Destino.init(vista:))
        }

        /// El toast dura 30 s en vez de los 6 de la web: el flujo de interfaz tarda en leerlo (arranque del
        /// simulador, instantáneas de XCUITest) y con 6 s a veces ya se había ido (testToastConDeshacer).
        static func avisoDePrueba(_ avisos: Avisos) {
            guard ProcessInfo.processInfo.arguments.contains("-AceNeoAvisoDeshacer") else { return }
            avisos.avisar(
                "Reproducción detenida", icono: .stop, accion: AccionAviso(titulo: "Deshacer") {}, duracion: 30)
        }

        /// El valor que sigue a un argumento (`-AceNeoVista partido/demo-1`).
        private static func valor(_ nombre: String) -> String? {
            let argumentos = ProcessInfo.processInfo.arguments
            guard let i = argumentos.firstIndex(of: nombre), i + 1 < argumentos.count else { return nil }
            return argumentos[i + 1]
        }
    }
#endif
