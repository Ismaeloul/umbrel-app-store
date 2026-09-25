import Foundation

/* Lo que las marcas de Palco necesitan de lib/color.ts, lib/teams.ts y ui/ChannelMark.tsx (a1 §2.5).
   PROVISIONAL: el port de verdad, probado con vectores, es de M2 (Core/Reglas/Color/{ColorOKLab,Equipos,
   TonoCanal}.swift). Cuando exista, estas funciones llaman a ese port (o desaparecen) sin cambiar las vistas. */

enum TonosMarca {
    /// FNV-1a de 32 bits sobre las unidades UTF-16 (`hashText`).
    static func hash(_ texto: String) -> UInt32 {
        var h: UInt32 = 0x811C_9DC5
        for unidad in texto.utf16 {
            h ^= UInt32(unidad)
            h = h &* 0x0100_0193
        }
        return h
    }

    /// Múltiplos de 5 fuera de [15,40], [140,160] y [280,320] (52 tonos).
    static let tonosPermitidos: [Int] = stride(from: 0, to: 360, by: 5).filter { h in
        !((15...40).contains(h) || (140...160).contains(h) || (280...320).contains(h))
    }

    /// `hueFromName`.
    static func tono(_ nombre: String) -> Double {
        let clave = nombre.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let indice = Int(hash(clave) % UInt32(tonosPermitidos.count))
        return Double(tonosPermitidos[indice])
    }

    /// `channelTone`: cálidos (40…115) L 0,56 C 0,13; el resto L 0,46 C 0,11.
    static func tonoCanal(_ nombre: String) -> (l: Double, c: Double, h: Double) {
        let h = tono(nombre)
        let calido = h >= 40 && h <= 115
        return (calido ? 0.56 : 0.46, calido ? 0.13 : 0.11, h)
    }

    /// `channelDorsal`: el último grupo de cifras (hasta 3) o la primera letra sin tilde, o «·».
    static func dorsal(_ nombre: String) -> String {
        var grupos: [String] = []
        var actual = ""
        for caracter in nombre {
            if caracter.isASCII && caracter.isNumber {
                actual.append(caracter)
            } else if !actual.isEmpty {
                grupos.append(actual)
                actual = ""
            }
        }
        if !actual.isEmpty { grupos.append(actual) }
        if let ultimo = grupos.last { return String(ultimo.prefix(3)) }
        let sinTildes = nombre.folding(options: .diacriticInsensitive, locale: Locale(identifier: "es_ES"))
        if let letra = sinTildes.first(where: { $0.isASCII && $0.isLetter }) { return String(letra).uppercased() }
        return "·"
    }

    /// Palabras que no dan inicial (`SKIP` de lib/teams.ts).
    static let palabrasVacias: Set<String> = [
        "de", "del", "la", "las", "los", "el", "fc", "cf", "cd", "sd", "ud", "sc", "ac", "afc", "club", "y",
    ]

    /// `COMPETITION_SHORT` de lib/teams.ts, por orden (sin mayúsculas).
    static let competiciones: [(patrones: [String], corta: String)] = [
        (["champions"], "UCL"), (["europa league"], "UEL"), (["conference"], "UECL"), (["nations league"], "UNL"),
        (["premier"], "PL"), (["laliga", "la liga"], "LaLiga"), (["hypermotion", "segunda"], "LaLiga 2"),
        (["copa del rey"], "Copa"), (["serie a"], "Serie A"), (["bundesliga"], "BL"), (["ligue 1"], "L1"),
        (["mundial", "world cup"], "Mundial"), (["eurocopa", "euro "], "Euro"),
    ]

    /// `competitionShort`: «Champions League» → «UCL»; un nombre largo → sus iniciales.
    static func competicionCorta(_ nombre: String) -> String {
        let limpio = nombre.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpio.isEmpty { return "Fútbol" }
        let minusculas = limpio.lowercased()
        for entrada in competiciones where entrada.patrones.contains(where: { minusculas.contains($0) }) {
            return entrada.corta
        }
        if limpio.count <= 10 { return limpio }
        let palabras = limpio.split(whereSeparator: { $0.isWhitespace || $0 == "-" }).map(String.init)
        let iniciales = palabras.filter { !palabrasVacias.contains($0.lowercased()) }.compactMap(\.first)
        let texto = String(iniciales).uppercased()
        return texto.isEmpty ? String(limpio.prefix(10)) : String(texto.prefix(4))
    }

    /// `channelAbbrev`: primera palabra (o artículo + la siguiente), 6 caracteres, mayúsculas.
    static func sigla(_ nombre: String) -> String {
        let palabras = nombre.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard let primera = palabras.first else { return "" }
        let articulos: Set<String> = ["la", "el", "los", "las"]
        let base = articulos.contains(primera.lowercased()) && palabras.count > 1 ? "\(primera) \(palabras[1])" : primera
        return String(base.prefix(6)).uppercased()
    }
}
