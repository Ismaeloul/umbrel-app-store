import Foundation

/* Las marcas de calidad y códec que un nombre de canal lleva y que NO son el número del canal («La 1 TVE 720p» → el
   canal es «La 1»), como las escribe la web (Isma, 26-sep; docs/iptv.md §18): `isQualityNumber` y
   `stripQualityMarks` de packages/shared/src/domain/channel-names.ts en origin/rediseno/iptv. Las usan el dorsal
   (`TonoCanal.dorsal`) y el nombre de debajo del cartel de fuente (`NombreCartel.nombre`).
   `\d` de JavaScript es solo ASCII: aquí va `[0-9]`. Puro [L]: CalidadNombreTests. */

enum CalidadNombre {
    /// `QUALITY_NUMBERS`: resoluciones que un nombre lleva como marca de calidad (nunca como número de canal).
    static let numerosCalidad: Set<String> = ["240", "360", "480", "540", "576", "720", "1080", "1440", "2160", "4320"]

    /// `isQualityNumber`: «720», «1080», «2160»… Para el dorsal: «La 1 TVE 720» → «1».
    static func esNumeroCalidad(_ valor: String) -> Bool { numerosCalidad.contains(valor) }

    /// `QUALITY_MARK_RE`: «720p», «1080i», «1080p50», «2160», «4K», «8K», «UHD», «FHD», «HD», «SD», «HEVC», «H264»,
    /// «H.265», «x265», «50fps», «60 FPS», «HDR», «HDR10». Solo palabras enteras, sin mirar mayúsculas.
    static let patronMarca = "(?<![\\p{L}\\p{N}])(?:(?:240|360|480|540|576|720|1080|1440|2160|4320)(?:[pi](?:[0-9]{2})?)?"
        + "|[48]k|u?hd|fhd|full\\s*hd|sd|hevc|[hx]\\.?26[45]|avc|hdr(?:10)?|[0-9]{2,3}\\s*fps)\\+?(?![\\p{L}\\p{N}])"

    /// `stripQualityMarks`: el nombre sin las marcas de calidad y códec («La 1 TVE 720p» → «La 1 TVE», «DAZN 1
    /// 1080p50 HEVC» → «DAZN 1»), ni los asteriscos de copia del final. Si no quedara nada, el nombre tal cual.
    static func sinMarcas(_ nombre: String) -> String {
        let original = recortar(reemplazar(nombre, "\\s+", por: " "))
        var salida = reemplazar(original, patronMarca, por: " ", opciones: [.caseInsensitive])
        salida = reemplazar(salida, "(?:\\s*\\*)+\\s*$", por: " ")
        salida = reemplazar(salida, "\\s*[/|·-]\\s*(?=$)", por: " ", soloLaPrimera: true)
        salida = reemplazar(salida, "\\(\\s*\\)|\\[\\s*\\]", por: " ")
        salida = recortar(reemplazar(salida, "\\s+", por: " "))
        return salida.isEmpty ? original : salida
    }

    static func recortar(_ texto: String) -> String {
        texto.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `String.replace` de JavaScript con una expresión global (o sin `g`, con `soloLaPrimera`).
    static func reemplazar(
        _ texto: String, _ patron: String, por plantilla: String, opciones: NSRegularExpression.Options = [],
        soloLaPrimera: Bool = false
    ) -> String {
        guard let expresion = try? NSRegularExpression(pattern: patron, options: opciones) else { return texto }
        let cadena = texto as NSString
        var rango = NSRange(location: 0, length: cadena.length)
        if soloLaPrimera {
            guard let primera = expresion.firstMatch(in: texto, range: rango) else { return texto }
            rango = primera.range
        }
        return expresion.stringByReplacingMatches(in: texto, options: [], range: rango, withTemplate: plantilla)
    }
}
