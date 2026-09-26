import Foundation
import Testing

@testable import AceNeo

/* «Emparejar de nuevo» de la hoja de otro servidor (M7; a2 §22.8): `SesionApp.desemparejar()` borra token y
   direcciones, vuelve a emparejar sin aviso y avisa para que se pare la reproducción. Sin red. */

@MainActor
struct DesemparejarTests {
    @Test func borraTokenYDireccionesYVuelveAEmparejarSinAviso() async throws {
        let (entorno, almacen, tokens) = PruebaDatos.entorno()
        let sesion = SesionApp(entorno: entorno)
        #expect(sesion.fase == .app)
        let registro = RegistroMotivos()
        sesion.alPerderAcceso = { (motivo: MotivoEmparejar) in registro.motivos.append(motivo) }
        await sesion.desemparejar()
        #expect(sesion.fase == .emparejar(.olvidadoAqui))
        #expect(try tokens.leerToken() == nil)
        #expect(almacen.leer().vacia)
        #expect(await entorno.servidores.configuracion().vacia)
        #expect(registro.motivos == [.olvidadoAqui])
        await sesion.desemparejar()
        #expect(registro.motivos.count == 1, "ya en emparejar no hace nada")
    }

    @Test func accesoPerdidoConservaLasDirecciones() async {
        let (entorno, almacen, _) = PruebaDatos.entorno()
        let sesion = SesionApp(entorno: entorno)
        await sesion.accesoPerdido(.revocadoDesdeOtro)
        #expect(sesion.fase == .emparejar(.revocadoDesdeOtro))
        #expect(!almacen.leer().vacia)
    }
}

/// Los motivos que la sesión pasa a `alPerderAcceso`.
@MainActor private final class RegistroMotivos {
    var motivos: [MotivoEmparejar] = []
}
