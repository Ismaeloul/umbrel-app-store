import Foundation

/* Dorsal y tesela de canal (b-arquitectura §2.1.3, M2; a1 §2.5, a7 §13.9): `channelTone` de lib/color.ts
   y `channelDorsal` / `channelAbbrev` de ui/ChannelMark.tsx. El dorsal pinta la cifra (o la inicial) del
   canal sobre un tono sacado del nombre, nunca en las franjas de los estados. */

enum TonoCanal {
    /// `channelTone`: cálidos (40…115) más claros y con más croma para que no se lean marrón u oliva.
    static func tono(_ nombre: String) -> Oklch {
        let h = ColorOKLab.tonoDeNombre(nombre)
        let calido = h >= 40 && h <= 115  // lib/color.ts
        return Oklch(l: calido ? 0.56 : 0.46, c: calido ? 0.13 : 0.11, h: h)
    }

    /// `--tone-hi` de ChannelMark.tsx: el mismo tono con L + 0,12.
    static func tonoAlto(_ nombre: String) -> Oklch {
        var tono = tono(nombre)
        tono.l += 0.12  // ui/ChannelMark.tsx
        return tono
    }

    /// `DORSAL_BACKUP_RE`: la reserva («(BK-2)», «[BK 1]», «BK-1») no es el número del canal (docs/iptv.md §19).
    static let patronReserva = #"[(\[]\s*(?:bk|bkp|backup)\s*[-_]?\s*[0-9]{0,2}\s*[)\]]"#
        + #"|\b(?:bk|bkp|backup)\s*[-_]?\s*[0-9]{1,2}\b"#
    /// `DORSAL_SIZE_RE`: tampoco una resolución escrita «1920x1080».
    static let patronTamano = #"\b[0-9]{3,4}\s*[x×]\s*[0-9]{3,4}\b"#
    /// `DORSAL_NUMBER_RE`: un número, con la letra suelta que lleve pegada delante («F1», «M4»; en «TV3», solo «3»).
    static let patronNumero = #"(?:(?<!\p{L})(\p{L}))?([0-9]+)"#

    /// `channelDorsal` (origin/rediseno/iptv, ui/ChannelMark.tsx): «DAZN 1» → «1», «M+ Liga de Campeones 2» → «2»,
    /// «Eurosport» → «E», sin nada → «·». Las cifras de resolución, códec, fotogramas, reserva y tamaño no son el
    /// número del canal (Isma, 26-sep): «La 1 TVE 720p» → «1», «Eurosport 4K» → «E»; y la letra suelta pegada va
    /// con él: «DAZN F1» → «F1».
    static func dorsal(_ nombre: String) -> String {
        var limpio = CalidadNombre.reemplazar(nombre, patronReserva, por: " ", opciones: [.caseInsensitive])
        limpio = CalidadNombre.reemplazar(limpio, patronTamano, por: " ", opciones: [.caseInsensitive])
        let sinCalidad = CalidadNombre.sinMarcas(limpio)
        if let ultimo = numeros(sinCalidad).last { return String(ultimo.prefix(3)) }
        let sinMarcas = Texto.sinMarcas(nombre)
        if let letra = sinMarcas.unicodeScalars.first(where: { ("A"..."Z").contains($0) || ("a"..."z").contains($0) }) {
            return String(letra).uppercased()
        }
        return "·"
    }

    /// Los números del nombre que no son de calidad, cada uno con su letra pegada delante en mayúscula.
    private static func numeros(_ texto: String) -> [String] {
        guard let expresion = try? NSRegularExpression(pattern: patronNumero) else { return [] }
        let cadena = texto as NSString
        var salida: [String] = []
        for coincidencia in expresion.matches(in: texto, range: NSRange(location: 0, length: cadena.length)) {
            let cifras: String = cadena.substring(with: coincidencia.range(at: 2))
            guard !CalidadNombre.esNumeroCalidad(cifras) else { continue }
            let rangoLetra: NSRange = coincidencia.range(at: 1)
            let letra: String = rangoLetra.location == NSNotFound ? "" : cadena.substring(with: rangoLetra).uppercased()
            salida.append(letra + cifras)
        }
        return salida
    }

    /// `channelAbbrev`: «DAZN LaLiga» → «DAZN», «La 1 HD» → «LA 1», «Eurosport» → «EUROSP»; una sigla entre la marca
    /// y el número también va: «DAZN ACB 1» → «DAZN ACB» (docs/iptv.md §16.16).
    static func sigla(_ nombre: String) -> String {
        let palabras = nombre.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard let primera = palabras.first else { return "" }
        let articulos: Set<String> = ["la", "el", "los", "las"]  // ui/ChannelMark.tsx
        if articulos.contains(primera.lowercased()), palabras.count > 1 {
            return String("\(primera) \(palabras[1])".prefix(6)).uppercased()
        }
        if palabras.count >= 3, let ultima = palabras.last, esCifras(ultima), esSiglaMayuscula(palabras[1]) {
            return "\(primera.prefix(6)) \(palabras[1])".uppercased()
        }
        return String(primera.prefix(6)).uppercased()
    }

    /// `/^\d+$/`.
    private static func esCifras(_ palabra: String) -> Bool {
        !palabra.isEmpty && palabra.unicodeScalars.allSatisfy { ("0"..."9").contains($0) }
    }

    /// `/^\p{Lu}{2,4}$/u`.
    private static func esSiglaMayuscula(_ palabra: String) -> Bool {
        let escalares = palabra.unicodeScalars
        return (2...4).contains(escalares.count) && escalares.allSatisfy { $0.properties.generalCategory == .uppercaseLetter }
    }

    /// ¿El dorsal es una letra? (ChannelMark.tsx: una letra se recorta por la derecha; una cifra, por abajo).
    static func dorsalEsLetra(_ nombre: String) -> Bool {
        !dorsal(nombre).unicodeScalars.contains { ("0"..."9").contains($0) }
    }
}
