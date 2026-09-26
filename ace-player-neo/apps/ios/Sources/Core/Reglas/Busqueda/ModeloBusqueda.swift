import Foundation

/* Buscador del motor AceStream, «Enlace detectado» y «Pegar hash» (M5; a5 §4, §5): port de search/model.ts
   (`cleanQuery`, `canSearch`, `searchPhase`, `isHashOrLink`), de `normalizeHash` de @ace/shared
   (domain/hash.ts: la misma regla que el servidor) y de `pastedTitle` (paste-hash). */

/// `SearchPhase`.
enum FaseBusqueda: Equatable, Sendable {
    case reposo
    case corta
    case buscando(String)
    case vacia(String)
    case error(String)
    case resultados(String, Int)
}

enum ModeloBusqueda {
    /// Espera tras la última tecla (`ENGINE_SEARCH_DELAY_MS`).
    static let espera: Double = 0.45
    /// `SEARCH_QUERY_MIN` y `SEARCH_QUERY_MAX` de @ace/shared.
    static let minimo = 2
    static let maximo = 80
    /// Máximo del campo (`FIELD_MAX`): un enlace con el id puede ser más largo que una búsqueda.
    static let maximoCampo = 200
    /// Aparición escalonada al llegar resultados nuevos (ventana de 900 ms).
    static let ventanaEntrada: Double = 0.9

    static let textoFallo = "La búsqueda falló. ¿Está el motor AceStream en línea?"

    /// `cleanQuery`: espacios colapsados, recortado y a 80.
    static func limpiar(_ valor: String) -> String {
        String(valor.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(maximo))
    }

    /// `canSearch`.
    static func sePuedeBuscar(_ valor: String) -> Bool { limpiar(valor).count >= minimo }

    /// `searchPhase`.
    static func fase(escrito: String, comprometido: String, cargando: Bool, error: Bool, cuenta: Int?) -> FaseBusqueda {
        let tecleado = limpiar(escrito)
        let hecho = limpiar(comprometido)
        if tecleado.isEmpty && hecho.isEmpty { return .reposo }
        if !tecleado.isEmpty && tecleado.count < minimo { return .corta }
        if !sePuedeBuscar(hecho) { return .reposo }
        if error { return .error(hecho) }
        guard let cuenta, !cargando else { return .buscando(hecho) }
        return cuenta == 0 ? .vacia(hecho) : .resultados(hecho, cuenta)
    }

    /// `normalizeHash`: `acestream://<40 hex>`, una URL con `?id=`/`?content_id=` de 40 hex, o cualquier texto
    /// con 40 hex seguidos. El hash en minúsculas o nil.
    static func normalizarHash(_ valor: String) -> String? {
        let bruto = valor.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !bruto.isEmpty else { return nil }
        if let rango = bruto.range(of: "acestream://") {
            let resto = bruto[rango.upperBound...]
            let candidato = String(resto.prefix(40))
            if candidato.count == 40 && esHex(candidato) { return candidato.lowercased() }
        }
        if let url = URLComponents(string: bruto), url.scheme != nil {
            let items = url.queryItems ?? []
            let id = items.first { $0.name == "id" }?.value ?? items.first { $0.name == "content_id" }?.value
            if let id, id.count == 40, esHex(id) { return id.lowercased() }
        }
        return primeros40Hex(bruto)?.lowercased()
    }

    /// `isHashOrLink`: el hash de lo escrito o pegado (nil si no hay).
    static func hashOEnlace(_ valor: String) -> String? { normalizarHash(valor) }

    /// `pastedTitle`: el tuyo si ya está en la biblioteca; si no, «Stream {8 primeros}».
    static func tituloPegado(_ hash: String, conocido: String?) -> String {
        let propio = conocido?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return propio.isEmpty ? "Stream \(hash.prefix(8))" : propio
    }

    private static func esHex(_ texto: some StringProtocol) -> Bool {
        texto.unicodeScalars.allSatisfy { $0.properties.isASCIIHexDigit }
    }

    /// `/[a-fA-F0-9]{40}/`: los primeros 40 hexadecimales seguidos.
    private static func primeros40Hex(_ texto: String) -> String? {
        var tramo = ""
        for caracter in texto {
            if caracter.isASCII && caracter.isHexDigit {
                tramo.append(caracter)
                if tramo.count == 40 { return tramo }
            } else {
                tramo = ""
            }
        }
        return nil
    }

    /// Anuncios para VoiceOver (región viva de SearchView.tsx).
    static func anuncio(_ fase: FaseBusqueda, enlace: String?, conocido: String?) -> String {
        if let enlace { return "Enlace detectado: \(conocido ?? "Content ID \(enlace)")." }
        switch fase {
        case .buscando(let q): return "Buscando «\(q)» en el motor…"
        case .resultados(let q, let n): return "\(n) \(n == 1 ? "resultado" : "resultados") para «\(q)»."
        case .vacia(let q): return "Sin resultados para «\(q)»."
        case .reposo, .corta, .error: return ""
        }
    }
}

/// Textos de «Reproducir otro hash» y «Enlace detectado» (PasteHashSheet.tsx, SearchView.tsx), literales.
enum TextosPegar {
    static let invalido = "Introduce un Content ID o enlace AceStream válido de 40 caracteres."
    static let invalidoAlEnviar = "Pega un ID AceStream válido de 40 caracteres o un enlace acestream://"
    static let portapapelesFallo = "No se pudo leer el portapapeles. Pega el enlace en el campo."
    static let reproduciendoConocido = "Reproduciendo el hash seleccionado"
    static let reproduciendoExterno = "Hash externo añadido y reproduciendo"
    static let pista =
        "Acepta un hash de 40 caracteres, un enlace acestream:// o una URL con el ID. No se vinculará automáticamente al canal ni se guardará en favoritos."
}
