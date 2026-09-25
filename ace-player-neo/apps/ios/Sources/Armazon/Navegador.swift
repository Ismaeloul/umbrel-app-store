import Observation

/* Estado de ruta de la app (b-arquitectura §2.4.1, I0→M4): la pestaña, la capa de encima (teatro o
   sistema), el sentido de la transición y las pestañas vivas. Calca `?vista=` de la web (a2 §3).
   No anima: las capas ven el cambio y animan ellas. Cuerpos de I0 (fase 0.3b); M4 los afina (háptica
   de selección, NavegadorTests). */

enum OrigenApertura: Hashable, Sendable { case heroe(partido: String), tarjeta(partido: String), mini, ninguno }

@MainActor @Observable final class Navegador {
    private(set) var pestana: Pestana = .agenda
    private(set) var capa: Destino?  // .partido / .canal / .sistema encima de la pestaña
    private(set) var sentido: Sentido = .adelante
    private(set) var visitadas: Set<Pestana> = [.agenda]  // pestañas montadas (vivas) desde su primera visita
    private(set) var subirArriba: [Pestana: Int] = [:]  // +1 al tocar la pestaña activa → su vista sube
    private(set) var origenApertura: OrigenApertura = .ninguno
    private(set) var seccionAjustes: SeccionAjustes?
    private(set) var peticionSeccion = 0  // +1 cada vez que se pide desplazar a la sección
    var pestanaCanales: PestanaCanales = .favoritos
    var textoBuscar = ""

    var destinoVisible: Destino { capa ?? destino(de: pestana) }
    var teatroVisible: Bool { capa?.esTeatro ?? false }

    /// Cambia la ruta. No anima (animan las capas al ver el cambio). Si no cambia nada, no hace nada.
    func ir(_ destino: Destino, desde origen: OrigenApertura = .ninguno) {
        let antes = destinoVisible
        guard destino != antes else { return }
        sentido = Sentido.entre(antes, destino)
        guard let nueva = destino.pestana else {
            capa = destino
            origenApertura = origen
            return
        }
        capa = nil
        origenApertura = .ninguno
        pestana = nueva
        visitadas.insert(nueva)
        aplicarParametros(de: destino)
    }

    /// Pestaña activa → subirArriba[p] += 1 (y sin capa); otra → ir(p) con háptica de selección.
    func tocarPestana(_ p: Pestana) {
        if p == pestana && capa == nil {
            subirArriba[p, default: 0] += 1
        } else {
            ir(destino(de: p))
        }
    }

    /// Quita la capa; sin capa, a la agenda (a2 §2.2).
    func atras() {
        if capa != nil {
            sentido = .atras
            capa = nil
            origenApertura = .ninguno
        } else if pestana != .agenda {
            ir(.agenda)
        }
    }

    private func destino(de p: Pestana) -> Destino {
        switch p {
        case .agenda: .agenda
        case .canales: .canales(pestanaCanales)
        case .buscar: .buscar(q: textoBuscar.isEmpty ? nil : textoBuscar)
        case .ajustes: .ajustes(seccionAjustes)
        }
    }

    private func aplicarParametros(de destino: Destino) {
        switch destino {
        case .canales(let p?): pestanaCanales = p
        case .buscar(let q?): textoBuscar = q
        case .ajustes(let s?):
            seccionAjustes = s
            peticionSeccion += 1
        default: break
        }
    }
}
