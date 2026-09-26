import Foundation
import Testing

@testable import AceNeo

/* Textos del escenario calcados de player/status.ts (statusFor, liveButton, stageMessage) y de MiniPlayer.tsx
   (miniKicker), con los casos de status.test.ts y a4 §5.4, §7.3, §8.1. */

private func foto(
    _ fase: FaseReproductor, conexion: FaseConexion = .activa, titulo: String? = "DAZN 1", arranco: Bool = true,
    directo: InfoDirecto = .nada, demo: Bool = false, motivo: MotivoParada? = nil, espera: String? = nil,
    lead: String? = nil, mensaje: String? = nil
) -> FotoEscenario {
    FotoEscenario(
        titulo: titulo, hash: titulo == nil ? nil : "a1b2", fase: fase, conexion: conexion, mensaje: mensaje,
        directo: directo, arranco: arranco, motivoParada: motivo, demo: demo, espera: espera, lead: lead)
}

private let enElBorde = InfoDirecto(disponible: true, enDirecto: true, retraso: 6, recuperable: 1)
private let porDetras = InfoDirecto(disponible: true, enDirecto: false, retraso: 40, recuperable: 34)

struct EstadoEscenarioTests {
    @Test func botonDirecto() {
        #expect(EstadoEscenario.directo(foto(.idle, conexion: .idle)).modo == .off)
        #expect(EstadoEscenario.directo(foto(.cargando, conexion: .conectando)).modo == .off)
        #expect(EstadoEscenario.directo(foto(.reproduciendo, directo: enElBorde)).etiqueta == "Ya en directo")
        let detras = EstadoEscenario.directo(foto(.reproduciendo, directo: porDetras))
        #expect(detras.modo == .behind && detras.texto == "−34 s" && detras.prefijo == "Ir al directo · ")
        #expect(detras.etiqueta == "Ir al directo (vas 34 segundos por detrás)")
        #expect(EstadoEscenario.directo(foto(.reproduciendo, directo: porDetras, demo: true)).modo == .live)
        let pausa = EstadoEscenario.directo(foto(.pausado, directo: enElBorde))
        #expect(pausa.modo == .resume && pausa.texto == "Reanudar" && pausa.etiqueta == "Reanudar en directo")
    }

    @Test func estadoBase() {
        #expect(EstadoEscenario.base(foto(.idle, conexion: .idle)) == nil)
        let espera = EstadoEscenario.base(foto(.idle, conexion: .idle, espera: "Buscando fuentes para el partido…"))
        #expect(espera?.senal == .checking)
        let detenido = EstadoEscenario.base(foto(.idle, conexion: .idle, titulo: nil, motivo: .usuario))
        #expect(detenido?.texto == "Reproducción detenida. Elige otro partido o canal." && detenido?.icono == .stop)
        #expect(EstadoEscenario.base(foto(.cargando, conexion: .conectando))?.texto == "Conectando con AceStream…")
        let error = EstadoEscenario.base(foto(.error, conexion: .error))
        #expect(error?.texto == "No se pudo abrir el canal." && error?.tono == .err && error?.senal == .fail)
        let demo = EstadoEscenario.base(foto(.reproduciendo, demo: true, lead: "Fuente 1 verificada."))
        #expect(demo?.texto == "Fuente 1 verificada. Vas en directo." && demo?.dato == "demo")
        let detras = EstadoEscenario.base(foto(.reproduciendo, directo: porDetras, lead: "Fuente 1 verificada."))
        #expect(detras?.texto == "Vas por detrás del directo." && detras?.dato == "−34 s")
        let borde = EstadoEscenario.base(foto(.reproduciendo, directo: enElBorde))
        #expect(borde?.texto == "Vas en directo." && borde?.dato == "6 s de retraso")
        let pausa = EstadoEscenario.base(foto(.pausado, directo: porDetras))
        #expect(pausa?.texto == "En pausa. Pulsa Directo para volver al directo." && pausa?.dato == "−34 s")
    }

    @Test func panelDelVideo() {
        let reposo = EstadoEscenario.mensaje(foto(.idle, conexion: .idle, titulo: nil))
        #expect(reposo?.titulo == "Sin señal")
        #expect(reposo?.texto == "Elige un partido en la agenda o un canal de la biblioteca.")
        let buscando = EstadoEscenario.mensaje(foto(.idle, conexion: .idle, espera: "Comprobando 6 fuentes: arranca la primera que funcione…"))
        #expect(buscando?.titulo == "Buscando señal" && buscando?.tono == .ocupado)
        #expect(EstadoEscenario.mensaje(foto(.cargando, conexion: .conectando, arranco: false))?.titulo == "Conectando")
        #expect(EstadoEscenario.mensaje(foto(.cargando, conexion: .conectando, arranco: true))?.titulo == "Reconectando")
        #expect(EstadoEscenario.mensaje(foto(.cargando, conexion: .activa)) == nil)
        let error = EstadoEscenario.mensaje(foto(.error, conexion: .error))
        #expect(error?.titulo == "No se pudo abrir" && error?.tono == .error)
        #expect(EstadoEscenario.botonMensaje(foto(.error, conexion: .error))?.titulo == "Reintentar")
        let traspaso = foto(.idle, conexion: .idle, motivo: .traspaso)
        #expect(EstadoEscenario.mensaje(traspaso)?.titulo == "En otro dispositivo")
        #expect(EstadoEscenario.botonMensaje(traspaso)?.titulo == "Reproducir aquí")
        #expect(!EstadoEscenario.conDatosDeReposo(traspaso))
        #expect(EstadoEscenario.mensaje(foto(.reproduciendo)) == nil)
    }

    @Test func rotuloDelMini() {
        #expect(EstadoEscenario.rotuloMini(.reproduciendo) == "Sonando")
        #expect(EstadoEscenario.rotuloMini(.buffer) == "Sonando")
        #expect(EstadoEscenario.rotuloMini(.cargando) == "Conectando…")
        #expect(EstadoEscenario.rotuloMini(.reconectando) == "Reconectando…")
        #expect(EstadoEscenario.rotuloMini(.pausado) == "En pausa")
        #expect(EstadoEscenario.rotuloMini(.error) == "Sin señal")
        #expect(EstadoEscenario.rotuloMini(.idle) == "Detenido")
    }

    @Test func conectandoYRetroceder() {
        #expect(foto(.cargando, conexion: .pidiendo).conectando)
        #expect(!foto(.reproduciendo).conectando)
        #expect(foto(.reproduciendo).puedeRetroceder)
        #expect(!foto(.reproduciendo, demo: true).puedeRetroceder)
        #expect(!foto(.cargando, conexion: .conectando).puedeRetroceder)
    }
}
