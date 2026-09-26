import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* notices/toasts.ts y notices/statusLine.ts: los casos de notices.test.tsx (los relojes los lleva `Avisos`
   de M4; aquí se prueba la cola y la línea que ese reloj mueve) y la regla de wording.test.ts. */

struct ColaToastsTests {
    private func visibles(_ cola: ColaToasts) -> [String] { cola.toasts.filter { !$0.saliendo }.map(\.texto) }

    @Test func tiemposDeLaWeb() {
        #expect(ColaToasts.duracion == 2.8 && ColaToasts.maximo == 2 && ColaToasts.salida == 0.32)
        #expect(ColaToasts.duracionDeshacer == 6)
    }

    @Test func dura28YSaleConFundido() {
        var cola = ColaToasts()
        let puesto = cola.poner("Hash copiado", tono: .ok, icono: nil, tituloAccion: nil)
        #expect(visibles(cola) == ["Hash copiado"] && puesto.salen.isEmpty)
        cola.empezarSalida(puesto.id)  // pasados 2,8 s
        #expect(cola.toasts.first?.saliendo == true && cola.visibles.isEmpty)
        cola.quitar(puesto.id)  // pasados 320 ms más
        #expect(cola.toasts.isEmpty)
    }

    @Test func nuncaMasDeDosElMasViejoCede() {
        var cola = ColaToasts()
        let uno = cola.poner("Uno", tono: .info, icono: nil, tituloAccion: nil)
        _ = cola.poner("Dos", tono: .info, icono: nil, tituloAccion: nil)
        let tres = cola.poner("Tres", tono: .info, icono: nil, tituloAccion: nil)
        #expect(visibles(cola) == ["Dos", "Tres"])
        #expect(tres.salen == [uno.id])
    }

    @Test func repetidoNoSeApila() {
        var cola = ColaToasts()
        let a = cola.poner("Hash copiado", tono: .ok, icono: nil, tituloAccion: nil)
        let b = cola.poner("Hash copiado", tono: .ok, icono: nil, tituloAccion: "Deshacer")
        #expect(a.id == b.id && cola.toasts.count == 1)
        #expect(cola.toasts[0].repeticiones == 2 && cola.toasts[0].tituloAccion == "Deshacer")
        #expect(ColaToasts.contador(cola.toasts[0]) == "×2")
        // Otro tono no es el mismo aviso.
        _ = cola.poner("Hash copiado", tono: .warn, icono: nil, tituloAccion: nil)
        #expect(cola.toasts.count == 2)
    }

    @Test func unoQueSaleNoSeRenueva() {
        var cola = ColaToasts()
        let a = cola.poner("Guardado", tono: .ok, icono: nil, tituloAccion: nil)
        cola.empezarSalida(a.id)
        let b = cola.poner("Guardado", tono: .ok, icono: nil, tituloAccion: nil)
        #expect(a.id != b.id && cola.toasts.count == 2 && visibles(cola) == ["Guardado"])
    }

    @Test func iconoPorTono() {
        func icono(_ tono: TonoAviso) -> NombreIcono {
            ColaToasts.icono(Toast(id: 1, clave: "", texto: "", tono: tono, icono: nil, tituloAccion: nil, repeticiones: 1, saliendo: false))
        }
        #expect([TonoAviso.ok, .info, .warn, .err].map(icono) == [.check, .info, .aviso, .aviso])
        let propio = Toast(id: 9, clave: "", texto: "", tono: .ok, icono: .stop, tituloAccion: nil, repeticiones: 1, saliendo: false)
        #expect(ColaToasts.icono(propio) == .stop)
    }
}

struct LineaEstadoTests {
    @Test func unaCosaALaVezYVuelveLaBase() {
        var linea = LineaEstado()
        let base = ContenidoLinea(texto: "Fuente 1 verificada. Vas en directo.", senal: .ok, dato: "6 s de retraso")
        linea.fijarBase(base)
        _ = linea.mostrar(ContenidoLinea(texto: "Reconectando…", tono: .warn))
        let id = linea.mostrar(ContenidoLinea(texto: "Fuente 2 floja", tono: .warn))
        #expect(linea.mensaje?.contenido.texto == "Fuente 2 floja")
        linea.empezarSalida()  // 4,5 s
        #expect(linea.mensaje?.saliendo == true)
        linea.quitar(id)  // + 320 ms
        #expect(linea.mensaje == nil)
        #expect(linea.visible == base)
    }

    @Test func repetidoSumaPorN() {
        var linea = LineaEstado()
        let a = linea.mostrar(ContenidoLinea(texto: "Rellenando el búfer", tono: .warn))
        let b = linea.mostrar(ContenidoLinea(texto: "Rellenando el búfer", tono: .warn, dato: "otro dato"))
        #expect(a == b && linea.mensaje?.repeticiones == 2 && linea.contador == "×2")
        #expect(linea.mensaje?.contenido.dato == nil, "el repetido conserva el primero, como showStatus")
    }

    @Test func quitarUnoViejoNoBorraElNuevo() {
        var linea = LineaEstado()
        let viejo = linea.mostrar(ContenidoLinea(texto: "Uno"))
        linea.empezarSalida()
        _ = linea.mostrar(ContenidoLinea(texto: "Dos"))
        linea.quitar(viejo)
        #expect(linea.mensaje?.contenido.texto == "Dos")
    }

    @Test func vaciarLoQuitaTodo() {
        var linea = LineaEstado()
        linea.fijarBase(ContenidoLinea(texto: "Vas en directo.", tono: .ok))
        _ = linea.mostrar(ContenidoLinea(texto: "Probando la fuente 2"))
        #expect(linea.visible?.texto == "Probando la fuente 2")
        linea.vaciar()
        #expect(linea.mensaje == nil && linea.base == nil && linea.visible == nil)
    }

    @Test func destinoComoNotify() {
        #expect(LineaEstado.destino(clase: .senal, conAccion: false, viendoTeatro: true) == .linea)
        #expect(LineaEstado.destino(clase: .senal, conAccion: false, viendoTeatro: false) == .toast)
        #expect(LineaEstado.destino(clase: .accion, conAccion: false, viendoTeatro: true) == .toast)
        #expect(LineaEstado.destino(clase: .senal, conAccion: true, viendoTeatro: true) == .toast)
    }
}

struct RedaccionTests {
    @Test func laJergaDeWordingTest() {
        #expect(Redaccion.tieneJerga("Rellenando el búfer"))
        #expect(Redaccion.tieneJerga("El BUFFER se vació"))
        #expect(Redaccion.tieneJerga("infohash copiado"))
        #expect(Redaccion.tieneJerga("error de hls.js"))
        #expect(Redaccion.tieneJerga("mpegts falló"))
        #expect(!Redaccion.tieneJerga("Hash copiado"))
        #expect(!Redaccion.tieneJerga("buffering"), "\\b: «buffering» no es «buffer»")
        #expect(!Redaccion.tieneJerga("stashed"))
        #expect(!Redaccion.tieneJerga("Fuente apartada; el segundo motor ya la está comprobando"))
    }

    /// Los mensajes del catálogo de errores del servidor que la app enseña tal cual (a7 §12.6).
    @Test func catalogoDeErroresSinJerga() {
        let textos = ErrorCatalog.entries.values.filter(\.isPublic).map(\.message)
        for texto in textos { #expect(Redaccion.valido(texto), "«\(texto)» habla de \(Redaccion.palabrasDeJerga(texto))") }
        #expect(textos.count > 20)
    }
}
