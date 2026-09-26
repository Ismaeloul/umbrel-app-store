import Foundation
import Testing

@testable import AceNeo

/* La raíz emparejar ↔ app (App/Raiz.swift; b-arquitectura §2.3; a2 §22.6, §23.3, §27.2). M4. Con movimiento
   reducido (120 ms) para que las pruebas duren poco; el paso a la app espera además los 600 ms de a2 §22.6. */

@MainActor
struct RaizTests {
    @Test func faseInicial() {
        let enApp = Raiz(faseInicial: .app)
        #expect(enApp.armazonMontado && !enApp.emparejarMontado && enApp.app)
        let sinEmparejar = Raiz(faseInicial: .emparejar(.llaveroIlegible))
        #expect(!sinEmparejar.armazonMontado && sinEmparejar.emparejarMontado && !sinEmparejar.app)
        #expect(sinEmparejar.motivo == .llaveroIlegible)
    }

    @Test func entrarEnLaAppMontaAntesYAvisa() async {
        let raiz = Raiz(faseInicial: .emparejar(nil))
        let avisos = Avisos()
        raiz.conectar(avisos: avisos, haptica: Haptica(), hojas: CentroHojas())
        let paso = Task { await raiz.entrarEnLaApp(host: "umbrel.local", reducido: true) }
        try? await Task.sleep(for: .milliseconds(100))
        // Durante la pausa: el armazón ya está montado debajo y emparejar sigue arriba.
        #expect(raiz.armazonMontado && raiz.emparejarMontado && !raiz.app)
        await paso.value
        #expect(raiz.app && raiz.armazonMontado && !raiz.emparejarMontado)
        #expect(raiz.motivo == nil)
        #expect(avisos.cola.toasts.first?.texto == "Emparejado con umbrel.local")
        #expect(avisos.cola.toasts.first?.tono == .ok)
    }

    @Test func volverAEmparejarConMotivo() async {
        let raiz = Raiz(faseInicial: .app)
        let haptica = Haptica()
        let hojas = CentroHojas()
        hojas.abrir(.ayuda)
        raiz.conectar(avisos: Avisos(), haptica: haptica, hojas: hojas)
        await raiz.volverAEmparejar(motivo: .revocadoDesdeOtro, reducido: true)
        #expect(!raiz.app && !raiz.armazonMontado && raiz.emparejarMontado)
        #expect(raiz.motivo == .revocadoDesdeOtro)
        #expect(hojas.actual == nil)  // a2 §23.3: cierra hojas
        #expect(haptica.pulso.n == 1 && haptica.pulso.tipo == .aviso)
    }

    @Test func olvidarEsteIPhoneSinAvisoNiHaptica() async {
        let raiz = Raiz(faseInicial: .app)
        let haptica = Haptica()
        raiz.conectar(avisos: Avisos(), haptica: haptica, hojas: CentroHojas())
        await raiz.volverAEmparejar(motivo: .olvidadoAqui, reducido: true)
        #expect(raiz.emparejarMontado && !raiz.app)
        #expect(haptica.pulso.n == 0)
    }

    @Test func elPrimerMotivoSeQueda() async {
        let raiz = Raiz(faseInicial: .app)
        raiz.conectar(avisos: Avisos(), haptica: Haptica(), hojas: CentroHojas())
        await raiz.volverAEmparejar(motivo: .noAutorizado, reducido: true)
        await raiz.volverAEmparejar(motivo: .dispositivoRetirado, reducido: true)
        #expect(raiz.motivo == .noAutorizado)
    }

    @Test func entrarDosVecesNoRepite() async {
        let raiz = Raiz(faseInicial: .app)
        let avisos = Avisos()
        raiz.conectar(avisos: avisos, haptica: Haptica(), hojas: CentroHojas())
        await raiz.entrarEnLaApp(host: "umbrel.local", reducido: true)
        #expect(avisos.cola.toasts.isEmpty)  // ya estaba en la app
    }
}
