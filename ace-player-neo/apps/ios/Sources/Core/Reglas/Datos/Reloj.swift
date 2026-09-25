import Foundation

/* El tiempo de la app (b-arquitectura §2.1.4, contrato I0→M1). Único fichero de Core/Reglas que puede
   leer la hora del sistema (regla R14 del linter): todo lo demás recibe un `Reloj` o un `ahora:`. */

protocol Reloj: Sendable { var ahora: Date { get } }

struct RelojSistema: Reloj { var ahora: Date { Date() } }

/// Reloj que empieza en `inicio` y avanza con el de verdad (-AceNeoReloj, demo y capturas).
struct RelojDesplazado: Reloj {
    let inicio: Date
    let arranque: Date
    init(inicio: Date, arranque: Date = Date()) { self.inicio = inicio; self.arranque = arranque }
    var ahora: Date { inicio.addingTimeInterval(Date().timeIntervalSince(arranque)) }
}
