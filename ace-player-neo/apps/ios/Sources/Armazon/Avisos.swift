import Observation

/* El notify() de la web (b-arquitectura §2.4.4, I0→M4; carpeta notices de la web): decide toast o línea de estado,
   lleva los relojes y guarda las acciones («Deshacer») por id. Las reglas puras son de M2 (ColaToasts,
   LineaEstado); aquí solo se juntan. Cuerpos de I0 (fase 0.3b); M4 los afina (AvisosTests) y pinta
   `CapaAvisos` (toasts) y la línea de estado del teatro. */

struct AccionAviso {
    var titulo: String
    var hacer: () -> Void
}

/// notify() de la web: decide toast o línea de estado, lleva los relojes y guarda las acciones.
@MainActor @Observable final class Avisos {
    private(set) var cola = ColaToasts()
    private(set) var linea = LineaEstado()
    var viendoTeatro = false  // `watching`
    var inmersivo = false

    @ObservationIgnored private var acciones: [Int: () -> Void] = [:]
    @ObservationIgnored private var relojes: [Int: Task<Void, Never>] = [:]
    @ObservationIgnored private var relojLinea: Task<Void, Never>?

    @discardableResult
    func avisar(
        _ texto: String, clase: ClaseAviso = .accion, tono: TonoAviso = .info, icono: NombreIcono? = nil,
        senal: EstadoSenal? = nil, dato: String? = nil, accion: AccionAviso? = nil,
        duracion: Double? = nil
    ) -> DestinoAviso {
        let destino = LineaEstado.destino(clase: clase, conAccion: accion != nil, viendoTeatro: viendoTeatro)
        switch destino {
        case .linea:
            let contenido = ContenidoLinea(texto: texto, tono: tono, senal: senal, icono: icono, dato: dato)
            _ = linea.mostrar(contenido)
            programarLinea(duracion ?? LineaEstado.duracion)
        case .toast:
            let puesto = cola.poner(texto, tono: tono, icono: icono, tituloAccion: accion?.titulo)
            if let accion { acciones[puesto.id] = accion.hacer }
            for id in puesto.salen { salir(id) }
            programar(puesto.id, duracion ?? ColaToasts.duracion)
        }
        return destino
    }

    func fijarBase(_ base: ContenidoLinea?) { linea.fijarBase(base) }

    func vaciarLinea() {
        relojLinea?.cancel()
        linea.vaciar()
    }

    func ejecutarAccion(_ id: Int) {
        let accion = acciones[id]
        cerrar(id)
        accion?()
    }

    func cerrar(_ id: Int) { salir(id) }

    // MARK: Relojes

    private func programar(_ id: Int, _ segundos: Double) {
        relojes[id]?.cancel()
        relojes[id] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(segundos))
            guard !Task.isCancelled else { return }
            self?.salir(id)
        }
    }

    private func salir(_ id: Int) {
        relojes[id]?.cancel()
        acciones[id] = nil
        cola.empezarSalida(id)
        relojes[id] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(ColaToasts.salida))
            guard !Task.isCancelled else { return }
            self?.quitar(id)
        }
    }

    private func quitar(_ id: Int) {
        relojes[id] = nil
        cola.quitar(id)
    }

    private func programarLinea(_ segundos: Double) {
        relojLinea?.cancel()
        relojLinea = Task { [weak self] in
            try? await Task.sleep(for: .seconds(segundos))
            guard !Task.isCancelled else { return }
            self?.linea.empezarSalida()
        }
    }
}
