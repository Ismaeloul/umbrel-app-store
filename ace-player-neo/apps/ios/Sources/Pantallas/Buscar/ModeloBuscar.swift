import Foundation
import Observation

/* Estado de «Buscar» (M5; a5 §4; search/SearchView.tsx): lo escrito, lo comprometido (tras 450 ms o con Intro;
   viaja en la ruta como `q`), la consulta al motor de ese texto (`DatosApp.busqueda`: caché de 60 s, sin
   reintentos, las atrasadas nunca pintan porque cada texto es su consulta), el aviso de fallo una vez por
   búsqueda fallida y la ventana de entrada escalonada. Rescatado en la poda de `BuscarModelo` y reescrito. */

@MainActor @Observable final class ModeloBuscar {
    /// Lo escrito en el campo.
    var texto = ""
    /// Lo que se busca (limpio: espacios colapsados, a 80).
    private(set) var comprometido = ""
    /// Aparición escalonada al llegar resultados nuevos (900 ms).
    private(set) var entrando = false
    @ObservationIgnored private var ultimoAvisado: String?
    @ObservationIgnored private var tareaEntrada: Task<Void, Never>?
    @ObservationIgnored private var guarda = GuardaReproducir()

    /// `commit`: fija lo que se busca (y lo deja en la ruta).
    func comprometer(_ valor: String, navegador: Navegador) {
        let limpio = ModeloBusqueda.limpiar(valor)
        comprometido = limpio
        navegador.textoBuscar = limpio
    }

    /// 450 ms tras la última tecla (la llama la vista en `.task(id: texto)`).
    func comprometerConEspera(navegador: Navegador) async {
        guard ModeloBusqueda.limpiar(texto) != comprometido else { return }
        try? await Task.sleep(for: .seconds(ModeloBusqueda.espera))
        guard !Task.isCancelled else { return }
        comprometer(texto, navegador: navegador)
    }

    /// Si otra vista manda aquí un texto (`&q=`), se pone y se busca al momento.
    func recibir(_ q: String) {
        guard q != comprometido else { return }
        texto = q
        comprometido = ModeloBusqueda.limpiar(q)
    }

    /// El aviso de fallo sale una vez por búsqueda fallida (no por repintado).
    func debeAvisarFallo(_ q: String) -> Bool {
        guard ultimoAvisado != q else { return false }
        ultimoAvisado = q
        return true
    }

    func olvidarFallo() { ultimoAvisado = nil }

    func entrarResultados() {
        entrando = true
        tareaEntrada?.cancel()
        tareaEntrada = Task { [weak self] in
            try? await Task.sleep(for: .seconds(ModeloBusqueda.ventanaEntrada))
            guard !Task.isCancelled else { return }
            self?.entrando = false
        }
    }

    func puedeReproducir(_ hash: String) -> Bool { guarda.permitir(hash) }
}
