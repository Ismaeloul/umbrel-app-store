import Foundation

/* Menú de una fila de «Emparejados» (a6 §8.9 y §8.10.2; DevicesSection.tsx `DeviceRow`): un solo
   elemento rojo con el icono `x`. Elegirlo equivale a un toque en el botón de la fila (arma o ejecuta). */

enum OpcionesDispositivo {
    /// «Opciones de {nombre}» (título del menú y de las acciones de VoiceOver).
    static func titulo(_ nombre: String) -> String { "Opciones de \(nombre)" }

    /// Fila de otro aparato: «Revocar el acceso» o, con el botón ya armado, «Revocar ya».
    static func revocar(armado: Bool) -> [OpcionMenu] {
        [OpcionMenu(id: "revocar", titulo: armado ? "Revocar ya" : "Revocar el acceso", icono: .x, peligro: true)]
    }

    /// Fila de este iPhone: «Olvidar este iPhone» o, armado, «Olvidar ya».
    static func olvidar(armado: Bool) -> [OpcionMenu] {
        [OpcionMenu(id: "olvidar", titulo: armado ? "Olvidar ya" : "Olvidar este iPhone", icono: .x, peligro: true)]
    }

    /// Botón de la fila de otro aparato.
    static func botonRevocar(armado: Bool) -> String { armado ? "¿Revocar? Pulsa otra vez" : "Revocar" }

    /// Nombre accesible del botón de otro aparato.
    static func etiquetaRevocar(_ nombre: String, armado: Bool) -> String {
        armado ? "¿Revocar? Pulsa otra vez para revocar \(nombre)" : "Revocar \(nombre)"
    }

    /// Botón de la fila de este iPhone.
    static func botonOlvidar(armado: Bool) -> String { armado ? "¿Olvidar? Pulsa otra vez" : "Olvidar este iPhone" }

    /// Nombre accesible del botón de este iPhone.
    static func etiquetaOlvidar(armado: Bool) -> String {
        armado ? "¿Olvidar? Pulsa otra vez para olvidar este iPhone" : "Olvidar este iPhone"
    }

    /// Línea bajo el botón armado de este iPhone (a6 §8.10.3).
    static let avisoOlvidar =
        "Este iPhone dejará de poder entrar. Para volver, emparéjalo otra vez desde la web u otro iPhone."

    /// Toasts (a6 §14).
    static func revocadoBien(_ nombre: String) -> String {
        "«\(nombre)» ya no puede entrar. Si lo quieres de vuelta, emparéjalo otra vez."
    }

    static func revocadoMal(_ nombre: String, motivo: String) -> String { "No se pudo revocar «\(nombre)». \(motivo)" }

    static func olvidadoMal(motivo: String) -> String { "No se pudo olvidar este iPhone. \(motivo)" }

    static func emparejadoOtro(_ nombre: String) -> String { "«\(nombre)» se ha emparejado" }
}
