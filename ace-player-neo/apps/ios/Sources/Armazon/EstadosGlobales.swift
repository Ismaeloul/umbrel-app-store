import SwiftUI

/* Estados globales del armazón (b-arquitectura §1.7, M4; a2 §23; api/boot.ts, api/hooks.ts › summarizeEngine):

   - El aviso de arranque de la web (`bootApi` → toast de 4 s): en la demo «Modo demo: sin backend, canales de
     muestra cargados» (info); sin servidor alcanzable, «Backend no disponible; la app seguirá reintentando» (warn),
     una vez al entrar en ese estado, nunca en cada reintento (a2 §23.1).
   - El indicador del motor de todas las cabeceras (`estadoMotor` y qué hace tocarlo: Ajustes › Salud, a2 §6.5).
   - `aceneo://pair` con la app ya emparejada → hoja «¿Emparejar con otro servidor?» (a2 §22.8).
   El acceso perdido (a2 §23.3) lo hace la raíz (`Raiz.volverAEmparejar`); las filas «necesita 0.8.1» son de M7. */

struct EstadosGlobales: ViewModifier {
    @Environment(DatosApp.self) private var datos
    @Environment(SesionApp.self) private var sesion
    @Environment(Avisos.self) private var avisos
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(\.modoDemo) private var modoDemo

    func body(content: Content) -> some View {
        let navegador = self.navegador
        content
            .environment(\.estadoMotor, EstadosGlobales.estadoMotor(datos.motor.datos?.status, fallo: fallo))
            .environment(\.abrirSaludMotor, AccionPalco { navegador.ir(.ajustes(.salud)) })
            .mira(datos.motor)
            .task { await arrancar() }
            .onChange(of: sesion.enlacePendiente, initial: true) { _, enlace in
                guard let enlace else { return }
                hojas.abrir(.otroServidor(enlace))
                sesion.enlacePendiente = nil
            }
    }

    /// «Motor sin respuesta» si la consulta falló sin datos o no hay servidor (`summarizeEngine(…, failed)`).
    private var fallo: Bool {
        (datos.motor.error != nil && datos.motor.datos == nil) || sesion.conexion == .backendNoDisponible
    }

    /// Una vez por armazón montado: la primera lectura del motor. Los dos avisos de arranque (demo y «Backend no
    /// disponible…») los da la sesión (M1, `SesionApp.arrancar`/`sinConexion`) por `alAvisar`: aquí salían dos veces.
    private func arrancar() async {
        #if DEBUG
            ArgumentosArmazon.avisoDePrueba(avisos)
        #endif
        await datos.motor.asegurar(tiempoRealAbierto: datos.tiempoRealAbierto)
    }

    /// api/boot.ts (aviso de 4 s de `bootApi`, main.tsx); los pone `SesionApp` con estos mismos textos.
    static let textoDemo = "Modo demo: sin backend, canales de muestra cargados"
    static let textoSinBackend = "Backend no disponible; la app seguirá reintentando"

    /// `summarizeEngine` (api/hooks.ts): el estado del motor que pintan las cabeceras.
    static func estadoMotor(_ estado: EngineState?, fallo: Bool) -> EstadoMotorVista {
        if fallo { return .sinRespuesta }
        switch estado {
        case .online: return .enLinea
        case .restarting: return .arrancando
        case .offline: return .apagado
        case .unknown, .desconocido, .none: return .comprobando
        }
    }
}
