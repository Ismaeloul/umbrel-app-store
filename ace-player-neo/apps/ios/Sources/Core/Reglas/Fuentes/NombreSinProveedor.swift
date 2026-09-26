import Foundation

/* `channelNameWithoutProvider` de apps/web/src/features/sources/model.ts (rediseno/iptv, 2d15104 y f57066c):
   el nombre del canal para DEBAJO del cartel de fuente, sin el proveedor que ya va en la tesela (Isma, 26-sep:
   «si ya pones New Era o Elcano arriba, de nada sirve volver a ponerlo abajo»). Mismos patrones y mismo orden
   que la web; se busca en una copia plegada (minúsculas y sin tildes, mismo largo en UTF-16) y se corta el
   original por las mismas posiciones. Las miradas atrás llevan `\s{0,20}` porque ICU no admite `\s*` ahí. */

extension ReglasFuentes {
    /// Separadores con los que las listas pegan el proveedor al canal; el guion suelto, solo con un espacio al lado.
    private static let separadorProveedor = #"(?:-{1,2}>|={1,2}>|[→⇒➜➝⟶⟹»|·:/–—]|(?<=\s)-|-(?=\s))"#
    /// «NEW ERA III», «Elcano 2»: el proveedor con su numeral detrás.
    private static let numeralProveedor = #"(?:\s+(?:[ivx]{1,4}|\d{1,2}))?"#
    private static let abre = #"[(\[{]"#
    private static let cierra = #"[)\]}]"#
    private static let bordes = #"\s\-–—|»·:/<>=→⇒➜➝⟶⟹,"#

    /// «MOVISTAR PLUS FHD --> NEW ERA III» con «New Era» → «MOVISTAR PLUS FHD». Solo quita el proveedor entre
    /// paréntesis, unido a un separador ocupando todo el tramo o como últimas palabras; nunca suelto al principio
    /// ni en mitad. Si no queda un nombre (sin letras), devuelve el original con los espacios en orden.
    static func nombreSinProveedor(_ nombre: String, proveedores: [String?]) -> String {
        let original = espaciosEnOrden(nombre)
        let variantes = variantesProveedor(proveedores)
        guard !original.isEmpty, !variantes.isEmpty else { return original }
        var resultado = original
        for variante in variantes {
            for patron in patronesProveedor(variante) {
                resultado = cortar(resultado, patron: patron)
            }
        }
        let limpio = limpiarNombre(resultado)
        return limpio.range(of: #"\p{L}"#, options: .regularExpression) != nil ? limpio : original
    }

    /// Minúsculas y sin tildes, letra a letra, sin cambiar el largo en UTF-16 (`foldForMatch`).
    static func plegarProveedor(_ texto: String) -> String {
        var salida = ""
        for letra in texto {
            let sola = String(letra)
            let marcas = sola.decomposedStringWithCanonicalMapping.unicodeScalars.filter { escalar in
                !esMarca(escalar)
            }
            let base = String(String.UnicodeScalarView(marcas))
            let baja = (base.count == 1 ? base : sola).lowercased()
            salida += baja.utf16.count == sola.utf16.count ? baja : sola
        }
        return salida
    }

    private static func esMarca(_ escalar: Unicode.Scalar) -> Bool {
        switch escalar.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: return true
        default: return false
        }
    }

    private static func espaciosEnOrden(_ texto: String) -> String {
        texto.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// Cada proveedor plegado y, si lleva numeral, también sin él; los largos primero.
    private static func variantesProveedor(_ proveedores: [String?]) -> [String] {
        var variantes = Set<String>()
        for crudo in proveedores {
            let proveedor = plegarProveedor(espaciosEnOrden(crudo ?? ""))
            guard !proveedor.isEmpty else { continue }
            variantes.insert(proveedor)
            let base = proveedor.replacingOccurrences(
                of: #"\s+(?:[ivx]{1,4}|\d{1,2})$"#, with: "", options: .regularExpression)
            if !base.isEmpty, base != proveedor { variantes.insert(base) }
        }
        return variantes.sorted { una, otra in
            una.utf16.count == otra.utf16.count ? una < otra : una.utf16.count > otra.utf16.count
        }
    }

    private static func escaparPatron(_ texto: String) -> String {
        var salida = ""
        for letra in texto {
            if ".*+?^${}()|[]\\".contains(letra) { salida.append("\\") }
            salida.append(letra)
        }
        return salida
    }

    /// Los seis patrones de la web, en su orden.
    private static func patronesProveedor(_ variante: String) -> [String] {
        let espacios: String = escaparPatron(variante).replacingOccurrences(of: " ", with: #"\s+"#)
        let palabra = "\(espacios)\(numeralProveedor)"
        let sep: String = separadorProveedor
        let antes = #"(?<![\p{L}\p{N}])"#
        let despues = #"(?![\p{L}\p{N}])"#
        let finTramo = #"(?=\s*(?:$|\#(sep)|\#(abre)|\#(cierra)))"#
        let entero = #"\s*\#(abre)\s*\#(palabra)\s*\#(cierra)"#
        let alPrincipio = #"(?<=\#(abre)\s{0,20})\#(palabra)\#(despues)(?:\s*\#(sep))?"#
        let alFinal = #"(?:\s*\#(sep))?\s*\#(antes)\#(palabra)(?=\s*\#(cierra))"#
        let tramo = #"\s*\#(sep)\s*\#(palabra)\#(finTramo)"#
        let primerTramo = #"(?<=(?:^|\#(abre)|\#(cierra))\s{0,20})\#(palabra)\s*\#(sep)\s*"#
        let ultimas = #"\#(antes)\#(palabra)(?=[\#(bordes)]*$)"#
        return [entero, alPrincipio, alFinal, tramo, primerTramo, ultimas]
    }

    /// Busca en la copia plegada y corta el original por las mismas posiciones (cada trozo quitado deja un espacio).
    private static func cortar(_ texto: String, patron: String) -> String {
        guard let expresion = try? NSRegularExpression(pattern: patron) else { return texto }
        let original = texto as NSString
        let plegado = plegarProveedor(texto)
        let total = NSRange(location: 0, length: (plegado as NSString).length)
        var salida = ""
        var ultimo = 0
        for encontrado in expresion.matches(in: plegado, range: total) {
            let rango = encontrado.range
            salida += original.substring(with: NSRange(location: ultimo, length: rango.location - ultimo)) + " "
            ultimo = rango.location + rango.length
        }
        guard ultimo > 0 else { return texto }
        return salida + original.substring(from: ultimo)
    }

    /// Paréntesis vacíos fuera, sin espacios pegados por dentro, espacios en orden y sin separadores en los bordes.
    private static func limpiarNombre(_ texto: String) -> String {
        var nombre = texto.replacingOccurrences(of: #"[(\[{]\s*[)\]}]"#, with: " ", options: .regularExpression)
        nombre = nombre.replacingOccurrences(of: #"([(\[{])\s+"#, with: "$1", options: .regularExpression)
        nombre = nombre.replacingOccurrences(of: #"\s+([)\]}])"#, with: "$1", options: .regularExpression)
        nombre = nombre.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        let bordesFuera = #"^[\#(bordes)]+|[\#(bordes)]+$"#
        nombre = nombre.replacingOccurrences(of: bordesFuera, with: "", options: .regularExpression)
        return nombre.trimmingCharacters(in: .whitespaces)
    }
}
