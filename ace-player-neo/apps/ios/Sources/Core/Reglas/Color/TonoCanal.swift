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

    /// `channelDorsal`: «DAZN 1» → «1», «M+ Liga de Campeones 2» → «2», «Eurosport» → «E», sin nada → «·».
    static func dorsal(_ nombre: String) -> String {
        var grupos: [String] = []
        var actual = ""
        for escalar in nombre.unicodeScalars {
            if ("0"..."9").contains(escalar) {
                actual.unicodeScalars.append(escalar)
            } else if !actual.isEmpty {
                grupos.append(actual)
                actual = ""
            }
        }
        if !actual.isEmpty { grupos.append(actual) }
        if let ultimo = grupos.last { return String(ultimo.prefix(3)) }
        let sinMarcas = Texto.sinMarcas(nombre)
        if let letra = sinMarcas.unicodeScalars.first(where: { ("A"..."Z").contains($0) || ("a"..."z").contains($0) }) {
            return String(letra).uppercased()
        }
        return "·"
    }

    /// `channelAbbrev`: «DAZN LaLiga» → «DAZN», «La 1 HD» → «LA 1», «Eurosport» → «EUROSP».
    static func sigla(_ nombre: String) -> String {
        let palabras = nombre.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard let primera = palabras.first else { return "" }
        let articulos: Set<String> = ["la", "el", "los", "las"]  // ui/ChannelMark.tsx
        let base = articulos.contains(primera.lowercased()) && palabras.count > 1 ? "\(primera) \(palabras[1])" : primera
        return String(base.prefix(6)).uppercased()
    }

    /// ¿El dorsal es una letra? (ChannelMark.tsx: una letra se recorta por la derecha; una cifra, por abajo).
    static func dorsalEsLetra(_ nombre: String) -> Bool {
        !dorsal(nombre).unicodeScalars.contains { ("0"..."9").contains($0) }
    }
}
