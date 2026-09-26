import Foundation

/* Lógica pura de Ajustes › Dispositivos (devices/model.ts; a6 §8, §8.10; a7 §11.11): textos de las
   filas, orden de la lista, código y cuenta atrás, «Este iPhone» y la nota de direcciones de la app
   (sustituye a la nota de origen de la web, textos adaptados de b-arquitectura §3.8). */

enum ModeloDispositivos {
    /// Segundo toque para revocar o para «Olvidar este iPhone» (`CONFIRM_REVOKE_MS`).
    static let plazoConfirmar: Duration = .seconds(5)
    /// Sondeo de respaldo con un código a la vista y sin SSE (`PAIRING_POLL_MS`).
    static let sondeo: Duration = .seconds(5)
    /// «Conectado ahora» por debajo de 2 min (`isOnlineNow`).
    static let enLinea: TimeInterval = 2 * 60

    /// `PLATFORM_LABEL`.
    static func plataforma(_ p: DevicePlatform) -> String {
        switch p {
        case .ios: "iPhone"
        case .ipados: "iPad"
        case .macos: "Mac"
        case .other, .desconocido: "Otro dispositivo"
        }
    }

    /// `PLATFORM_ICON`.
    static func icono(_ p: DevicePlatform) -> NombreIcono {
        switch p {
        case .ios, .ipados: .movil
        case .macos: .pantalla
        case .other, .desconocido: .link
        }
    }

    /// `isOnlineNow`.
    static func conectado(_ d: Device, ahora: Date) -> Bool {
        guard let visto = TiemposSalud.leer(d.lastSeenAt) else { return false }
        return ahora.timeIntervalSince(visto) < enLinea
    }

    /// `lastSeenText`: «Aún no se ha conectado», «Conectado ahora mismo», «Visto hace 5 min»…
    static func ultimaVez(_ d: Device, ahora: Date, calendario: Calendar = .current) -> String {
        guard let visto = d.lastSeenAt else { return "Aún no se ha conectado" }
        if conectado(d, ahora: ahora) { return "Conectado ahora mismo" }
        let cuando = TiemposSalud.cuando(visto, ahora: ahora, calendario: calendario)
        if cuando.relativo == "ayer" { return "Visto ayer, a las \(cuando.hora)" }
        if let primera = cuando.relativo.first, primera.isNumber {
            return "Visto el \(cuando.relativo), a las \(cuando.hora)"
        }
        return "Visto \(cuando.relativo)"
    }

    /// «Emparejado el 23 sept 2026» (`pairedText`).
    static func emparejado(_ d: Device, calendario: Calendar = .current) -> String {
        guard let fecha = TiemposSalud.leer(d.createdAt) else { return "Emparejado" }
        return "Emparejado el \(TiemposSalud.fechaLarga(fecha, calendario: calendario))"
    }

    /// «Revocado el 23 sept 2026» (`revokedText`).
    static func revocado(_ d: Device, calendario: Calendar = .current) -> String {
        guard let fecha = TiemposSalud.leer(d.revokedAt) else { return "" }
        return "Revocado el \(TiemposSalud.fechaLarga(fecha, calendario: calendario))"
    }

    /// Activos del último que se conectó al que menos (sin conexión, por fecha de emparejado); revocados
    /// aparte, del más reciente (`splitDevices`).
    static func partir(_ lista: [Device]) -> (activos: [Device], revocados: [Device]) {
        func visto(_ d: Device) -> Date { TiemposSalud.leer(d.lastSeenAt ?? d.createdAt) ?? .distantPast }
        func quitado(_ d: Device) -> Date { TiemposSalud.leer(d.revokedAt) ?? .distantPast }
        let activos = lista.enumerated().filter { $0.element.revokedAt == nil }
            .sorted { a, b in visto(a.element) != visto(b.element) ? visto(a.element) > visto(b.element) : a.offset < b.offset }
            .map(\.element)
        let revocados = lista.enumerated().filter { $0.element.revokedAt != nil }
            .sorted { a, b in quitado(a.element) != quitado(b.element) ? quitado(a.element) > quitado(b.element) : a.offset < b.offset }
            .map(\.element)
        return (activos, revocados)
    }

    /// La lista de «Emparejados» en la app: «Este iPhone» siempre la primera (a6 §8.10.2); si la lista aún no
    /// lo trae (carrera justo tras emparejar), va el del arranque.
    static func conEsteIPhone(_ activos: [Device], esteId: String?, delArranque: Device?) -> [Device] {
        guard let esteId else { return activos }
        if let propio = activos.first(where: { $0.id == esteId }) {
            return [propio] + activos.filter { $0.id != esteId }
        }
        if let delArranque, delArranque.id == esteId, delArranque.revokedAt == nil { return [delArranque] + activos }
        return activos
    }

    /// «Este iPhone» o, en iPad, «Este iPad».
    static func capsulaEste(_ d: Device) -> String { d.platform == .ipados ? "Este iPad" : "Este iPhone" }

    /// «482913» → «482 913» (`groupCode`).
    static func agrupar(_ codigo: String) -> String {
        guard codigo.count == 6 else { return codigo }
        return "\(codigo.prefix(3)) \(codigo.suffix(3))"
    }

    /// Cifra a cifra para VoiceOver: «4 8 2 9 1 3» (`spellCode`).
    static func deletrear(_ codigo: String) -> String { codigo.map(String.init).joined(separator: " ") }

    /// 299 000 ms → «4:59» (`countdown`).
    static func cuentaAtras(_ ms: Double) -> String {
        let total = max(0, Int((ms / 1000).rounded(.up)))
        return "\(total / 60):\(String(format: "%02d", total % 60))"
    }
}

// MARK: - Nota de direcciones (a6 §8.10.6, textos de b-arquitectura §3.8)

/// La nota bajo el panel de emparejar: qué direcciones lleva el QR que crea este iPhone.
struct NotaDirecciones: Hashable, Sendable {
    enum Tipo: Sendable { case ambas, soloTailscale, soloCasa, bucle }
    var tipo: Tipo
    /// Trozos del texto; los `true` van en negrita (las direcciones, en `strong` 650 `--text`).
    var trozos: [Trozo]

    struct Trozo: Hashable, Sendable {
        var texto: String
        var fuerte: Bool
    }

    var aviso: Bool { tipo == .bucle }
    var icono: NombreIcono {
        switch tipo {
        case .ambas, .soloTailscale: .check
        case .soloCasa: .info
        case .bucle: .aviso
        }
    }
    var texto: String { trozos.map(\.texto).joined() }

    /// El origen completo tal cual («http://umbrel.local:7792»).
    static func origen(_ url: URL) -> String {
        var texto = url.absoluteString
        while texto.hasSuffix("/") { texto.removeLast() }
        return texto
    }

    /// `localhost`, `127.x`, `::1` (y `*.localhost`), como `originKind` `local` de la web.
    static func esBucle(_ url: URL) -> Bool {
        let host = (url.host() ?? "").lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        return host == "localhost" || host == "::1" || host.hasPrefix("127.") || host.hasSuffix(".localhost")
    }

    static func de(_ config: ServerConfig) -> NotaDirecciones? {
        let casa = config.lan
        let tailscale = config.tailscale
        if let bucle = [casa, tailscale].compactMap({ $0 }).first(where: esBucle) {
            return NotaDirecciones(tipo: .bucle, trozos: [
                Trozo(texto: "La dirección ", fuerte: false),
                Trozo(texto: origen(bucle), fuerte: true),
                Trozo(texto: " solo existe en este aparato: otro iPhone no llegará. Crea el código desde la web del Umbrel (por ejemplo, ", fuerte: false),
                Trozo(texto: "http://umbrel.local:7792", fuerte: true),
                Trozo(texto: ").", fuerte: false),
            ])
        }
        switch (casa, tailscale) {
        case let (casa?, tailscale?):
            return NotaDirecciones(tipo: .ambas, trozos: [
                Trozo(texto: "El QR lleva las dos direcciones de tu Umbrel, ", fuerte: false),
                Trozo(texto: origen(casa), fuerte: true),
                Trozo(texto: " y ", fuerte: false),
                Trozo(texto: origen(tailscale), fuerte: true),
                Trozo(texto: ": el otro iPhone podrá conectarse en casa y fuera, con Tailscale activo.", fuerte: false),
            ])
        case let (nil, tailscale?):
            return NotaDirecciones(tipo: .soloTailscale, trozos: [
                Trozo(texto: "El QR lleva la dirección de Tailscale, ", fuerte: false),
                Trozo(texto: origen(tailscale), fuerte: true),
                Trozo(texto: ": el otro iPhone podrá conectarse en casa y fuera, con Tailscale activo.", fuerte: false),
            ])
        case let (casa?, nil):
            return NotaDirecciones(tipo: .soloCasa, trozos: [
                Trozo(texto: "El QR lleva la dirección de tu red de casa, ", fuerte: false),
                Trozo(texto: origen(casa), fuerte: true),
                Trozo(texto: ": fuera de ella no llegará. Para usarlo también fuera, crea el código desde la web abierta por Tailscale.", fuerte: false),
            ])
        case (nil, nil):
            return nil
        }
    }
}

// MARK: - Cuerpo del código (a6 §8.10.4, a9 §3.4)

enum CuerpoCodigo {
    /// `baseUrl` = origen de la dirección en uso; `alternateBaseUrls` = [la otra] si la hay y es distinta.
    static func de(activa: URL?, config: ServerConfig) -> PairingCreateBody {
        let otras = [config.lan, config.tailscale].compactMap { $0 }
        guard let base = activa ?? otras.first else { return PairingCreateBody() }
        let origenBase = NotaDirecciones.origen(base)
        let alternativa = otras.map(NotaDirecciones.origen).first { $0.lowercased() != origenBase.lowercased() }
        return PairingCreateBody(baseUrl: origenBase, alternateBaseUrls: alternativa.map { [$0] })
    }
}
