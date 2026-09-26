import Foundation

/* Servidor actualizado mientras la app está abierta (b-arquitectura §2.5.5, M1; a7 §5.2, el
   `watchServerVersion` de features/pwa/install.ts con la reacción de la app):
   - base = `bootstrap.version` del primer arranque; cada `bootstrap` que llegue cuenta como lectura;
   - `ping` (sin token, 12 s, una a la vez, errores callados) tras `resync`, al reabrir el SSE tras un corte
     y al volver tras ≥ 30 min fuera. Nunca en demo ni con el servidor simulado;
   - versión distinta (subida o bajada), una vez por versión: `alCambiar` (la sesión olvida las
     capacidades y los datos se invalidan enteros) y el toast de 4 s. La reproducción no se toca. */

@MainActor final class VigiaVersion {
    private let api: APIClient
    private let avisos: Avisos
    private(set) var base: String?
    private var preguntando = false
    private var anunciadas: Set<String> = []
    /// Versión nueva: capacidades olvidadas y caché entera invalidada (lo engancha el repartidor).
    var alCambiar: ((String) -> Void)?
    /// Solo en vivo: en demo y con el servidor simulado no se pregunta.
    var activa = !(ModoEjecucion.demo || ModoEjecucion.servidorSimulado)

    /// «Tu Umbrel tiene ahora Ace Player Neo <versión>.» (a7 §5.2 punto 4: toast info, icono subir, 4 s).
    static func textoVersion(_ version: String) -> String { "Tu Umbrel tiene ahora Ace Player Neo \(version)." }

    init(api: APIClient, avisos: Avisos) {
        self.api = api
        self.avisos = avisos
    }

    /// Pregunta `ping` (una a la vez; si falla, se calla y espera a la próxima).
    func revisar(motivo: String) async {
        guard activa, !preguntando else { return }
        preguntando = true
        defer { preguntando = false }
        guard let ping = try? await api.enviar(API.ping(plazo: PlazosWeb.plazo(.ping))) else { return }
        guard ping.apiVersion == PingResponse.apiVersionEsperada else { return }
        leida(ping.version)
    }

    /// Salir o emparejar de nuevo: la versión del servidor anterior no cuenta (otro servidor de otra versión no
    /// es «Tu Umbrel tiene ahora…»). La próxima lectura vuelve a ser la base.
    func olvidarBase() {
        base = nil
        anunciadas = []
    }

    /// Una lectura de versión (de `ping` o de un `bootstrap`).
    func leida(_ version: String) {
        guard let actual = base else {
            base = version
            return
        }
        guard version != actual else { return }
        base = version
        alCambiar?(version)
        guard activa, anunciadas.insert(version).inserted else { return }
        avisos.avisar(Self.textoVersion(version), tono: .info, icono: .subir, duracion: 4)
    }
}
