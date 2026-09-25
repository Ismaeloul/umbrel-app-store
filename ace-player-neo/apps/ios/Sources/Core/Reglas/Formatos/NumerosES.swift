import Foundation

/* Números en español como los pinta la web (b-arquitectura §2.1.3, M2): `toLocaleString('es-ES', …)` e
   `Intl.NumberFormat('es-ES')` con tablas propias (coma decimal y separador de miles solo desde 10 000,
   que es lo que hace ICU en español), `seconds` (health/model.ts), `formatSpeed` (player/NerdPanel.tsx),
   `mbit` (sources/model.ts) y `splitDigits` (ui/Num.tsx). */

/// Un trozo de `splitDigits`: cada cifra suelta y lo demás en bloque.
struct TrozoNumero: Hashable, Sendable {
    var cifra: Bool
    var texto: String
}

enum NumerosES {
    /// `n.toLocaleString('es-ES', {minimumFractionDigits, maximumFractionDigits})` (redondeo «medio arriba»
    /// de ICU sobre el valor decimal; miles con «.» solo desde 10 000).
    static func decimal(_ valor: Double, maximo: Int, minimo: Int = 0) -> String {
        guard valor.isFinite else { return valor.isNaN ? "NaN" : (valor > 0 ? "∞" : "-∞") }
        // ICU redondea el decimal más corto que representa al double (el mismo que da `description`).
        var (cifras, coma) = cifrasDecimales(abs(valor))
        let corte = coma + maximo
        if corte < cifras.count {
            let sube = corte >= 0 && cifras[corte] >= 5
            cifras = corte > 0 ? Array(cifras[0..<corte]) : []
            if corte < 0 { cifras = [] }
            if sube { acarrear(&cifras, &coma) }
        }
        while cifras.count < coma { cifras.append(0) }
        let enteras = coma > 0 ? cifras[0..<coma].map(String.init).joined() : "0"
        var fraccion = coma < cifras.count ? cifras[max(0, coma)...].map(String.init).joined() : ""
        if coma < 0 { fraccion = String(repeating: "0", count: -coma) + fraccion }
        while fraccion.count < minimo { fraccion.append("0") }
        while fraccion.count > minimo, fraccion.hasSuffix("0") { fraccion.removeLast() }
        let entero = Int(enteras) ?? 0
        // ICU conserva el signo aunque el redondeo dé cero: -0,04 con un decimal → «-0».
        let signo = valor.sign == .minus ? "-" : ""
        return fraccion.isEmpty ? signo + miles(entero) : "\(signo)\(miles(entero)),\(fraccion)"
    }

    /// Cifras del decimal más corto de un double positivo y dónde va la coma («12.5» → [1, 2, 5], 2).
    private static func cifrasDecimales(_ valor: Double) -> (cifras: [Int], coma: Int) {
        let texto = "\(valor)".lowercased()
        let partes = texto.split(separator: "e", maxSplits: 1)
        let mantisa = String(partes.first ?? "0")
        let exponente = partes.count > 1 ? Int(partes[1]) ?? 0 : 0
        let trozos = mantisa.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        let enteras = String(trozos.first ?? "0")
        let decimales = trozos.count > 1 ? String(trozos[1]) : ""
        var cifras = (enteras + decimales).compactMap { $0.wholeNumberValue }
        var coma = enteras.count + exponente
        while cifras.count > 1, cifras.first == 0 {
            cifras.removeFirst()
            coma -= 1
        }
        return (cifras, coma)
    }

    /// Suma 1 a la última cifra (redondeo hacia arriba), llevando.
    private static func acarrear(_ cifras: inout [Int], _ coma: inout Int) {
        var indice = cifras.count - 1
        while indice >= 0 {
            if cifras[indice] < 9 {
                cifras[indice] += 1
                return
            }
            cifras[indice] = 0
            indice -= 1
        }
        cifras.insert(1, at: 0)
        coma += 1
    }

    /// Separador de miles de ICU en español: «1234», pero «12.345» (agrupación mínima de 2 cifras).
    static func miles(_ entero: Int) -> String {
        let cifras = String(entero)
        guard cifras.count >= 5 else { return cifras }
        var salida = ""
        for (indice, cifra) in cifras.enumerated() {
            if indice > 0 && (cifras.count - indice) % 3 == 0 { salida.append(".") }
            salida.append(cifra)
        }
        return salida
    }

    /// `seconds` de health/model.ts: 2300 → «2,3 s»; 800 → «0,8 s».
    static func segundos(ms: Double) -> String {
        let valor = (ms / 100).rounded(.toNearestOrAwayFromZero) / 10
        return "\(decimal(valor, maximo: 1)) s"
    }

    /// `seconds` de player/NerdPanel.tsx: «14 s», «2,5 s»; «—» si no hay dato.
    static func segundosDato(_ valor: Double?) -> String {
        guard let valor, valor.isFinite else { return "—" }
        return "\(decimal(valor, maximo: 1)) s"
    }

    /// `formatSpeed`: KB/s → «214 KB/s» o, desde 1000, «1,92 MB/s» (÷ 1024, dos decimales); «—» sin dato.
    static func velocidad(kbs: Double?) -> String {
        guard let kbs, kbs.isFinite else { return "—" }
        if kbs >= 1000 { return "\(decimal(kbs / 1024, maximo: 2, minimo: 2)) MB/s" }
        return "\(Int(kbs.rounded(.toNearestOrAwayFromZero))) KB/s"
    }

    /// `mbit` de sources/model.ts: kbit/s → Mbit/s con un decimal («4,8»).
    static func mbit(kbps: Double) -> String {
        decimal(kbps / 1000, maximo: 1, minimo: 1)
    }

    /// `splitDigits`: «90+4'» → «9», «0», «+», «4», «'».
    static func partirCifras(_ texto: String) -> [TrozoNumero] {
        var trozos: [TrozoNumero] = []
        for caracter in texto {
            let cifra = caracter.unicodeScalars.count == 1 && ("0"..."9").contains(caracter.unicodeScalars.first ?? " ")
            if !cifra, let ultimo = trozos.last, !ultimo.cifra {
                trozos[trozos.count - 1].texto.append(caracter)
            } else {
                trozos.append(TrozoNumero(cifra: cifra, texto: String(caracter)))
            }
        }
        return trozos
    }
}
