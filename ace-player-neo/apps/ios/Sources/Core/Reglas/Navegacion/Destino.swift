import Foundation

/* Navegación (b-arquitectura §2.1.1, contrato I0→M4). Las rutas de la web (`?vista=`, a2 §2.1 y
   apps/web/src/app/routes.ts) como tipos puros: la pestaña, la capa del teatro y el sentido de la
   transición salen de aquí. Cambiar una firma es un cambio de contrato (§5.1). */

enum Pestana: String, CaseIterable, Identifiable, Sendable {
    case agenda
    case canales = "biblioteca"  // en la web la ruta se llama «biblioteca»; en pantalla, «Canales» (routes.ts › VISTA_TITLE)
    case buscar
    case ajustes

    var id: String { rawValue }

    /// Orden en la barra (routes.ts › NAV_VISTAS).
    var indice: Int {
        switch self {
        case .agenda: 0
        case .canales: 1
        case .buscar: 2
        case .ajustes: 3
        }
    }

    var titulo: String {  // routes.ts › VISTA_TITLE
        switch self {
        case .agenda: "Agenda"
        case .canales: "Canales"
        case .buscar: "Buscar"
        case .ajustes: "Ajustes"
        }
    }

    var icono: NombreIcono {  // app/Nav.tsx
        switch self {
        case .agenda: .agenda
        case .canales: .biblioteca
        case .buscar: .buscar
        case .ajustes: .ajustes
        }
    }
}

/// Pestañas de Canales (a5 §3.4).
enum PestanaCanales: String, CaseIterable, Sendable { case favoritos, recientes, listas }

/// Chips de Ajustes (a6 §2.4). Sin «Servidor» (A-1).
enum SeccionAjustes: String, CaseIterable, Sendable {
    case listas, futbol, reproduccion, donde, apariencia, dispositivos, salud, motor, acerca
}

/// Una ruta de la web (`?vista=`, a2 §2.1). La pestaña y la capa del teatro salen de aquí.
enum Destino: Hashable, Sendable {
    case agenda
    case canales(PestanaCanales?)
    case buscar(q: String?)
    case ajustes(SeccionAjustes?)
    case partido(id: String)
    case canal(hash: String)
    case sistema

    /// Orden para el sentido de la transición (a2 §2.2, routes.ts › routeDepth): pestañas 0-3, teatro 10,
    /// sistema 11.
    var profundidad: Int {
        switch self {
        case .agenda: 0
        case .canales: 1
        case .buscar: 2
        case .ajustes: 3
        case .partido, .canal: 10
        case .sistema: 11
        }
    }

    var pestana: Pestana? {
        switch self {
        case .agenda: .agenda
        case .canales: .canales
        case .buscar: .buscar
        case .ajustes: .ajustes
        case .partido, .canal, .sistema: nil
        }
    }

    var esTeatro: Bool {
        switch self {
        case .partido, .canal: true
        default: false
        }
    }

    /// El valor de `?vista=` (capturas, -AceNeoEscena y pruebas).
    var vista: String {
        switch self {
        case .agenda: "agenda"
        case .canales(let p): p.map { "biblioteca/\($0.rawValue)" } ?? "biblioteca"
        case .buscar(let q): q.map { "buscar/\($0)" } ?? "buscar"
        case .ajustes(let s): s.map { "ajustes/\($0.rawValue)" } ?? "ajustes"
        case .partido(let id): "partido/\(id)"
        case .canal(let hash): "partido/canal/\(hash)"
        case .sistema: "sistema"
        }
    }

    /// Inverso de `vista`, con las reglas de `parseVista` (routes.ts): sin espacios ni barras en los
    /// extremos, la cabeza sin distinguir mayúsculas, vacío = agenda. «partido/canal/<hash>» se mira ANTES
    /// que «partido/<id>». Donde la web cae en la agenda por no entender la ruta, aquí devuelve `nil`
    /// (quien llama decide; la web usaría `.agenda`). Lo que la web no lee (la pestaña de Canales, la
    /// búsqueda) es de la app: un valor desconocido se queda en `nil` dentro del caso.
    init?(vista: String) {
        let limpia = Destino.recortar(vista)
        guard !limpia.isEmpty else {
            self = .agenda
            return
        }
        let partes = limpia.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let resto = Array(partes.dropFirst())
        switch partes[0].lowercased() {
        case "agenda": self = .agenda
        case "biblioteca": self = .canales(resto.first.flatMap(PestanaCanales.init(rawValue:)))
        case "buscar":
            let q = resto.joined(separator: "/")
            self = .buscar(q: q.isEmpty ? nil : q)
        case "ajustes": self = .ajustes(resto.first.flatMap(SeccionAjustes.init(rawValue:)))
        case "partido":
            guard let destino = Destino.teatro(resto) else { return nil }
            self = destino
        case "sistema": self = .sistema
        default: return nil
        }
    }

    /// `trim()` y fuera las barras de los extremos (routes.ts › parseVista).
    private static func recortar(_ texto: String) -> String {
        var s = Substring(texto.trimmingCharacters(in: .whitespacesAndNewlines))
        while s.first == "/" { s = s.dropFirst() }
        while s.last == "/" { s = s.dropLast() }
        return String(s)
    }

    /// `partido/canal/<hash40>` (HASH_RE, en minúsculas) o `partido/<id>` (SEGMENT_RE).
    private static func teatro(_ resto: [String]) -> Destino? {
        if resto.first == "canal" {
            let hash = resto.count > 1 ? resto[1] : ""
            return esHash(hash) ? .canal(hash: hash.lowercased()) : nil
        }
        let id = resto.joined(separator: "/")
        return esSegmento(id) ? .partido(id: id) : nil
    }

    /// HASH_RE = /^[a-fA-F0-9]{40}$/ (routes.ts).
    private static func esHash(_ texto: String) -> Bool {
        texto.utf8.count == 40 && texto.utf8.allSatisfy(esHex)
    }

    private static func esHex(_ c: UInt8) -> Bool {
        (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)  // 0-9 A-F a-f
    }

    /// SEGMENT_RE = /^[A-Za-z0-9._~:-]{1,120}$/ (routes.ts).
    private static func esSegmento(_ texto: String) -> Bool {
        let n = texto.utf8.count
        return n >= 1 && n <= 120 && texto.utf8.allSatisfy(esDeSegmento)
    }

    private static func esDeSegmento(_ c: UInt8) -> Bool {
        let letraOCifra = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
        return letraOCifra || c == 46 || c == 95 || c == 126 || c == 58 || c == 45  // . _ ~ : -
    }
}

/// Sentido de la transición (a2 §2.2): adelante si la profundidad nueva es ≥ la actual.
enum Sentido: Sendable {
    case adelante, atras

    static func entre(_ desde: Destino, _ hasta: Destino) -> Sentido {
        hasta.profundidad >= desde.profundidad ? .adelante : .atras
    }
}
