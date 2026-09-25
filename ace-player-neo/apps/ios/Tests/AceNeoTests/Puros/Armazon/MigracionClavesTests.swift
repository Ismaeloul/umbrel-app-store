import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Migración de las claves de la 0.8.0 a las de la web (App/MigracionClaves.swift; a1 §13.10). M4. Cada prueba usa
   su propio dominio de UserDefaults y lo borra al acabar. */

private func dominio(_ nombre: String) -> UserDefaults {
    let suite = "aceneo-pruebas-migracion-\(nombre)"
    let defaults = UserDefaults(suiteName: suite) ?? .standard
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

struct MigracionClavesTests {
    @Test func copiaLasViejasYLasBorra() {
        let d = dominio("copia")
        d.set("oscuro", forKey: MigracionClaves.viejaTema)
        d.set("stable", forKey: MigracionClaves.viejaModo)
        d.set(true, forKey: MigracionClaves.viejaTarjetaCerrada)
        MigracionClaves.ejecutar(d)
        #expect(d.string(forKey: Claves.tema) == "oscuro")
        #expect(d.string(forKey: Claves.modo) == "stable")
        #expect(d.object(forKey: MigracionClaves.viejaTema) == nil)
        #expect(d.object(forKey: MigracionClaves.viejaModo) == nil)
        #expect(d.object(forKey: MigracionClaves.viejaTarjetaCerrada) == nil)
        #expect(d.integer(forKey: Claves.migracion) == 1)
    }

    @Test func noPisaLaNuevaSiYaExiste() {
        let d = dominio("nopisa")
        d.set("claro", forKey: Claves.tema)
        d.set("oscuro", forKey: MigracionClaves.viejaTema)
        MigracionClaves.ejecutar(d)
        #expect(d.string(forKey: Claves.tema) == "claro")
        #expect(d.object(forKey: MigracionClaves.viejaTema) == nil)
    }

    @Test func valorRaroSeIgnora() {
        let d = dominio("raro")
        d.set("sepia", forKey: MigracionClaves.viejaTema)
        d.set("turbo", forKey: MigracionClaves.viejaModo)
        MigracionClaves.ejecutar(d)
        #expect(d.object(forKey: Claves.tema) == nil)  // queda el de por defecto: «sistema»
        #expect(d.object(forKey: Claves.modo) == nil)  // y «balanced»
    }

    @Test func segundaVezNoHaceNada() {
        let d = dominio("dosveces")
        MigracionClaves.ejecutar(d)
        d.set("oscuro", forKey: MigracionClaves.viejaTema)  // una clave vieja que apareciera después
        MigracionClaves.ejecutar(d)
        #expect(d.object(forKey: Claves.tema) == nil)
        #expect(d.string(forKey: MigracionClaves.viejaTema) == "oscuro")
    }

    @Test func clavesDeLaWeb() {
        // lib/storage.ts: los mismos nombres que la web.
        #expect(Claves.tema == "aceneo-tema")
        #expect(Claves.transparencia == "aceneo-transparencia")
        #expect(Claves.modo == "aceneo-pb")
    }
}
