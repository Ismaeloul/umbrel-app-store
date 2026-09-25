import Foundation
import Observation
import UIKit

/* Preferencias de este iPhone (b-arquitectura §2.3, I0→M4; a1 §13.10): aceneo-tema,
   aceneo-transparencia y aceneo-pb, con los valores de la web. La única puerta a UserDefaults para la
   interfaz (regla R18). En Debug, -AceNeoTransparenciaReducida la fuerza y -AceNeoApariencia hace de apariencia
   DEL SISTEMA (como el prefers-color-scheme de las capturas de la web): el tema arranca en «Sistema» sin leer el
   guardado y, mientras siga en «Sistema», la ventana usa la forzada. */

enum TemaApp: String, CaseIterable, Sendable {
    case sistema, claro, oscuro
    var estiloUI: UIUserInterfaceStyle {
        switch self {
        case .sistema: .unspecified
        case .claro: .light
        case .oscuro: .dark
        }
    }
}

@MainActor @Observable final class PreferenciasLocales {
    private(set) var tema: TemaApp
    private(set) var transparenciaReducida: Bool
    private(set) var modo: PlaybackMode
    private let defaults: UserDefaults
    /// La apariencia del sistema forzada por -AceNeoApariencia (capturas; nil en Release).
    private let aparienciaSistema: TemaApp?

    init(_ defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let guardado = TemaApp(rawValue: defaults.string(forKey: Claves.tema) ?? "") ?? .sistema
        let forzado = ModoEjecucion.aparienciaForzada.flatMap(TemaApp.init(rawValue:))
        aparienciaSistema = forzado
        tema = forzado == nil ? guardado : .sistema
        let reducida = defaults.string(forKey: Claves.transparencia) == "reducida"
        transparenciaReducida = reducida || ModoEjecucion.transparenciaReducida
        modo = PlaybackMode(rawValue: defaults.string(forKey: Claves.modo) ?? "") ?? .porDefecto
    }

    /// Lo que la ventana pide al sistema (lo aplican SceneDelegate y HostingRaiz).
    var estiloVentana: UIUserInterfaceStyle {
        if tema == .sistema, let aparienciaSistema { return aparienciaSistema.estiloUI }
        return tema.estiloUI
    }

    func cambiarTema(_ tema: TemaApp) {
        self.tema = tema
        defaults.set(tema.rawValue, forKey: Claves.tema)
    }

    func cambiarTransparencia(_ reducida: Bool) {
        transparenciaReducida = reducida
        defaults.set(reducida ? "reducida" : "normal", forKey: Claves.transparencia)
    }

    func cambiarModo(_ modo: PlaybackMode) {
        self.modo = modo
        defaults.set(modo.rawValue, forKey: Claves.modo)
    }
}
