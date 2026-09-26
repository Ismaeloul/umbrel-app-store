import Foundation

/* Los textos del cartel de fuente (Isma, 26-sep; la web cambia igual en SourcePoster.tsx y ChannelMark):
   dentro de la tesela, el PROVEEDOR (el sitio y la letra de la sigla); debajo, solo el NOMBRE DEL CANAL, sin el
   proveedor, porque ya está arriba. Los títulos de las listas suelen llevarlo pegado:

     «MOVISTAR PLUS FHD --> NEW ERA III» → «MOVISTAR PLUS FHD»      «DAZN 1 HD | ELCANO» → «DAZN 1 HD»
     «M+ LaLiga (NEW ERA)» → «M+ LaLiga»                            «LaLiga TV [Elcano] 1080» → «LaLiga TV 1080»

   Se quita el proveedor de la fila (el de la tesela: tras la flecha, si no la lista) y sus variantes («NEW ERA» frente a
   «NEW ERA III»), con su separador (-->, ->, =>, », |, guion o raya) o sus paréntesis o corchetes. Sin
   distinguir mayúsculas y solo palabras enteras. Si no queda nada, el título tal cual. Puro [L]: NombreCartelTests. */

enum NombreCartel {
    /// El texto de la tesela: el proveedor en una palabra (`presentation.short`: tras la flecha, si no la lista, si
    /// no el tipo), en mayúsculas como la sigla.
    static func proveedorTesela(_ presentacion: PresentacionFuente) -> String {
        presentacion.corto.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    /// El nombre de debajo: el título sin el proveedor que ya sale en la tesela. Sin título, el canal con el que
    /// casó.
    static func nombre(_ entrada: EntradaFuente, _ presentacion: PresentacionFuente) -> String {
        let titulo = entrada.titulo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !titulo.isEmpty else { return ReglasFuentes.nombreCanal(entrada) }
        return sinProveedor(titulo, proveedores: [presentacion.corto])
    }

    /// El título sin los proveedores ni sus separadores; si no queda nada, el título tal cual.
    static func sinProveedor(_ titulo: String, proveedores: [String]) -> String {
        let bases = proveedores.map(base).filter { !$0.isEmpty }.sorted { $0.count > $1.count }
        var texto = titulo
        for proveedor in bases { texto = quitar(proveedor, de: texto) }
        let limpio = limpiar(texto)
        return limpio.isEmpty ? titulo.trimmingCharacters(in: .whitespacesAndNewlines) : limpio
    }

    // MARK: Piezas

    /// Separadores entre el canal y el proveedor: flechas, «»», «|», «·», «:», guion y rayas.
    private static let separador = "(?:-{1,2}>|={1,2}>|[→⇒➜➝⟶⟹»|·:]|[-–—])"
    /// Letra o cifra: lo que no puede tocar al proveedor para que sea una palabra entera.
    private static let letra = "[\\p{L}\\p{N}]"

    /// El proveedor sin su numeración final («NEW ERA III» → «NEW ERA», «Elcano 2» → «Elcano»).
    static func base(_ proveedor: String) -> String {
        let limpio = proveedor.trimmingCharacters(in: .whitespacesAndNewlines)
        let sinNumero = reemplazar(limpio, "\\s+(?:[IVX]{1,4}|\\d{1,2})$", por: "")
        return sinNumero.isEmpty ? limpio : sinNumero
    }

    /// El proveedor con cualquier numeración detrás (sus variantes), como palabra entera.
    private static func patron(_ base: String) -> String {
        let palabras = base.split(whereSeparator: \.isWhitespace).map { NSRegularExpression.escapedPattern(for: String($0)) }
        let cuerpo = palabras.joined(separator: "\\s+")
        return "(?<!\(letra))\(cuerpo)(?:\\s+(?:[IVX]{1,4}|\\d{1,2}))?(?!\(letra))"
    }

    private static func quitar(_ base: String, de texto: String) -> String {
        let p = patron(base)
        var t = reemplazar(texto, "\\s*[(\\[{]\\s*\(p)\\s*[)\\]}]", por: " ")
        t = reemplazar(t, "\\s*\(separador)\\s*\(p)", por: " ")
        t = reemplazar(t, "\(p)\\s*\(separador)\\s*", por: " ")
        return reemplazar(t, p, por: " ")
    }

    /// Paréntesis vacíos fuera, espacios juntos y sin separadores sueltos en los extremos.
    private static func limpiar(_ texto: String) -> String {
        var t = reemplazar(texto, "[(\\[{]\\s*[)\\]}]", por: " ")
        t = reemplazar(t, "\\s+", por: " ")
        t = reemplazar(t, "^(?:\\s|\(separador))+", por: "")
        t = reemplazar(t, "(?:\\s|\(separador))+$", por: "")
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func reemplazar(_ texto: String, _ patron: String, por: String) -> String {
        guard let expresion = try? NSRegularExpression(pattern: patron, options: [.caseInsensitive]) else { return texto }
        let rango = NSRange(texto.startIndex..., in: texto)
        return expresion.stringByReplacingMatches(in: texto, options: [], range: rango, withTemplate: por)
    }
}
