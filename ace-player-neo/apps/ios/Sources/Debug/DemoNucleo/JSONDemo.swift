#if DEBUG
    import Foundation

    /* Valor JSON con el orden de las claves, para que la demo de la app maneje los MISMOS objetos que la
       demo de la web (api/demo/index.ts los clona y los muta como objetos de JavaScript) y los escriba como
       `JSON.stringify` (b-arquitectura §3.3, M2). Sin `JSONSerialization`: en Linux confunde `true` con `1`
       y no guarda el orden. Puro [L]: también lo usan `DemoGoldenTests` para comparar con la web. */

    enum JSON: Hashable, Sendable {
        case nulo
        case bool(Bool)
        case numero(Double)
        case texto(String)
        case lista([JSON])
        case objeto([Campo])

        struct Campo: Hashable, Sendable {
            var clave: String
            var valor: JSON
        }

        // MARK: Construir

        /// Un objeto a partir de pares en orden (`nil` → `null`).
        static func obj(_ pares: KeyValuePairs<String, JSON>) -> JSON {
            .objeto(pares.map { Campo(clave: $0.key, valor: $0.value) })
        }

        static func txt(_ valor: String?) -> JSON { valor.map(JSON.texto) ?? .nulo }
        static func num(_ valor: Double?) -> JSON { valor.map(JSON.numero) ?? .nulo }
        static func num(_ valor: Int) -> JSON { .numero(Double(valor)) }

        // MARK: Leer

        subscript(clave: String) -> JSON? {
            get {
                guard case .objeto(let campos) = self else { return nil }
                return campos.first { $0.clave == clave }?.valor
            }
            set {
                guard case .objeto(var campos) = self else { return }
                if let indice = campos.firstIndex(where: { $0.clave == clave }) {
                    if let newValue { campos[indice].valor = newValue } else { campos.remove(at: indice) }
                } else if let newValue {
                    campos.append(Campo(clave: clave, valor: newValue))
                }
                self = .objeto(campos)
            }
        }

        var texto: String? { if case .texto(let t) = self { t } else { nil } }
        var numero: Double? { if case .numero(let n) = self { n } else { nil } }
        var bool: Bool? { if case .bool(let b) = self { b } else { nil } }
        var lista: [JSON]? { if case .lista(let l) = self { l } else { nil } }
        var esNulo: Bool { self == .nulo }

        /// Las claves de un objeto, en orden.
        var claves: [String] { if case .objeto(let c) = self { c.map(\.clave) } else { [] } }

        /// `{...a, ...b}`: las claves de `b` pisan las de `a` (conservando la posición de `a`).
        func mezclado(con otro: JSON) -> JSON {
            guard case .objeto(let nuevos) = otro else { return self }
            var salida = self
            for campo in nuevos { salida[campo.clave] = campo.valor }
            return salida
        }

        // MARK: Escribir (como JSON.stringify)

        var cadena: String {
            var salida = ""
            escribir(&salida)
            return salida
        }

        var datos: Data { Data(cadena.utf8) }

        private func escribir(_ salida: inout String) {
            switch self {
            case .nulo: salida += "null"
            case .bool(let b): salida += b ? "true" : "false"
            case .numero(let n): salida += JSON.numeroJS(n)
            case .texto(let t): JSON.escribirTexto(t, &salida)
            case .lista(let elementos):
                salida += "["
                for (i, e) in elementos.enumerated() {
                    if i > 0 { salida += "," }
                    e.escribir(&salida)
                }
                salida += "]"
            case .objeto(let campos):
                salida += "{"
                for (i, c) in campos.enumerated() {
                    if i > 0 { salida += "," }
                    JSON.escribirTexto(c.clave, &salida)
                    salida += ":"
                    c.valor.escribir(&salida)
                }
                salida += "}"
            }
        }

        /// Número como lo escribe JavaScript: enteros sin decimales, el resto con el decimal más corto.
        static func numeroJS(_ n: Double) -> String {
            guard n.isFinite else { return "null" }
            if n == n.rounded(), abs(n) < 1e21 {
                if abs(n) < 9.007_199_254_740_992e15 { return String(Int64(n)) }
            }
            var texto = "\(n)"
            if texto.hasSuffix(".0") { texto.removeLast(2) }
            if let e = texto.firstIndex(of: "e") {
                let mantisa = texto[..<e]
                var exponente = String(texto[texto.index(after: e)...])
                let signo = exponente.hasPrefix("-") ? "-" : "+"
                exponente = String(exponente.drop(while: { $0 == "-" || $0 == "+" || $0 == "0" }))
                texto = mantisa + "e" + signo + (exponente.isEmpty ? "0" : exponente)
            }
            return texto
        }

        private static func escribirTexto(_ texto: String, _ salida: inout String) {
            salida += "\""
            for escalar in texto.unicodeScalars {
                switch escalar {
                case "\"": salida += "\\\""
                case "\\": salida += "\\\\"
                case "\n": salida += "\\n"
                case "\r": salida += "\\r"
                case "\t": salida += "\\t"
                case "\u{08}": salida += "\\b"
                case "\u{0C}": salida += "\\f"
                default:
                    if escalar.value < 0x20 {
                        let hex = String(escalar.value, radix: 16)
                        salida += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                    } else {
                        salida.unicodeScalars.append(escalar)
                    }
                }
            }
            salida += "\""
        }

        // MARK: Leer texto JSON

        enum FalloLectura: Error { case invalido(Int) }

        static func leer(_ datos: Data) throws -> JSON {
            var lector = Lector(bytes: Array(datos))
            let valor = try lector.valor()
            lector.espacios()
            guard lector.fin else { throw FalloLectura.invalido(lector.i) }
            return valor
        }

        static func leer(_ texto: String) throws -> JSON { try leer(Data(texto.utf8)) }

        private struct Lector {
            let bytes: [UInt8]
            var i = 0
            var fin: Bool { i >= bytes.count }

            mutating func espacios() {
                while i < bytes.count, [0x20, 0x0A, 0x0D, 0x09].contains(bytes[i]) { i += 1 }
            }

            mutating func valor() throws -> JSON {
                espacios()
                guard i < bytes.count else { throw FalloLectura.invalido(i) }
                switch bytes[i] {
                case UInt8(ascii: "{"): return try objeto()
                case UInt8(ascii: "["): return try lista()
                case UInt8(ascii: "\""): return .texto(try cadena())
                case UInt8(ascii: "t"): return try palabra("true", .bool(true))
                case UInt8(ascii: "f"): return try palabra("false", .bool(false))
                case UInt8(ascii: "n"): return try palabra("null", .nulo)
                default: return try numero()
                }
            }

            mutating func palabra(_ p: String, _ v: JSON) throws -> JSON {
                let u = Array(p.utf8)
                guard i + u.count <= bytes.count, Array(bytes[i..<(i + u.count)]) == u else { throw FalloLectura.invalido(i) }
                i += u.count
                return v
            }

            mutating func numero() throws -> JSON {
                let inicio = i
                while i < bytes.count, "+-0123456789.eE".utf8.contains(bytes[i]) { i += 1 }
                guard let texto = String(bytes: bytes[inicio..<i], encoding: .utf8), let n = Double(texto) else {
                    throw FalloLectura.invalido(inicio)
                }
                return .numero(n)
            }

            mutating func cadena() throws -> String {
                i += 1
                var unidades: [UInt16] = []
                var trozo: [UInt8] = []
                func volcar() {
                    unidades += Array(String(decoding: trozo, as: UTF8.self).utf16)
                    trozo.removeAll()
                }
                while i < bytes.count {
                    let b = bytes[i]
                    if b == UInt8(ascii: "\"") {
                        volcar()
                        i += 1
                        return String(decoding: unidades, as: UTF16.self)
                    }
                    if b == UInt8(ascii: "\\") {
                        volcar()
                        i += 1
                        guard i < bytes.count else { break }
                        let e = bytes[i]
                        switch e {
                        case UInt8(ascii: "n"): unidades.append(0x0A)
                        case UInt8(ascii: "r"): unidades.append(0x0D)
                        case UInt8(ascii: "t"): unidades.append(0x09)
                        case UInt8(ascii: "b"): unidades.append(0x08)
                        case UInt8(ascii: "f"): unidades.append(0x0C)
                        case UInt8(ascii: "u"):
                            guard i + 4 < bytes.count, let h = String(bytes: bytes[(i + 1)...(i + 4)], encoding: .utf8),
                                let u = UInt16(h, radix: 16)
                            else { throw FalloLectura.invalido(i) }
                            unidades.append(u)
                            i += 4
                        default: unidades.append(UInt16(e))
                        }
                        i += 1
                        continue
                    }
                    trozo.append(b)
                    i += 1
                }
                throw FalloLectura.invalido(i)
            }

            mutating func lista() throws -> JSON {
                i += 1
                var elementos: [JSON] = []
                espacios()
                if i < bytes.count, bytes[i] == UInt8(ascii: "]") {
                    i += 1
                    return .lista([])
                }
                while true {
                    elementos.append(try valor())
                    espacios()
                    guard i < bytes.count else { throw FalloLectura.invalido(i) }
                    if bytes[i] == UInt8(ascii: ",") {
                        i += 1
                        continue
                    }
                    if bytes[i] == UInt8(ascii: "]") {
                        i += 1
                        return .lista(elementos)
                    }
                    throw FalloLectura.invalido(i)
                }
            }

            mutating func objeto() throws -> JSON {
                i += 1
                var campos: [Campo] = []
                espacios()
                if i < bytes.count, bytes[i] == UInt8(ascii: "}") {
                    i += 1
                    return .objeto([])
                }
                while true {
                    espacios()
                    guard i < bytes.count, bytes[i] == UInt8(ascii: "\"") else { throw FalloLectura.invalido(i) }
                    let clave = try cadena()
                    espacios()
                    guard i < bytes.count, bytes[i] == UInt8(ascii: ":") else { throw FalloLectura.invalido(i) }
                    i += 1
                    let v = try valor()
                    if let indice = campos.firstIndex(where: { $0.clave == clave }) {
                        campos[indice].valor = v
                    } else {
                        campos.append(Campo(clave: clave, valor: v))
                    }
                    espacios()
                    guard i < bytes.count else { throw FalloLectura.invalido(i) }
                    if bytes[i] == UInt8(ascii: ",") {
                        i += 1
                        continue
                    }
                    if bytes[i] == UInt8(ascii: "}") {
                        i += 1
                        return .objeto(campos)
                    }
                    throw FalloLectura.invalido(i)
                }
            }
        }
    }

    extension JSON {
        /// Igualdad «de datos» (sin mirar el orden de las claves): la que usan las pruebas contra la web.
        func igualEnDatos(_ otro: JSON) -> Bool {
            switch (self, otro) {
            case (.objeto(let a), .objeto(let b)):
                guard a.count == b.count else { return false }
                return a.allSatisfy { campo in otro[campo.clave].map { campo.valor.igualEnDatos($0) } ?? false }
            case (.lista(let a), .lista(let b)):
                return a.count == b.count && zip(a, b).allSatisfy { $0.igualEnDatos($1) }
            case (.numero(let a), .numero(let b)):
                return a == b || abs(a - b) <= 1e-9 * max(1, abs(a))
            default:
                return self == otro
            }
        }
    }
#endif
