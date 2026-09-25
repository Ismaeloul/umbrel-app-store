import Foundation
import Testing

@testable import AceNeo

/* El notify() de la web (Armazon/Avisos.swift; b-arquitectura §2.4.4; a2 §8; notices/notify.ts). M4. */

@MainActor
struct AvisosTests {
    @Test func fueraDelTeatroTodoEsToast() {
        let avisos = Avisos()
        #expect(avisos.avisar("Hash copiado", tono: .ok) == .toast)
        #expect(avisos.avisar("Fuente 2 sin señal", clase: .senal, tono: .warn) == .toast)
        #expect(avisos.cola.toasts.count == 2)
        #expect(avisos.linea.mensaje == nil)
    }

    @Test func senalViendoElTeatroVaALaLinea() {
        let avisos = Avisos()
        avisos.viendoTeatro = true
        let destino = avisos.avisar("Fuente 2 sin señal", clase: .senal, tono: .warn, senal: .fail, dato: "demo")
        #expect(destino == .linea)
        #expect(avisos.cola.toasts.isEmpty)
        #expect(avisos.linea.mensaje?.contenido.texto == "Fuente 2 sin señal")
        #expect(avisos.linea.mensaje?.contenido.senal == .fail)
        #expect(avisos.linea.mensaje?.contenido.dato == "demo")
    }

    @Test func conAccionSiempreToastAunqueSeaSenal() {
        let avisos = Avisos()
        avisos.viendoTeatro = true
        let destino = avisos.avisar(
            "Cambiado a la fuente 3", clase: .senal, accion: AccionAviso(titulo: "Deshacer") {})
        #expect(destino == .toast)
        #expect(avisos.cola.toasts.first?.tituloAccion == "Deshacer")
    }

    @Test func laAccionCierraYEjecuta() {
        let avisos = Avisos()
        var hecho = 0
        avisos.avisar("Reproducción detenida", accion: AccionAviso(titulo: "Deshacer") { hecho += 1 }, duracion: 6)
        let id = avisos.cola.toasts[0].id
        avisos.ejecutarAccion(id)
        #expect(hecho == 1)
        #expect(avisos.cola.toasts.first?.saliendo == true)
        avisos.ejecutarAccion(id)  // ya sin acción: no se repite
        #expect(hecho == 1)
    }

    @Test func repetidoSumaVeces() {
        let avisos = Avisos()
        avisos.avisar("Hash copiado", tono: .ok)
        avisos.avisar("Hash copiado", tono: .ok)
        #expect(avisos.cola.toasts.count == 1)
        #expect(avisos.cola.toasts[0].repeticiones == 2)
    }

    @Test func saleAlAcabarSuTiempoYSeQuita() async {
        let avisos = Avisos()
        avisos.avisar("Hash copiado", tono: .ok, duracion: 0.05)
        try? await Task.sleep(for: .milliseconds(150))
        #expect(avisos.cola.toasts.first?.saliendo == true)
        try? await Task.sleep(for: .milliseconds(450))  // + 320 ms de salida
        #expect(avisos.cola.toasts.isEmpty)
    }

    @Test func alTerceroElMasViejoEmpiezaASalir() {
        let avisos = Avisos()
        avisos.avisar("Uno")
        avisos.avisar("Dos")
        avisos.avisar("Tres")
        let vivos = avisos.cola.toasts.filter { !$0.saliendo }.map(\.texto)
        #expect(vivos == ["Dos", "Tres"])
    }

    @Test func laLineaSeVaYQuedaLaBase() async {
        let avisos = Avisos()
        avisos.viendoTeatro = true
        let base = ContenidoLinea(texto: "Fuente 1 verificada. Vas en directo.", tono: .ok, dato: "6 s de retraso")
        avisos.fijarBase(base)
        avisos.avisar("Buscando otra fuente…", clase: .senal, duracion: 0.05)
        try? await Task.sleep(for: .milliseconds(500))
        #expect(avisos.linea.mensaje == nil)
        #expect(avisos.linea.base == base)
        avisos.vaciarLinea()
        #expect(avisos.linea.mensaje == nil)
    }
}
