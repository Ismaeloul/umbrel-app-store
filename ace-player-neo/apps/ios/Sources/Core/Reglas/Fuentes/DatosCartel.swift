import Foundation

/* Las líneas de debajo del cartel de fuente (Isma, 26-sep; web 613f80e en origin/rediseno/iptv, SourcePoster.tsx y
   model.ts): bajo el nombre, el anillo con su palabra en su línea; debajo, los datos técnicos, una etiqueta por dato
   (`posterTagsOf`: «1080p», «HEVC» y el tipo «M3U»), siempre enteras; y la frase solo si dice algo más que el estado
   (`posterDetailOf`). La app no tiene IPTV: `qualityTags` sin su rama de calidad declarada y «reserva».
   Puro [L]: DatosCartelTests, con los casos de model.test.ts y SourcePoster.test.ts. */

enum DatosCartel {
    /// `PosterTag`: la calidad o el tipo de fuente (este se pinta solo con el filo).
    struct Etiqueta: Sendable, Hashable {
        enum Clase: Sendable, Hashable { case calidad, tipo }
        var clase: Clase
        var texto: String
    }

    /// `posterTagsOf`: la calidad (definición y códec) y el tipo, este solo si no es ya lo que lleva la tesela.
    static func etiquetas(_ entrada: EntradaFuente, _ presentacion: PresentacionFuente) -> [Etiqueta] {
        var etiquetas = ReglasFuentes.etiquetasCalidad(entrada.sonda).map { Etiqueta(clase: .calidad, texto: $0) }
        if !presentacion.tipo.isEmpty, presentacion.tipo != presentacion.corto {
            etiquetas.append(Etiqueta(clase: .tipo, texto: presentacion.tipo))
        }
        return etiquetas
    }

    /// `posterDetailOf`: la frase solo si no repite la palabra del estado; si empieza repitiéndola y sigue tras un
    /// separador («sin señal; reintento a las 21:30»), queda lo nuevo. Sin mirar mayúsculas, tildes ni el punto.
    static func frase(palabra: String?, detalle: String?) -> String? {
        let frase = (detalle ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !frase.isEmpty else { return nil }
        let estado = llana(palabra ?? "")
        guard !estado.isEmpty else { return frase }
        if llana(frase) == estado { return nil }
        guard let separador = frase.range(of: "\\s*[;:,·—–]\\s*", options: .regularExpression) else { return frase }
        guard llana(String(frase[..<separador.lowerBound])) == estado else { return frase }
        return self.frase(palabra: palabra, detalle: String(frase[separador.upperBound...]))
    }

    /// `plainPhrase`: minúsculas, sin tildes, espacios juntos y sin punto final.
    static func llana(_ texto: String) -> String {
        var t = texto.decomposedStringWithCanonicalMapping
        t = t.replacingOccurrences(of: "\\p{M}", with: "", options: .regularExpression)
        t = t.lowercased(with: Locale(identifier: "es"))
        t = t.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "[\\s.…]+$", with: "", options: .regularExpression)
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
