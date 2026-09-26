import Foundation

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Forma de Vectores/vectores-comunes.json (scripts/vectores/comunes.ts): entradas y salidas del TypeScript
   de verdad de la web para las reglas comunes de M2. Se lee una vez. */

struct VectoresComunes: Decodable, Sendable {
    struct RGBJS: Decodable, Sendable { let r: Double, g: Double, b: Double }
    struct OklchJS: Decodable, Sendable { let l: Double, c: Double, h: Double }

    struct Color: Decodable, Sendable {
        struct Hex: Decodable, Sendable { let valor: String, rgb: RGBJS?, hex: String?, oklch: OklchJS? }
        struct DeOklch: Decodable, Sendable { let oklch: OklchJS, rgb: RGBJS, hex: String, css: String }
        struct Leer: Decodable, Sendable { let texto: String, oklch: OklchJS? }
        struct Contraste: Decodable, Sendable { let a: String, b: String, contraste: Double? }
        struct Hash: Decodable, Sendable { let nombre: String, hash: UInt32 }
        struct Vetado: Decodable, Sendable { let tono: Double, vetado: Bool }
        struct Tono: Decodable, Sendable { let nombre: String, tono: Double }
        struct Luz: Decodable, Sendable { let primario: String, secundario: String?, oscuro: Bool, luz: OklchJS? }
        let hex: [Hex]
        let oklch: [DeOklch]
        let leerOklch: [Leer]
        let contraste: [Contraste]
        let hash: [Hash]
        let tonoVetado: [Vetado]
        let tonoDeNombre: [Tono]
        let luzEquipo: [Luz]
    }

    struct Canal: Decodable, Sendable { let nombre: String, tono: OklchJS, dorsal: String, sigla: String }

    struct Equipos: Decodable, Sendable {
        struct Iniciales: Decodable, Sendable { let nombre: String, corto: String?, iniciales: String }
        struct Competicion: Decodable, Sendable { let nombre: String, corta: String }
        struct TonoNombre: Decodable, Sendable { let nombre: String, tono: OklchJS }
        struct ColoresJS: Decodable, Sendable { let primary: String?, secondary: String? }
        struct EquipoJS: Decodable, Sendable { let name: String, colors: ColoresJS? }
        struct PaletaJS: Decodable, Sendable { let primary: String, secondary: String?, source: String }
        struct Paleta: Decodable, Sendable { let equipo: EquipoJS, paleta: PaletaJS }
        struct ParJS: Decodable, Sendable { let home: String, away: String, swapped: Bool, darkened: Bool }
        struct Versus: Decodable, Sendable { let local: PaletaJS, visitante: PaletaJS, distancia: Double, par: ParJS }
        let iniciales: [Iniciales]
        let competicion: [Competicion]
        let tonoNombre: [TonoNombre]
        let paletas: [Paleta]
        let versus: [Versus]
    }

    struct Gesto: Decodable, Sendable {
        let dx: Double, dy: Double, ms: Double
        let eje: String
        let umbral: Double
        let resultado: String?
    }

    struct TextoJS: Decodable, Sendable { let texto: String, plegado: String, unidadesJuntas: String, frase: String }
    struct Plural: Decodable, Sendable { let cuenta: Int, texto: String }
    struct Lista: Decodable, Sendable { let partes: [String], texto: String }

    struct Numeros: Decodable, Sendable {
        struct Decimal: Decodable, Sendable { let valor: Double, minimo: Int, maximo: Int, texto: String }
        struct Segundos: Decodable, Sendable { let ms: Double, texto: String }
        struct Velocidad: Decodable, Sendable { let kbs: Double?, texto: String }
        struct Trozo: Decodable, Sendable { let digit: Bool, text: String }
        struct Cifras: Decodable, Sendable { let texto: String, trozos: [Trozo] }
        let decimal: [Decimal]
        let segundos: [Segundos]
        let velocidad: [Velocidad]
        let cifras: [Cifras]
    }

    struct Fechas: Decodable, Sendable {
        struct Etiqueta: Decodable, Sendable { let primary: String, number: String, secondary: String, long: String }
        struct Dia: Decodable, Sendable { let dia: String, etiqueta: Etiqueta, mas1: String, menos30: String }
        struct CuandoJS: Decodable, Sendable { let time: String, relative: String }
        struct Instante: Decodable, Sendable {
            let iso: String
            let cuando: CuandoJS
            let horaMadrid: String?
            let fechaCorta: String?
            let emparejado: String
            let fechaYHora: String
            let horaAbierta: String
        }
        let dias: [Dia]
        let instantes: [Instante]
        let ahora: String
    }

    let color: Color
    let canal: [Canal]
    let equipos: Equipos
    let gestos: [Gesto]
    let texto: [TextoJS]
    let plural: [Plural]
    let listas: [Lista]
    let numeros: Numeros
    let fechas: Fechas

    static let lote: VectoresComunes = {
        do {
            return try JSONDecoder().decode(VectoresComunes.self, from: Vectores.datos("vectores-comunes"))
        } catch {
            fatalError("vectores-comunes.json ilegible: \(error)")
        }
    }()
}

/// Dos números iguales salvo el último bit de las librerías matemáticas (V8 frente a libm).
func casi(_ a: Double, _ b: Double, _ tolerancia: Double = 1e-9) -> Bool { abs(a - b) <= tolerancia }

func casi(_ a: Oklch?, _ b: VectoresComunes.OklchJS?) -> Bool {
    guard let a, let b else { return a == nil && b == nil }
    return casi(a.l, b.l) && casi(a.c, b.c) && casi(a.h, b.h, 1e-7)
}

func casi(_ a: RGB?, _ b: VectoresComunes.RGBJS?) -> Bool {
    guard let a, let b else { return a == nil && b == nil }
    return casi(a.r, b.r) && casi(a.g, b.g) && casi(a.b, b.b)
}
