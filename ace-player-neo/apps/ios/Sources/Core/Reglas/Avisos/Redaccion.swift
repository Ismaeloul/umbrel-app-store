import Foundation

/* Los avisos hablan de la señal, no de buffers ni de infohashes (b-arquitectura §5.1 punto 2, M2): la regla
   de notices/wording.test.ts (B-268, CL-245 de la 0.6.58) aplicada a los catálogos de textos de la app.
   `RedaccionTests` la pasa a todos los textos que la app enseña en avisos, línea de estado y demo. */

enum Redaccion {
    /// `JERGA` de wording.test.ts: `/\b(buffer|búfer|infohash|stash|mpegts|hls\.js)\b/i`.
    static let jerga = ["buffer", "búfer", "infohash", "stash", "mpegts", "hls.js"]

    /// ¿El texto usa alguna palabra de la jerga? (límite de palabra como el `\b` de JavaScript: [A-Za-z0-9_]).
    static func tieneJerga(_ texto: String) -> Bool {
        palabrasDeJerga(texto).isEmpty == false
    }

    /// Las palabras de la jerga que aparecen (para el mensaje de la prueba).
    static func palabrasDeJerga(_ texto: String) -> [String] {
        let minusculas = texto.lowercased()
        return jerga.filter { contiene(minusculas, palabra: $0) }
    }

    /// Un texto se puede enseñar si habla en lenguaje de la señal.
    static func valido(_ texto: String) -> Bool { !tieneJerga(texto) }

    private static func esDePalabra(_ caracter: Character?) -> Bool {
        guard let caracter, caracter.isASCII else { return false }
        return caracter.isLetter || caracter.isNumber || caracter == "_"
    }

    /// `\bpalabra\b` de JavaScript sin la bandera `u`: «búfer» casa aunque la «ú» no sea de palabra.
    private static func contiene(_ texto: String, palabra: String) -> Bool {
        var desde = texto.startIndex
        while let rango = texto.range(of: palabra, range: desde..<texto.endIndex) {
            let antes = rango.lowerBound > texto.startIndex ? texto[texto.index(before: rango.lowerBound)] : nil
            let despues = rango.upperBound < texto.endIndex ? texto[rango.upperBound] : nil
            let empiezaLimpio = !(esDePalabra(palabra.first) && esDePalabra(antes))
            let acabaLimpio = !(esDePalabra(palabra.last) && esDePalabra(despues))
            if empiezaLimpio && acabaLimpio { return true }
            desde = texto.index(after: rango.lowerBound)
        }
        return false
    }
}
