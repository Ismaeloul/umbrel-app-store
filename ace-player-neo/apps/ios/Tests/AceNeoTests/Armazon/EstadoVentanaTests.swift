import Foundation
import Testing
import UIKit

@testable import AceNeo

/* Lo que la ventana pide al sistema (App/EstadoVentana.swift, App/PreferenciasLocales.swift,
   Armazon/EstadosGlobales.swift; b-arquitectura §2.3; a2 §14, §23.1; a3 §4.7, pregunta A-3). M4. */

@MainActor
struct EstadoVentanaTests {
    @Test func barraDeEstadoPorZona() {
        let ventana = EstadoVentana()
        #expect(ventana.estiloBarraEstado == .default)  // por tema en el resto (A-3)
        ventana.heroeBajoBarra = true
        #expect(ventana.estiloBarraEstado == .lightContent)  // blanca sobre el héroe
        ventana.heroeBajoBarra = false
        ventana.fondoOscuroArriba = true
        #expect(ventana.estiloBarraEstado == .lightContent)  // franja negra del teatro, cámara de emparejar
    }

    @Test func inmersivoOcultaLaBarraDeEstado() {
        let ventana = EstadoVentana()
        #expect(!ventana.barraEstadoOculta)
        ventana.inmersivo = true
        #expect(ventana.barraEstadoOculta)
    }

    @Test func orientacionesDeLaApp() {
        let ventana = EstadoVentana()
        #expect(ventana.mascaraOrientacion == ControlOrientacion.todas)  // decisión A: vertical y las dos horizontales
    }

    @Test func temaDeLaVentana() {
        let suite = "aceneo-pruebas-tema"
        let defaults = UserDefaults(suiteName: suite) ?? .standard
        defaults.removePersistentDomain(forName: suite)
        let preferencias = PreferenciasLocales(defaults)
        #expect(preferencias.tema == .sistema)
        #expect(preferencias.estiloVentana == .unspecified)
        preferencias.cambiarTema(.oscuro)
        #expect(preferencias.estiloVentana == .dark)
        #expect(defaults.string(forKey: Claves.tema) == "oscuro")
        preferencias.cambiarTema(.claro)
        #expect(preferencias.estiloVentana == .light)
        preferencias.cambiarTransparencia(true)
        #expect(defaults.string(forKey: Claves.transparencia) == "reducida")
        #expect(PreferenciasLocales(defaults).tema == .claro)  // se recuerda
    }

    @Test func indicadorDelMotorComoSummarizeEngine() {
        #expect(EstadosGlobales.estadoMotor(.online, fallo: false) == .enLinea)
        #expect(EstadosGlobales.estadoMotor(.restarting, fallo: false) == .arrancando)
        #expect(EstadosGlobales.estadoMotor(.offline, fallo: false) == .apagado)
        #expect(EstadosGlobales.estadoMotor(.unknown, fallo: false) == .comprobando)
        #expect(EstadosGlobales.estadoMotor(nil, fallo: false) == .comprobando)
        #expect(EstadosGlobales.estadoMotor(.online, fallo: true) == .sinRespuesta)
        #expect(EstadosGlobales.estadoMotor(nil, fallo: true) == .sinRespuesta)
    }

    @Test func textosDeArranqueDeLaWeb() {
        // api/boot.ts
        #expect(EstadosGlobales.textoDemo == "Modo demo: sin backend, canales de muestra cargados")
        #expect(EstadosGlobales.textoSinBackend == "Backend no disponible; la app seguirá reintentando")
    }
}
