import Foundation

/* Listas (directorios) guardadas de Ajustes › Listas (directories/model.ts; a6 §3, a7 §11.7). Los mensajes
   de error salen del catálogo común (`ErrorCatalog`), salvo el motivo corto de la tarjeta. */

enum ModeloListas {
    /// La lista por defecto de la 0.6.59 (`DEFAULT_SYNC_URL`).
    static let porDefecto =
        "https://ipfs.io/ipns/k51qzi5uqu5di462t7j4vu4akwfhvtjhy88qbupktvoacqfqe9uforjvhyi4wr/hashes_acestream.m3u"
    /// Como mucho 8 listas (`MAX_WEB_SOURCES`).
    static let maximo = 8
    /// Segundo toque para borrar (`CONFIRM_DELETE_MS`).
    static let plazoBorrar: Duration = .seconds(5)

    static let nota =
        "Hasta 8 listas públicas; cada una conserva sus canales y se actualiza sola cada 3 h. Las direcciones de tu red local están bloqueadas por seguridad."
    static let mensajeDemo = "En modo demo no hay backend: esta acción funcionará en el Umbrel."
    static let errorGenerico = "No se pudo importar esa URL. La lista anterior no se ha modificado."
    static let pistaPrivada =
        "Parece una dirección de tu red local: por seguridad el servidor las bloquea salvo que se hayan permitido al instalar."

    /// Motivo corto del último fallo (`syncFailureReason`).
    static func motivo(_ codigo: String?) -> String {
        let valor = codigo ?? ""
        if valor == "http_429" { return "el servidor limita las descargas (429)" }
        if valor.hasPrefix("http_"), let n = Int(valor.dropFirst(5)) { return "el servidor respondió \(n)" }
        switch valor {
        case "fetch_timeout": return "el servidor no respondió a tiempo"
        case "empty_directory": return "la lista llegó vacía"
        case "dns_failed": return "no se resolvió el dominio"
        case "ipfs_not_found": return "la lista ya no está en esa dirección de IPFS"
        default: return valor.hasPrefix("ipfs_") ? "la red IPFS no entregó la lista" : "no se pudo descargar la lista"
        }
    }

    /// Mensaje de un fallo al guardar, actualizar o borrar (`directoryErrorMessage`).
    static func mensajeError(_ error: APIError?) -> String {
        guard let error else { return errorGenerico }
        switch error {
        case .servidor(let codigo, _, _, _):
            if codigo == "demo_unsupported" { return mensajeDemo }
            if codigo != "internal_error", let definicion = ErrorCatalog.describir(codigo) { return definicion.message }
            return errorGenerico
        case .formato:
            return errorGenerico
        default:
            return error.mensaje  // del cliente (red, plazo, sin servidor…): ya dice qué pasa
        }
    }

    /// «23 sept, 20:30» o «sin sincronizar» (`sourceDate`).
    static func fecha(_ iso: String?, calendario: Calendar = .current) -> String {
        guard let fecha = TiemposSalud.leer(iso) else { return "sin sincronizar" }
        return TiemposSalud.fechaConHora(fecha, calendario: calendario)
    }

    /// Línea de la tarjeta (`sourceMeta`).
    static func meta(_ s: WebSourceSummary, calendario: Calendar = .current) -> String {
        let tipo = s.type.rawValue.isEmpty ? "M3U" : s.type.rawValue.uppercased()
        let cabeza = "\(tipo) · \(s.count) \(s.count == 1 ? "canal" : "canales")"
        if s.lastErrorAt != nil {
            return "\(cabeza) · \(motivo(s.lastError)) · se conserva la copia de \(fecha(s.syncedAt, calendario: calendario))"
        }
        return "\(cabeza) · \(fecha(s.syncedAt, calendario: calendario))"
    }

    /// ¿Parece de la red local? Solo es una pista: no bloquea el botón (`looksPrivateUrl`).
    static func pareceLocal(_ valor: String) -> Bool {
        guard let partes = URLComponents(string: valor.trimmingCharacters(in: .whitespacesAndNewlines)),
            let bruto = partes.host, !bruto.isEmpty
        else { return false }
        let host = bruto.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host == "localhost" || host.hasSuffix(".local") || host.hasSuffix(".lan") { return true }
        if host == "::1" || host.hasPrefix("fe80:") || esUnicaLocal(host) { return true }
        guard let o = IPv4.octetos(host) else { return !host.contains(".") && !host.contains(":") }
        let a = o[0]
        let b = o[1]
        return a == 10 || a == 127 || a == 0 || (a == 169 && b == 254) || (a == 172 && (16...31).contains(b))
            || (a == 192 && b == 168) || (a == 100 && (64...127).contains(b))
    }

    /// `^f[cd][0-9a-f]{2}:`
    private static func esUnicaLocal(_ host: String) -> Bool {
        let c = Array(host)
        guard c.count >= 5, c[0] == "f", c[1] == "c" || c[1] == "d", c[4] == ":" else { return false }
        return c[2].isHexDigit && c[3].isHexDigit
    }

    /// ¿Empieza por http:// o https://? (`isHttpUrl`).
    static func esHttp(_ valor: String) -> Bool {
        guard let partes = URLComponents(string: valor.trimmingCharacters(in: .whitespacesAndNewlines)),
            let esquema = partes.scheme?.lowercased(), let host = partes.host, !host.isEmpty
        else { return false }
        return esquema == "http" || esquema == "https"
    }

    /// Nota de la línea de estado tras guardar (`«{activa}»: N canales…`).
    static func hecho(_ vista: DirectoryView) -> String {
        let activa = vista.webSources.first { $0.id == vista.activeWebSourceId }?.name ?? "Lista"
        return "«\(activa)»: \(vista.web.count) canales. Actualización automática cada 3 h."
    }
}

/* Resumen de gustos de Ajustes › Tu fútbol (`preferenceSummary` de SettingsView.tsx, copiado a propósito
   en la web para no arrastrar el modelo de preferencias: a6 §4). Va aquí porque Ajustes es de M7. */
enum ResumenGustos {
    static func frase(_ p: Preferences?) -> String {
        var partes: [String] = []
        let ligas = p?.leagues.count ?? 0
        let equipos = p?.teams.count ?? 0
        let nacionalidades = p?.nationalities.count ?? 0
        if ligas > 0 { partes.append(TiemposSalud.plural(ligas, "liga", "ligas")) }
        if equipos > 0 { partes.append(TiemposSalud.plural(equipos, "equipo", "equipos")) }
        if nacionalidades > 0 { partes.append(TiemposSalud.plural(nacionalidades, "nacionalidad", "nacionalidades")) }
        guard !partes.isEmpty else { return "Personaliza la agenda con tus ligas, equipos y nacionalidades." }
        return "Tu agenda prioriza \(unir(partes))."
    }

    /// `Intl.ListFormat` es-ES conjunción: «a», «a y b», «a, b y c».
    static func unir(_ partes: [String]) -> String {
        guard partes.count > 1, let ultima = partes.last else { return partes.first ?? "" }
        return partes.dropLast().joined(separator: ", ") + " y " + ultima
    }
}
