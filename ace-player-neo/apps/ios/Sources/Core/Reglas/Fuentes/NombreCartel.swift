import Foundation

/* Los textos del cartel de fuente (Isma, 26-sep): dentro de la tesela, el PROVEEDOR (el sitio y la letra de la
   sigla); debajo, solo el NOMBRE DEL CANAL, sin el proveedor, porque ya está arriba («si ya pones New Era o Elcano
   arriba, de nada sirve volver a ponerlo abajo»).

   Calco de la web (origin/rediseno/iptv): `posterNameOf` de SourcePoster.tsx y `channelNameWithoutProvider` de
   features/sources/model.ts, con las mismas expresiones. El proveedor (y su variante con o sin numeral: «NEW ERA»
   frente a «NEW ERA III») solo se quita cuando:
    - va entre paréntesis, corchetes o llaves, solo («M+ LaLiga (NEW ERA)») o al principio o al final de lo de dentro
      («Canal (Elcano 1080p)» → «Canal (1080p)»);
    - va unido a un separador (flechas, «»», «|», «·», «:», «/», guion con un espacio al lado o raya) y ocupa todo
      ese tramo («… --> NEW ERA III», «ELCANO | DAZN 1»);
    - son las últimas palabras del nombre («DAZN 1 Elcano»).
   Nunca suelto al principio ni en mitad: con «Casa», «Casa de Papel TV» se queda igual. Sin distinguir mayúsculas
   ni tildes y solo por palabras enteras. Si al quitarlo no queda ninguna letra, devuelve el original.

   Diferencia de motor: ICU no admite miradas atrás sin tope, así que el `\s*` de las dos que lo llevan en la web
   pasa a `\s{0,64}` (los nombres llegan con los espacios juntados). Puro [L]: NombreCartelTests, con TODOS los
   casos del bloque «nombre de debajo del cartel, sin el proveedor» de model.test.ts. */

enum NombreCartel {
    /// El texto de la tesela (`label={row.presentation.short}` + `label?.trim()` de ChannelMark): el proveedor en una
    /// palabra (tras la flecha, si no la lista, si no el tipo). nil si llega vacío, y la tesela vuelve a la sigla.
    static func proveedorTesela(_ presentacion: PresentacionFuente) -> String? {
        let texto = presentacion.corto.trimmingCharacters(in: .whitespacesAndNewlines)
        return texto.isEmpty ? nil : texto
    }

    /// `posterNameOf`: el nombre del canal (`channelNameOf`) sin el proveedor que ya lleva la tesela.
    static func nombre(_ entrada: EntradaFuente, _ presentacion: PresentacionFuente) -> String {
        let proveedores = [presentacion.corto, presentacion.proveedor, presentacion.lista]
        return sinProveedor(ReglasFuentes.nombreCanal(entrada), proveedores: proveedores)
    }

    /// `channelNameWithoutProvider(name, providers)`.
    static func sinProveedor(_ nombre: String, proveedores: [String?]) -> String {
        let original = recortar(reemplazar(nombre, "\\s+", por: " "))
        let variantes = variantes(proveedores)
        guard !original.isEmpty, !variantes.isEmpty else { return original }
        var resultado = original
        for variante in variantes {
            for patron in patrones(variante) { resultado = quitar(patron, de: resultado) }
        }
        let limpio = limpiar(resultado)
        return limpio.range(of: "\\p{L}", options: .regularExpression) == nil ? original : limpio
    }
}

// MARK: - Piezas (las constantes de model.ts)

extension NombreCartel {
    /// `PROVIDER_SEPARATOR`: el guion suelto solo cuenta con un espacio al lado («Eurosport 1 - Elcano»); pegado a
    /// dos palabras («Casa-Blanca») es parte del nombre.
    static let separador = "(?:-{1,2}>|={1,2}>|[→⇒➜➝⟶⟹»|·:/–—]|(?<=\\s)-|-(?=\\s))"
    /// `PROVIDER_SUFFIX`: «NEW ERA III», «Elcano 2».
    static let sufijo = "(?:\\s+(?:[ivx]{1,4}|\\d{1,2}))?"
    static let abre = "[(\\[{]"
    static let cierra = "[)\\]}]"
    static let bordes = "\\s\\-–—|»·:/<>=→⇒➜➝⟶⟹,"
    static let noLetraAntes = "(?<![\\p{L}\\p{N}])"
    static let noLetraDespues = "(?![\\p{L}\\p{N}])"

    /// Los proveedores plegados, cada uno con su base sin numeral, sin repetir y los largos primero (estable).
    static func variantes(_ proveedores: [String?]) -> [String] {
        var vistas: [String] = []
        for crudo in proveedores {
            let proveedor = plegar(recortar(reemplazar(crudo ?? "", "\\s+", por: " ")))
            guard !proveedor.isEmpty else { continue }
            if !vistas.contains(proveedor) { vistas.append(proveedor) }
            let base = reemplazar(proveedor, "\\s+(?:[ivx]{1,4}|\\d{1,2})$", por: "")
            if !base.isEmpty, base != proveedor, !vistas.contains(base) { vistas.append(base) }
        }
        let ordenadas = vistas.enumerated().sorted { a, b in
            let la = a.element.utf16.count
            let lb = b.element.utf16.count
            return la == lb ? a.offset < b.offset : la > lb
        }
        return ordenadas.map { $0.element }
    }

    /// Los seis patrones de la web, en su orden, para una variante.
    static func patrones(_ variante: String) -> [String] {
        let trozos = variante.components(separatedBy: " ").map { NSRegularExpression.escapedPattern(for: $0) }
        let palabra = trozos.joined(separator: "\\s+") + sufijo
        let finTramo = "(?=\\s*(?:$|\(separador)|\(abre)|\(cierra)))"
        return [
            // «(NEW ERA)», «[Elcano]», «{Faro}»: el paréntesis entero.
            "\\s*\(abre)\\s*\(palabra)\\s*\(cierra)",
            // «(Elcano 1080p)», «(Elcano - 1080p)»: al principio de lo de dentro.
            "(?<=\(abre)\\s{0,64})\(palabra)\(noLetraDespues)(?:\\s*\(separador))?",
            // «(1080p Elcano)», «(1080p - Elcano)»: al final de lo de dentro.
            "(?:\\s*\(separador))?\\s*\(noLetraAntes)\(palabra)(?=\\s*\(cierra))",
            // «… --> NEW ERA III», «… | ELCANO», «A - Elcano - B»: todo el tramo.
            "\\s*\(separador)\\s*\(palabra)\(finTramo)",
            // «ELCANO | DAZN 1», «[HD] Elcano | DAZN 1»: el primer tramo.
            "(?<=(?:^|\(abre)|\(cierra))\\s{0,64})\(palabra)\\s*\(separador)\\s*",
            // «DAZN 1 ELCANO»: las últimas palabras.
            "\(noLetraAntes)\(palabra)(?=[\(bordes)]*$)",
        ]
    }

    /// Busca en la copia plegada y corta el original por las mismas posiciones (UTF-16 en los dos), dejando un
    /// espacio donde estaba cada coincidencia.
    static func quitar(_ patron: String, de texto: String) -> String {
        guard let expresion = try? NSRegularExpression(pattern: patron) else { return texto }
        let plegado = plegar(texto) as NSString
        let original = texto as NSString
        var siguiente = ""
        var ultimo = 0
        for coincidencia in expresion.matches(in: plegado as String, range: NSRange(location: 0, length: plegado.length)) {
            let inicio = coincidencia.range.location
            siguiente += original.substring(with: NSRange(location: ultimo, length: inicio - ultimo)) + " "
            ultimo = inicio + coincidencia.range.length
        }
        guard ultimo > 0 else { return texto }
        return siguiente + original.substring(from: ultimo)
    }

    /// Paréntesis vacíos fuera, sin espacios pegados por dentro, espacios juntos y sin separadores en los extremos.
    static func limpiar(_ texto: String) -> String {
        var t = reemplazar(texto, "\(abre)\\s*\(cierra)", por: " ")
        t = reemplazar(t, "(\(abre))\\s+", por: "$1")
        t = reemplazar(t, "\\s+(\(cierra))", por: "$1")
        t = reemplazar(t, "\\s+", por: " ")
        t = reemplazar(t, "^[\(bordes)]+|[\(bordes)]+$", por: "")
        return recortar(t)
    }

    /// `foldForMatch`: minúsculas y sin tildes, carácter a carácter y con el mismo largo en UTF-16, para cortar el
    /// original por las mismas posiciones.
    static func plegar(_ texto: String) -> String {
        var salida = ""
        for escalar in texto.unicodeScalars { salida += plegarEscalar(escalar) }
        return salida
    }

    private static func plegarEscalar(_ escalar: Unicode.Scalar) -> String {
        let caracter = String(escalar)
        var base = String.UnicodeScalarView()
        for parte in caracter.decomposedStringWithCanonicalMapping.unicodeScalars where !esMarca(parte) {
            base.append(parte)
        }
        let sinTilde = String(base)
        let elegido = sinTilde.utf16.count == 1 ? sinTilde : caracter
        let minuscula = elegido.lowercased()
        return minuscula.utf16.count == caracter.utf16.count ? minuscula : caracter
    }

    private static func esMarca(_ escalar: Unicode.Scalar) -> Bool {
        switch escalar.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: return true
        default: return false
        }
    }

    static func recortar(_ texto: String) -> String {
        texto.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func reemplazar(_ texto: String, _ patron: String, por plantilla: String) -> String {
        guard let expresion = try? NSRegularExpression(pattern: patron) else { return texto }
        let rango = NSRange(location: 0, length: (texto as NSString).length)
        return expresion.stringByReplacingMatches(in: texto, options: [], range: rango, withTemplate: plantilla)
    }
}
