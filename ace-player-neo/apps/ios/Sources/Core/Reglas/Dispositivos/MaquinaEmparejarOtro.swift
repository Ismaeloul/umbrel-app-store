import Foundation

/* El emparejamiento de OTRO aparato desde Ajustes › Dispositivos, como máquina de estados pequeña
   (devices/usePairing.ts; a6 §8.1, §8.10.4, §8.10.7):

     reposo ──crear──▶ creando ──▶ codigo ──(5 min)──▶ caducado
                          │          │  └─(aparece un dispositivo nuevo)─▶ emparejado
                          └─▶ fallo   └─cancelar─▶ reposo

   Puro: el modelo observable de la pantalla (ModeloEmparejarDispositivo) le pasa los hechos (la respuesta
   del servidor, la lista, el SSE y la hora) y pinta lo que diga. La cuenta atrás cuenta desde que llega la
   respuesta (`ttlMs`), no desde `expiresAt`: así no importa si los relojes del iPhone y del Umbrel difieren. */

enum FaseEmparejarOtro: Hashable, Sendable {
    case reposo
    case creando
    case codigo(CodigoVivo)
    case caducado
    case emparejado(dispositivo: String)
    case fallo(String)

    var id: String {
        switch self {
        case .reposo: "reposo"
        case .creando: "creando"
        case .codigo: "codigo"
        case .caducado: "caducado"
        case .emparejado: "emparejado"
        case .fallo: "fallo"
        }
    }
}

/// Un código a la vista.
struct CodigoVivo: Hashable, Sendable {
    var codigo: String
    var enlace: String
    var ttl: TimeInterval
    var limite: Date
    /// Los ids que había al crearlo (activos y revocados); `nil` si la lista aún no había llegado: entonces la
    /// primera lista que llegue es la referencia (si no, todos los de siempre parecerían nuevos).
    var conocidos: [String]?
}

struct MaquinaEmparejarOtro: Sendable {
    private(set) var fase: FaseEmparejarOtro = .reposo

    var hayCodigo: Bool {
        if case .codigo = fase { return true }
        return false
    }

    mutating func empezar() { fase = .creando }

    /// Llegó la respuesta de `POST pairing`.
    mutating func creado(_ r: PairingCreateResponse, ahora: Date, conocidos: [String]?) {
        let ttl = Double(r.ttlMs) / 1000
        fase = .codigo(CodigoVivo(codigo: r.code, enlace: r.pairUri, ttl: ttl, limite: ahora.addingTimeInterval(ttl),
                                  conocidos: conocidos))
    }

    mutating func fallar(_ motivo: String) { fase = .fallo(motivo) }

    mutating func cancelar() { fase = .reposo }

    /// Tic de la cuenta atrás (y al volver a la vista): pasado el plazo, caducado.
    mutating func tic(ahora: Date) {
        guard case .codigo(let vivo) = fase, ahora >= vivo.limite else { return }
        fase = .caducado
    }

    /// Llegó la lista (`devicesList`): el primer id que no estaba → emparejado.
    mutating func lista(_ ids: [String]) {
        guard case .codigo(var vivo) = fase else { return }
        guard let conocidos = vivo.conocidos else {
            vivo.conocidos = ids
            fase = .codigo(vivo)
            return
        }
        if let nuevo = ids.first(where: { !conocidos.contains($0) }) { fase = .emparejado(dispositivo: nuevo) }
    }

    /// SSE `devices.changed`: un `paired` de un id nuevo con código a la vista → emparejado.
    mutating func evento(_ e: DevicesChangedData) {
        guard case .codigo(let vivo) = fase, e.reason == .paired, !(vivo.conocidos ?? []).contains(e.deviceId) else { return }
        fase = .emparejado(dispositivo: e.deviceId)
    }

    /// Lo que le queda al código, en ms (0 sin código).
    func restante(ahora: Date) -> Double {
        guard case .codigo(let vivo) = fase else { return 0 }
        return max(0, vivo.limite.timeIntervalSince(ahora) * 1000)
    }

    /// Fracción de la barra fina (de lleno a vacío).
    func fraccion(ahora: Date) -> Double {
        guard case .codigo(let vivo) = fase, vivo.ttl > 0 else { return 0 }
        return restante(ahora: ahora) / (vivo.ttl * 1000)
    }

    /// Región que se anuncia (`announcement`, PairingPanel.tsx).
    func anuncio(nombre: String?) -> String {
        switch fase {
        case .codigo: return "Código listo. Caduca en 5 minutos."
        case .caducado: return "El código ha caducado."
        case .emparejado: return nombre.map { "«\($0)» ya está emparejado." } ?? "Dispositivo emparejado."
        default: return ""
        }
    }
}
