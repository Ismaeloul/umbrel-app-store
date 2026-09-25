import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Tipos comunes de §2.1.3: señal, avisos, háptica y opciones de menú. Escrito en la fase 0.3a (I0); M2
   lo amplía con ColaToasts, LineaEstado, SitiosHapticos y Redaccion. */

struct TiposComunesTests {
    @Test func palabrasDeLaSenalComoSignalBadge() {
        #expect(EstadoSenal.allCases.map(\.rawValue) == ["ok", "weak", "fail", "checking", "pending"])
        let palabras = EstadoSenal.allCases.map(\.palabra)
        #expect(palabras == ["Verificada", "Floja", "Sin señal", "Comprobando", "Pendiente"])
    }

    @Test func tonosComoNotices() {
        #expect([TonoAviso.ok, .info, .warn, .err].map(\.rawValue) == ["ok", "info", "warn", "err"])
        let linea = ContenidoLinea(texto: "Buscando señal")
        #expect(linea.tono == .info && linea.senal == nil && linea.icono == nil && linea.dato == nil)
        let toast = Toast(id: 1, clave: "ok|Guardado", texto: "Guardado", tono: .ok, icono: .check,
                          tituloAccion: nil, repeticiones: 1, saliendo: false)
        #expect(toast.id == 1 && toast.icono == .check)
    }

    @Test func opcionDeMenuPorDefecto() {
        let opcion = OpcionMenu(id: "copiar", titulo: "Copiar enlace", icono: .copy)
        #expect(!opcion.peligro && !opcion.marcada && !opcion.deshabilitada && !opcion.separadaAntes)
        #expect(opcion.haptica == nil)
    }
}

/// lib/haptics.ts: anti-ráfaga de 40 ms por sensación y «selección» callada con movimiento reducido.
struct ReglaHapticaTests {
    @Test func ochoSensaciones() {
        #expect(TipoHaptico.allCases.count == 8)
    }

    @Test func primeraVezSuenaSiempre() {
        for tipo in TipoHaptico.allCases where tipo != .seleccion {
            #expect(ReglaHaptica.suena(tipo, ahoraMs: 0, ultimo: nil, reducirMovimiento: true))
        }
        #expect(ReglaHaptica.suena(.seleccion, ahoraMs: 0, ultimo: nil, reducirMovimiento: false))
    }

    @Test func seleccionCallaConMovimientoReducido() {
        #expect(!ReglaHaptica.suena(.seleccion, ahoraMs: 1000, ultimo: nil, reducirMovimiento: true))
    }

    @Test func antiRafaga() {
        let ultimo = (tipo: TipoHaptico.ligera, ms: 1000.0)
        #expect(!ReglaHaptica.suena(.ligera, ahoraMs: 1039, ultimo: ultimo, reducirMovimiento: false))
        #expect(ReglaHaptica.suena(.ligera, ahoraMs: 1040, ultimo: ultimo, reducirMovimiento: false))
        #expect(ReglaHaptica.suena(.media, ahoraMs: 1001, ultimo: ultimo, reducirMovimiento: false), "Otra sensación sí suena")
    }
}
