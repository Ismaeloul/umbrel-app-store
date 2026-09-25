import Foundation

/* Claves de guardado de la app y migración desde la 0.8.0 (b-arquitectura §2.3, I0→M4; a1 §13.10).
   Puro [L]: compila también en Linux (Package.swift). Son las claves de la web (lib/storage.ts), con los
   mismos valores. Lo que no es de interfaz (servidores.v1, el visor y el token del Llavero) conserva sus
   claves de siempre: si cambiaran, el iPhone tendría que volver a emparejarse. */

enum Claves {
    static let tema = "aceneo-tema", transparencia = "aceneo-transparencia", modo = "aceneo-pb"
    static let gustosPrimerUso = "aceneo-primer-uso"
    /// Entero: versión del esquema de claves (a1 §13.10).
    static let migracion = "aceneo-migracion"
}

enum MigracionClaves {
    /// Claves de la 0.8.0 (a8 §3.9.5 y §3.8.6).
    static let viejaTema = "es.ismaeloul.aceplayerneo.apariencia"
    static let viejaModo = "es.ismaeloul.aceplayerneo.modo"
    static let viejaTarjetaCerrada = "es.ismaeloul.aceplayerneo.agenda.tarjetaCerrada"

    /// Una vez por instalación: claves de la 0.8.0 → las de la web. Idempotente. Solo copia si la clave
    /// nueva no existe y el valor es válido (uno raro se ignora y queda el de por defecto).
    static func ejecutar(_ defaults: UserDefaults) {
        guard defaults.integer(forKey: Claves.migracion) < 1 else { return }
        copiar(viejaTema, a: Claves.tema, validos: ["sistema", "claro", "oscuro"], en: defaults)
        copiar(viejaModo, a: Claves.modo, validos: ["low", "balanced", "stable"], en: defaults)
        defaults.removeObject(forKey: viejaTema)
        defaults.removeObject(forKey: viejaModo)
        defaults.removeObject(forKey: viejaTarjetaCerrada)  // pantalla que desaparece
        defaults.set(1, forKey: Claves.migracion)
    }

    private static func copiar(_ vieja: String, a nueva: String, validos: Set<String>, en defaults: UserDefaults) {
        guard defaults.object(forKey: nueva) == nil, let valor = defaults.string(forKey: vieja),
            validos.contains(valor)
        else { return }
        defaults.set(valor, forKey: nueva)
    }
}
