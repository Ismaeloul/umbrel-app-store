import Foundation

/* URLs absolutas de lo que sirve el propio servidor (M5): escudos y logos (`/api/v1/football/…`, con el
   prefijo `/native`, como la URL del vídeo) y el origen para «Copiar URL del stream (VLC)». La base es la
   dirección guardada al emparejar (casa o Tailscale). Solo lee: el contenedor es de I0. */

@MainActor
enum RecursosServidor {
    /// La dirección del servidor emparejado (la primera candidata: casa, si no Tailscale). Se lee una vez por
    /// segundo como mucho: cada escudo y cada logo la piden al pintarse y leerla decodifica JSON.
    static var base: URL? {
        let ahora = ProcessInfo.processInfo.systemUptime  // monótono; solo mide el segundo de la memoria
        if let memoria, memoria.hasta > ahora { return memoria.base }
        let leida = ContenedorApp.actual?.entorno.configuracion.leer().candidatas.first?.url
        memoria = (ahora + 1, leida)
        return leida
    }

    private static var memoria: (hasta: TimeInterval, base: URL?)?

    /// `/api/v1/football/teams/…/crest?v=…` → `https://…/native/api/v1/football/teams/…/crest?v=…`.
    static func imagen(_ relativa: String?) -> URL? {
        guard let relativa, relativa.hasPrefix("/"), !relativa.hasPrefix("//"), let base else { return nil }
        return URL(string: "/native" + relativa, relativeTo: base)?.absoluteURL
    }

    /// El origen (`scheme://host:puerto`) para la URL del stream.
    static var origen: String {
        guard let base, let esquema = base.scheme, let host = base.host() else { return "" }
        let puerto = base.port.map { ":\($0)" } ?? ""
        return "\(esquema)://\(host)\(puerto)"
    }
}
