import Foundation

/* Texto en español como lo escribe la web (b-arquitectura §2.1.3, M2): `foldText` (library/model.ts),
   `keepUnitsTogether` (agenda/domain.ts), `plural` y `sentence` (health/model.ts) y las listas
   «a, b y c» de `Intl.ListFormat('es-ES', {type: 'conjunction'})` (preferences/model.ts, SettingsView.tsx). */

enum Texto {
    /// Sin tildes ni diéresis: NFD sin las marcas U+0300–U+036F (`normalize('NFD').replace(/[̀-ͯ]/g, '')`).
    static func sinMarcas(_ texto: String) -> String { ParaTi.sinMarcas(texto) }

    /// `foldText`: minúsculas, sin tildes y recortado («Fútbol» encuentra «futbol» y al revés).
    static func plegar(_ texto: String) -> String {
        sinMarcas(texto).lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `keepUnitsTogether`: cifra y unidad («2 h», «28 min») con espacio duro, solo para pintar.
    static func unidadesJuntas(_ texto: String) -> String {
        let patron = #"([0-9]+) (h|min)(?![A-Za-z0-9_])"#
        guard let expresion = try? NSRegularExpression(pattern: patron) else { return texto }
        return expresion.stringByReplacingMatches(
            in: texto, range: NSRange(texto.startIndex..., in: texto), withTemplate: "$1\u{00A0}$2")
    }

    /// `plural`: «1 partido», «3 partidos».
    static func plural(_ cuenta: Int, _ uno: String, _ varios: String) -> String {
        "\(cuenta) \(cuenta == 1 ? uno : varios)"
    }

    /// `sentence`: recortado y con la primera letra en mayúscula.
    static func frase(_ texto: String) -> String {
        let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let primera = limpio.first else { return "" }
        return primera.uppercased() + limpio.dropFirst()
    }

    /// `Intl.ListFormat('es-ES', {type: 'conjunction'})`: «a», «a y b», «a, b y c». Como ICU, «y» pasa a «e»
    /// delante de una palabra que suena «i» (empieza por «i» o «hi», pero no «hie» ni «hia»…).
    static func lista(_ partes: [String]) -> String {
        guard let ultima = partes.last else { return "" }
        guard partes.count > 1 else { return ultima }
        let cabeza = partes.dropLast().joined(separator: ", ")
        return "\(cabeza) \(conjuncion(antesDe: ultima)) \(ultima)"
    }

    /// «y» o «e» según cómo empieza la palabra siguiente: la regla de ICU para el español
    /// (`(?i)i.*|hi|hi[^ae].*`, listformatter.cpp), la que aplica `Intl.ListFormat`.
    static func conjuncion(antesDe palabra: String) -> String {
        let letras = Array(palabra.lowercased())
        guard let primera = letras.first else { return "y" }
        if primera == "i" { return "e" }
        if primera == "h", letras.count >= 2, letras[1] == "i" {
            if letras.count == 2 { return "e" }
            return letras[2] == "a" || letras[2] == "e" ? "y" : "e"
        }
        return "y"
    }
}
