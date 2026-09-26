import Foundation
import Observation
import UIKit

/* Cómo se enseña el reproductor (b-arquitectura §2.6, I0→M3; player/PlayerSurface.tsx, index.tsx,
   stage-slot.ts): dónde va el vídeo (mini, teatro, inmersivo o vuelo), los controles con su autoocultado de
   3,2 s (solo reproduciendo y nunca con VoiceOver, a4 §5.3 y §5.7), la pantalla completa, «Datos técnicos», el
   corte a negro al cambiar de fuente y la única capa de vídeo con su PiP y el detector de AirPlay. Vive en
   `ContenedorApp` (vida de proceso), nunca en una vista. */

enum LugarVideo: Sendable { case ninguno, mini, teatro, inmersivo, vuelo }

@MainActor @Observable final class PresentacionReproductor {
    private(set) var controlesVisibles = true
    private(set) var pantallaCompletaForzada = false
    private(set) var datosTecnicosAbiertos = false
    private(set) var cortes = 0  // +1 → CorteNegro (560 ms) al cambiar de fuente
    var voiceOverActivo = false {
        didSet { if voiceOverActivo { mostrarControles() } else { programarOcultado() } }
    }
    /// El menú «Más opciones» está abierto: los controles no se esconden (se rearma el plazo).
    var menuAbierto = false

    /// La única capa de vídeo y su PiP (automático al salir de la app).
    let pip: GestorPiP
    /// ¿Hay rutas de AirPlay? (el botón solo sale con ellas).
    let rutas = DetectorRutas()

    private let reproductor: Reproductor
    @ObservationIgnored private var tareaOcultar: Task<Void, Never>?
    @ObservationIgnored private var ultimoHash: String?

    /// CONTROLS_HIDE_MS (player/constants.ts); los tests lo acortan.
    @ObservationIgnored var ocultarTras: Duration = .milliseconds(3200)

    init(reproductor: Reproductor, pip: GestorPiP = GestorPiP()) {
        self.reproductor = reproductor
        self.pip = pip
        pip.conectar(reproductor.motor.avPlayer)
        engancharCapa()
        reproductor.escuchar { [weak self] suceso in self?.alSuceso(suceso) }
        vigilarFase()
    }

    var superficie: SuperficieVideo { pip.superficie }

    // MARK: Lugar

    /// Con presencia: suena o intenta sonar (tras «Detener», un traspaso o una fuente agotada sin otra, la web
    /// quita la presencia y el mini se va).
    private var conPresencia: Bool { reproductor.canal != nil && reproductor.conexion.enMarcha }

    func lugar(teatroVisible: Bool, inmersivo: Bool, volando: Bool) -> LugarVideo {
        if volando { return .vuelo }
        if inmersivo { return .inmersivo }
        if teatroVisible { return .teatro }
        return conPresencia ? .mini : .ninguno
    }

    func miniVisible(teatroVisible: Bool, inmersivo: Bool) -> Bool {
        !teatroVisible && !inmersivo && conPresencia
    }

    // MARK: Controles

    /// Los controles se ven: los visibles, en cualquier fase que no sea «reproduciendo» y siempre con VoiceOver.
    var controlesALaVista: Bool { controlesVisibles || reproductor.fase != .reproduciendo || voiceOverActivo }

    /// Un toque con el dedo en el vídeo: si se ven y suena, se esconden ya; si no, aparecen y se rearma el plazo.
    func tocarVideo() {
        if controlesALaVista && reproductor.fase == .reproduciendo && !voiceOverActivo {
            tareaOcultar?.cancel()
            controlesVisibles = false
        } else {
            interaccionConControles()
        }
    }

    /// `wake()`: enseña los controles y rearma el autoocultado (solo reproduciendo y nunca con VoiceOver).
    func interaccionConControles() {
        mostrarControles()
        programarOcultado()
    }

    private func mostrarControles() {
        if !controlesVisibles { controlesVisibles = true }
    }

    private func programarOcultado() {
        tareaOcultar?.cancel()
        guard reproductor.fase == .reproduciendo, !voiceOverActivo else { return }
        tareaOcultar = Task { [weak self] in
            guard let plazo = self?.ocultarTras else { return }
            try? await Task.sleep(for: plazo)
            guard let self, !Task.isCancelled else { return }
            self.alVencerPlazo()
        }
    }

    private func alVencerPlazo() {
        guard reproductor.fase == .reproduciendo, !voiceOverActivo else { return }
        // Con el menú abierto no se esconden (se quedaría flotando solo): otro plazo.
        if menuAbierto {
            programarOcultado()
            return
        }
        controlesVisibles = false
    }

    /// La fase cambia: fuera de «reproduciendo» se ven siempre; al volver, se rearma el plazo.
    private func vigilarFase() {
        withObservationTracking {
            _ = reproductor.fase
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.faseCambiada()
                self.vigilarFase()
            }
        }
    }

    private func faseCambiada() {
        if reproductor.fase == .reproduciendo {
            programarOcultado()
        } else {
            tareaOcultar?.cancel()
            mostrarControles()
        }
    }

    // MARK: Pantalla completa, datos técnicos, PiP

    /// ⛶ y el doble toque: gira a horizontal (inmersivo) o vuelve a vertical (a2 §27.8; la máscara la pone el
    /// armazón al ver `pantallaCompletaForzada`).
    func alternarPantallaCompleta() {
        pantallaCompletaForzada.toggle()
        Orientacion.pedir(pantallaCompletaForzada ? .landscapeRight : .portrait)
    }

    /// Salir del partido con la pantalla completa puesta la quita (a4 §5.5).
    func quitarPantallaCompleta() {
        guard pantallaCompletaForzada else { return }
        alternarPantallaCompleta()
    }

    func abrirDatosTecnicos() { datosTecnicosAbiertos = true }
    func cerrarDatosTecnicos() { datosTecnicosAbiertos = false }
    func alternarDatosTecnicos() { datosTecnicosAbiertos.toggle() }

    /// «Imagen dentro de imagen» (index.tsx › togglePip): en demo no hay vídeo real.
    func alternarPiP() {
        if reproductor.demo {
            reproductor.notificar(OpcionesReproductor.pipEnDemo, clase: .accion)
            return
        }
        guard pip.soportado, pip.posible || pip.activo else {
            reproductor.notificar(OpcionesReproductor.pipNoDisponible, clase: .accion, tono: .warn)
            return
        }
        pip.alternar()
    }

    /// Corte a negro (W14): al pasar de una fuente a otra.
    func fuenteCambiada() { cortes += 1 }

    private func alSuceso(_ suceso: SucesoReproductor) {
        switch suceso {
        case .empezo(let canal):
            if let anterior = ultimoHash, anterior != canal.id { fuenteCambiada() }
            ultimoHash = canal.id
        case .parado:
            ultimoHash = nil
            datosTecnicosAbiertos = false
        case .arranco:
            break
        }
    }

    // MARK: Lo que pintan el teatro y el mini (status.ts)

    /// Estado base de la línea de estado (`statusFor`): el teatro lo fija en `Avisos.fijarBase` mientras se ve.
    var lineaBase: ContenidoLinea? { EstadoVisible.linea(reproductor.foto) }

    /// El botón de directo (`liveButton`).
    var botonDirecto: BotonDirecto { EstadoVisible.botonDirecto(reproductor.foto) }

    /// El panel del vídeo sin imagen (`stageMessage`).
    var mensajeEscenario: MensajeEscenario? { EstadoVisible.mensajeEscenario(reproductor.foto) }

    /// Las filas de «Datos técnicos» (`nerdRows`); `motor` es el texto del estado del motor.
    func filasDatosTecnicos(motor: String) -> [(String, String)] {
        let r = reproductor
        return EstadoVisible.filasDatosTecnicos(
            EstadoVisible.DatosTecnicos(
                motor: r.demo ? "en línea (demo)" : motor, demo: r.demo, hayMotorVideo: r.conexion.enMarcha,
                protocolo: r.protocolo, estadisticas: r.estadisticas, colchonS: r.conexion == .activa ? r.colchonS : 0,
                retrasoS: DirectoVisible(r.directo).retrasoS, primeraImagenMs: r.primeraImagenMs, codec: r.codec,
                sesion: r.sesionId))
    }

    // MARK: Menú «Más opciones»

    /// Lo que decide las 14 opciones (a4 §5.6).
    var contextoOpciones: ContextoOpcionesReproductor {
        let r = reproductor
        return ContextoOpcionesReproductor(
            hayCanal: r.canal != nil, quiereReproducir: r.quiereReproducir || r.fase == .buffer,
            puedeRetroceder: r.puedeRetroceder, puedeZapear: r.puedeZapear,
            datosTecnicosAbiertos: datosTecnicosAbiertos, puedePantallaCompleta: true, puedePiP: pip.soportado,
            hash: r.canal?.id ?? "")
    }

    var opciones: [OpcionMenu] { OpcionesReproductor.menu(contextoOpciones) }

    // MARK: Ciclo de vida (lo engancha ContenedorApp con CicloVida)

    /// A segundo plano: sin PiP, la capa suelta el reproductor para que siga el audio.
    func pasoASegundoPlano() { pip.pasoASegundoPlano() }

    /// De vuelta: la capa recupera el reproductor (y el PiP se cierra) y el reproductor comprueba la señal.
    func volvioAPrimerPlano() {
        pip.volvioAPrimerPlano()
        reproductor.volvioAPrimerPlano()
    }

    /// La escena se activa: el PiP que siguiera abierto tras volver se cierra.
    func seActivoLaEscena() { pip.seActivoLaEscena() }

    // MARK: Primer fotograma con la capa (a8 §3.11.7)

    private func engancharCapa() {
        guard let motor = reproductor.motor as? MotorAVPlayer else { return }
        let vista = pip.superficie.vista
        motor.listoParaPintar = { [weak vista] in
            guard let vista, vista.window != nil, vista.capa.player != nil else { return nil }
            return vista.capa.isReadyForDisplay
        }
    }
}
