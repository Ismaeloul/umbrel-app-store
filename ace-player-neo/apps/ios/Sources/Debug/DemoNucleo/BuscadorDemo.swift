#if DEBUG
    import Foundation

    /* Buscador de muestra (a7 §13.11), port de features/search/demo.ts: 14 canales, se filtran por el título
       plegado (sin tildes, minúsculas, 80 caracteres) y salen por disponibilidad. Espera de 260 ms (la pone
       `RutasDemo`). */

    enum BuscadorDemo {
        /// `CATALOG`: título, categoría y disponibilidad, en el orden de la web.
        static let catalogo: [(titulo: String, categoria: String, disponibilidad: Double)] = [
            ("DAZN 1 HD", "Deportes", 0.92), ("DAZN 2 HD", "Deportes", 0.81), ("DAZN LaLiga", "Deportes", 0.95),
            ("DAZN LaLiga 2", "Deportes", 0.58), ("M+ LaLiga TV", "Deportes", 0.9), ("M+ Liga de Campeones", "Deportes", 0.87),
            ("M+ Liga de Campeones 2", "Deportes", 0.44), ("M+ Vamos", "Deportes", 0.63), ("Eurosport 1", "Deportes", 0.71),
            ("Eurosport 2", "Deportes", 0.36), ("LaLiga TV Hypermotion", "Deportes", 0.52), ("Gol Play", "Deportes", 0.66),
            ("Teledeporte", "Generalistas", 0.77), ("La 1", "Generalistas", 0.83),
        ]

        /// `demoSearch(query)`.
        static func buscar(_ consulta: String) -> JSON {
            let q = FuentesDemo.prefijoUTF16(Texto.plegar(consulta), 80)
            let resultados: [JSON] = catalogo
                .filter { q.isEmpty || Texto.plegar($0.titulo).contains(q) }
                .enumerated()
                .sorted { $0.element.disponibilidad == $1.element.disponibilidad ? $0.offset < $1.offset : $0.element.disponibilidad > $1.element.disponibilidad }
                .map { par in
                    let canal = par.element
                    var o = JSON.objeto([])
                    o["id"] = .texto(HashesDemo.fakeHash(canal.titulo))
                    o["title"] = .texto(canal.titulo)
                    o["category"] = .texto(canal.categoria)
                    o["availability"] = .numero(canal.disponibilidad)
                    o["bitrate"] = .nulo
                    o["ih"] = .bool(true)
                    return o
                }
            return .obj(["query": .texto(q), "results": .lista(resultados)])
        }
    }
#endif
