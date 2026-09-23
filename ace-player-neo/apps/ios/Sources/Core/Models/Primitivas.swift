import Foundation

/* Piezas comunes de los modelos Codable.

   Los modelos reflejan a mano los esquemas zod de packages/shared (decisión
   de arquitectura §10.3): son pequeños, no necesitan dependencias y los tests
   decodifican y vuelven a codificar TODOS los ejemplos de
   packages/shared/fixtures, así que si un contrato cambia sin tocar Swift, la
   CI de iOS falla. Los nombres de tipos y campos son los del esquema, para
   que buscar uno en el otro sea inmediato.

   Convenciones:
   - Fechas ISO (`2026-09-23T18:30:00.000Z`) como `String`, con `fecha` para
     convertirlas; así nunca falla una decodificación por el formato.
   - Milisegundos epoch enteros como `Int64`; `z.number()` sin `.int()` como
     `Double`.
   - Enumeraciones tolerantes: un valor que la app aún no conoce se decodifica
     como `.desconocido` en vez de romper toda la respuesta. */

/// Enumeración de texto que no rompe la decodificación con valores nuevos.
public protocol EnumTolerante: RawRepresentable, Codable, Sendable, Hashable
where RawValue == String {
    /// Caso para cualquier valor que la app todavía no conoce.
    static var desconocido: Self { get }
}

extension EnumTolerante {
    public init(from decoder: any Decoder) throws {
        let contenedor = try decoder.singleValueContainer()
        let valor = try contenedor.decode(String.self)
        self = Self(rawValue: valor) ?? .desconocido
    }

    public func encode(to encoder: any Encoder) throws {
        var contenedor = encoder.singleValueContainer()
        try contenedor.encode(rawValue)
    }
}

/// Fechas ISO 8601 del servidor, con o sin milisegundos.
public enum FechaISO {
    public static func parse(_ texto: String) -> Date? {
        if let fecha = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(texto) {
            return fecha
        }
        return try? Date.ISO8601FormatStyle().parse(texto)
    }

    public static func texto(_ fecha: Date) -> String {
        fecha.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }
}

extension Date {
    /// Fecha desde milisegundos epoch (los `serverTime`, `start` y `at` del servidor).
    public init(epochMs: Int64) {
        self.init(timeIntervalSince1970: TimeInterval(epochMs) / 1000)
    }
}

/// Respuesta vacía (por si una ruta contesta 204 sin cuerpo).
public struct SinContenido: Codable, Sendable, Equatable {
    public init() {}
}

// --- Enumeraciones de primitives.ts ---

/// `OriginSchema`: por dónde entró la petición.
public enum Origin: String, EnumTolerante {
    case web, native
    case desconocido
}

/// `ClientKindSchema`: tipo de cliente de un visor.
public enum ClientKind: String, EnumTolerante {
    case web, ios, legacy
    case desconocido
}
