import Foundation
import Observation

/* Estado de interfaz de «Canales» (M5; a5 §3; LibraryView.tsx): el texto del buscador y el filtro aplicado
   (140 ms de espera), la pestaña inicial (se decide UNA vez), las categorías abiertas, la ventana de entrada
   escalonada y la guarda del doble «reproducir». Vive con la pestaña (el armazón la mantiene viva). */

@MainActor @Observable final class ModeloCanales {
    /// Lo escrito en «Buscar canal…».
    var texto = ""
    /// El filtro aplicado (tras 140 ms o con Intro).
    private(set) var consulta = ""
    /// Pestaña inicial decidida al llegar los datos (regla 32).
    private(set) var inicialDecidida = false
    /// Categorías abiertas (Listas).
    private(set) var abiertas: Set<String> = []
    /// Aparición escalonada: solo lo que se monta en los 900 ms tras entrar en una pestaña.
    private(set) var entrando = true
    @ObservationIgnored private var tareaEntrada: Task<Void, Never>?
    @ObservationIgnored private var guarda = GuardaReproducir.compartida

    var consultaLimpia: String { consulta.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// `setQuery` con la espera de 140 ms (la llama la vista en `.task(id: texto)`).
    func aplicarConEspera() async {
        guard texto != consulta else { return }
        try? await Task.sleep(for: .seconds(ReglasBiblioteca.esperaFiltro))
        guard !Task.isCancelled else { return }
        consulta = texto
    }

    /// Intro: aplica ya, sin esperar.
    func aplicarYa() { consulta = texto }

    /// La pestaña inicial (Favoritos, si no Recientes, si no Listas), una sola vez.
    func decidirInicial(_ biblioteca: LibraryView, navegador: Navegador) {
        guard !inicialDecidida else { return }
        inicialDecidida = true
        navegador.pestanaCanales = ReglasBiblioteca.seccionInicial(biblioteca).pestana
    }

    /// Cambiar de pestaña: la lista entra escalonada otra vez.
    func entrarEnPestana() {
        entrando = true
        tareaEntrada?.cancel()
        tareaEntrada = Task { [weak self] in
            try? await Task.sleep(for: .seconds(ReglasBiblioteca.ventanaEntrada))
            guard !Task.isCancelled else { return }
            self?.entrando = false
        }
    }

    func alternarCategoria(_ categoria: String) {
        if abiertas.contains(categoria) { abiertas.remove(categoria) } else { abiertas.insert(categoria) }
    }

    /// Un segundo «reproducir» del mismo canal en < 800 ms se ignora (play.ts `REPEAT_GUARD_MS`).
    func puedeReproducir(_ hash: String) -> Bool { guarda.permitir(hash) }
}

/// La guarda del doble toque de play.ts: el mismo canal otra vez en menos de 800 ms no cuenta. Una sola para
/// Canales y Buscar, como el `lastPlay` del módulo en la web.
@MainActor final class GuardaReproducir {
    static let compartida = GuardaReproducir()

    private var ultimo: String?
    private var bloqueado = false
    private var tarea: Task<Void, Never>?

    func permitir(_ hash: String) -> Bool {
        if bloqueado && ultimo == hash { return false }
        ultimo = hash
        bloqueado = true
        tarea?.cancel()
        tarea = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(800))  // play.ts REPEAT_GUARD_MS
            guard !Task.isCancelled else { return }
            self?.bloqueado = false
        }
        return true
    }
}
