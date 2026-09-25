#if DEBUG
    import Foundation

    /* Emparejar y dispositivos en la demo (a7 §13.5), port de features/devices/demo.ts y de la parte de
       api/demo/index.ts: código de 6 cifras con el azar sembrado, QR DE ADORNO (tiene la forma de uno pero no
       codifica nada: la vista lo rotula «QR de muestra (demo)»), lista, revocar y canjear el código 482913. */

    enum DispositivosDemo {
        /// El código de los ejemplos (fixtures/v1/pairingClaim.json): el único que canjea.
        static let codigoValido = "482913"
        /// La dirección simulada del Umbrel (la primera `u=`).
        static let direccion = "http://umbrel.local:7792"
        static let lado = 25
        static let margen = 2

        /// `demoQrSvg(code)`: marcas de esquina y ruido determinista a partir del código.
        static func qrSVG(_ codigo: String) -> String {
            var semilla: UInt32 = 2_166_136_261
            for escalar in codigo.unicodeScalars {
                semilla = (semilla ^ UInt32(String(escalar).utf16.first ?? 0)) &* 16_777_619
            }
            func azar() -> Double {
                semilla = semilla &* 1_664_525 &+ 1_013_904_223
                return Double(semilla) / 4_294_967_296
            }
            func marca(_ x: Int, _ y: Int) -> Bool {
                (x < 8 && y < 8) || (x >= lado - 8 && y < 8) || (x < 8 && y >= lado - 8)
            }
            var celdas: [String] = []
            for y in 0..<lado {
                for x in 0..<lado {
                    if marca(x, y) || azar() < 0.52 { continue }
                    celdas.append("M\(x + margen) \(y + margen)h1v1h-1z")
                }
            }
            for (fx, fy) in [(0, 0), (lado - 7, 0), (0, lado - 7)] {
                let x = fx + margen
                let y = fy + margen
                celdas.append("M\(x) \(y)h7v7h-7zM\(x + 1) \(y + 1)v5h5v-5z")
                celdas.append("M\(x + 2) \(y + 2)h3v3h-3z")
            }
            let total = lado + margen * 2
            return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 \(total) \(total)\" shape-rendering=\"crispEdges\">"
                + "<path fill=\"#ffffff\" d=\"M0 0h\(total)v\(total)H0z\"/>"
                + "<path fill=\"#000000\" fill-rule=\"evenodd\" d=\"\(celdas.joined())\"/></svg>"
        }

        /// Módulos oscuros del QR de adorno como rejilla (29 × 29) para dibujarlo nítido en la app.
        static func qrModulos(_ codigo: String) -> [[Bool]] {
            let total = lado + margen * 2
            var rejilla = Array(repeating: Array(repeating: false, count: total), count: total)
            var semilla: UInt32 = 2_166_136_261
            for escalar in codigo.unicodeScalars {
                semilla = (semilla ^ UInt32(String(escalar).utf16.first ?? 0)) &* 16_777_619
            }
            for y in 0..<lado {
                for x in 0..<lado {
                    let esMarca = (x < 8 && y < 8) || (x >= lado - 8 && y < 8) || (x < 8 && y >= lado - 8)
                    if esMarca { continue }
                    semilla = semilla &* 1_664_525 &+ 1_013_904_223
                    if Double(semilla) / 4_294_967_296 >= 0.52 { rejilla[y + margen][x + margen] = true }
                }
            }
            for (fx, fy) in [(0, 0), (lado - 7, 0), (0, lado - 7)] {
                for dy in 0..<7 {
                    for dx in 0..<7 {
                        let aro = dx == 0 || dy == 0 || dx == 6 || dy == 6
                        let centro = (2...4).contains(dx) && (2...4).contains(dy)
                        if aro || centro { rejilla[fy + margen + dy][fx + margen + dx] = true }
                    }
                }
            }
            return rejilla
        }

        /// `demoPairing(now)`: el código sale del azar sembrado (el `Math.random` de la web).
        static func crearCodigo(azar: Double, ahora: Double, direcciones: [String]) -> JSON {
            let numero = String(Int((azar * 1_000_000).rounded(.down)))
            let codigo = String(repeating: "0", count: max(0, 6 - numero.count)) + numero
            let ttl = 300_000.0
            let enlaces = direcciones.map { "u=" + codificar($0) }.joined(separator: "&")
            var o = JSON.objeto([])
            o["code"] = .texto(codigo)
            o["expiresAt"] = .texto(AgendaDemo.iso(ahora + ttl))
            o["ttlMs"] = .numero(ttl)
            o["pairUri"] = .texto("aceneo://pair?\(enlaces)&c=\(codigo)")
            o["qrSvg"] = .texto(qrSVG(codigo))
            return o
        }

        /// `encodeURIComponent`.
        static func codificar(_ texto: String) -> String {
            var permitidos = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)..<Unicode.Scalar(128)))
            permitidos.insert(charactersIn: "-_.!~*'()")
            return texto.addingPercentEncoding(withAllowedCharacters: permitidos) ?? texto
        }
    }
#endif
