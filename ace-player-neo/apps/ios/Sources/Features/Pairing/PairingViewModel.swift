import Foundation
import Observation

/// Pantalla de emparejamiento: direcciones del servidor y código de 6 dígitos
/// (tecleado o leído del QR `aceneo://pair?u=…&c=…`).
@MainActor
@Observable
final class PairingViewModel {
    enum Estado: Equatable {
        case editando
        case enviando
        case error(String)
    }

    var direccionTailscale = ""
    var direccionLAN = ""
    private var codigoLimpio = ""
    /// Solo cifras y como mucho 6 (el teclado numérico admite pegar cualquier cosa).
    var codigo: String {
        get { codigoLimpio }
        set { codigoLimpio = String(newValue.filter { $0.isASCII && $0.isNumber }.prefix(6)) }
    }
    private(set) var estado: Estado = .editando
    var mostrandoEscaner = false

    private let servicio: PairingService

    init(servicio: PairingService, configuracionGuardada: ServerConfig) {
        self.servicio = servicio
        direccionTailscale = configuracionGuardada.tailscale?.absoluteString ?? ""
        direccionLAN = configuracionGuardada.lan?.absoluteString ?? ""
    }

    var puedeEnviar: Bool {
        estado != .enviando && PairingLink.codigoValido(codigo)
            && !(direccionTailscale.trimmingCharacters(in: .whitespaces).isEmpty
                && direccionLAN.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var mensajeError: String? {
        if case .error(let mensaje) = estado { return mensaje }
        return nil
    }

    /// Rellena desde un enlace del QR. La dirección va a su hueco según sea de
    /// Tailscale o de la red local.
    func aplicar(_ enlace: PairingLink) {
        switch ServerVia.clasificar(enlace.servidor) {
        case .tailscale: direccionTailscale = enlace.servidor.absoluteString
        case .lan: direccionLAN = enlace.servidor.absoluteString
        }
        codigo = enlace.codigo
        estado = .editando
    }

    /// Texto leído por el escáner: solo vale un enlace de emparejamiento.
    func leido(_ texto: String) -> Bool {
        guard let enlace = PairingLink(texto: texto) else {
            estado = .error("Ese código QR no es de Ace Player Neo. Ábrelo desde Ajustes → Emparejar iPhone en la web.")
            return false
        }
        aplicar(enlace)
        return true
    }

    /// Envía el código. Devuelve true si ha quedado emparejada.
    func emparejar(nombreDispositivo: String) async -> Bool {
        var config = ServerConfig()
        for (texto, via) in [(direccionTailscale, ServerVia.tailscale), (direccionLAN, ServerVia.lan)] {
            guard !texto.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
            guard let url = ServerConfig.normalizar(texto) else {
                estado = .error("La dirección de \(via.etiqueta) no es válida. Ejemplo: http://umbrel.local:7792")
                return false
            }
            switch via {
            case .tailscale: config.tailscale = url
            case .lan: config.lan = url
            }
        }
        estado = .enviando
        do {
            try await servicio.emparejar(config: config, codigo: codigo, nombre: nombreDispositivo)
            estado = .editando
            codigo = ""
            return true
        } catch let error as APIError {
            estado = .error(error.mensaje)
            return false
        } catch {
            estado = .error((error as? LocalizedError)?.errorDescription ?? APIError.desde(error).mensaje)
            return false
        }
    }
}
