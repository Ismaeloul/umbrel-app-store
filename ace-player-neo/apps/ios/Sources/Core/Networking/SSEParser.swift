import Foundation

/// Un mensaje SSE ya montado.
public struct SSEMessage: Sendable, Hashable {
    /// Último `id:` recibido (el que hay que mandar en `Last-Event-ID`).
    public var id: String?
    /// `event:`; `message` si no venía.
    public var event: String
    /// Las líneas `data:` unidas con `\n`.
    public var data: String
    /// `retry:` en milisegundos, si el servidor lo ha pedido.
    public var retry: Int?
}

/// Lector de `text/event-stream` según la especificación de HTML
/// (https://html.spec.whatwg.org/multipage/server-sent-events.html).
///
/// Va byte a byte a propósito: `URLSession.AsyncBytes.lines` se come las
/// líneas vacías, que son justo las que separan un evento del siguiente.
/// Admite `\n`, `\r\n` y `\r`, comentarios (`: ping` del latido), `data:`
/// en varias líneas, BOM inicial y tramas partidas en cualquier punto.
public struct SSEParser: Sendable {
    public private(set) var lastEventId: String?
    public private(set) var retryMs: Int?

    private var linea: [UInt8] = []
    private var tipo = ""
    private var datos = ""
    private var tieneDatos = false
    private var ultimoFueCR = false
    private var primeraLinea = true

    public init(lastEventId: String? = nil) {
        self.lastEventId = lastEventId
    }

    /// Añade un byte; devuelve un mensaje si con él se completa uno.
    public mutating func feed(_ byte: UInt8) -> SSEMessage? {
        if ultimoFueCR {
            ultimoFueCR = false
            if byte == 0x0A { return nil }
        }
        switch byte {
        case 0x0A:
            return finDeLinea()
        case 0x0D:
            ultimoFueCR = true
            return finDeLinea()
        default:
            linea.append(byte)
            return nil
        }
    }

    /// Añade un trozo; devuelve los mensajes que se completen.
    public mutating func feed<S: Sequence>(_ bytes: S) -> [SSEMessage] where S.Element == UInt8 {
        var mensajes: [SSEMessage] = []
        for byte in bytes {
            if let mensaje = feed(byte) { mensajes.append(mensaje) }
        }
        return mensajes
    }

    /// Añade texto (para las pruebas).
    public mutating func feed(_ texto: String) -> [SSEMessage] {
        feed(Array(texto.utf8))
    }

    private mutating func finDeLinea() -> SSEMessage? {
        var texto = String(decoding: linea, as: UTF8.self)
        linea.removeAll(keepingCapacity: true)
        if primeraLinea {
            primeraLinea = false
            if texto.hasPrefix("\u{FEFF}") { texto.removeFirst() }
        }
        if texto.isEmpty { return despachar() }
        if texto.hasPrefix(":") { return nil }

        let campo: Substring
        var valor: Substring
        if let dosPuntos = texto.firstIndex(of: ":") {
            campo = texto[..<dosPuntos]
            valor = texto[texto.index(after: dosPuntos)...]
            if valor.hasPrefix(" ") { valor = valor.dropFirst() }
        } else {
            campo = texto[...]
            valor = ""
        }

        switch campo {
        case "event":
            tipo = String(valor)
        case "data":
            if tieneDatos { datos += "\n" }
            datos += valor
            tieneDatos = true
        case "id":
            if !valor.contains("\u{0}") { lastEventId = String(valor) }
        case "retry":
            if !valor.isEmpty, valor.allSatisfy({ $0.isASCII && $0.isNumber }), let ms = Int(valor) {
                retryMs = ms
            }
        default:
            break
        }
        return nil
    }

    private mutating func despachar() -> SSEMessage? {
        defer {
            tipo = ""
            datos = ""
            tieneDatos = false
        }
        guard tieneDatos else { return nil }
        return SSEMessage(id: lastEventId, event: tipo.isEmpty ? "message" : tipo, data: datos, retry: retryMs)
    }
}
