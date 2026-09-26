import SwiftUI

/* Ajustes › Motor AceStream (a6 §10; SettingsView.tsx `EngineSection`, health/engine.ts): la cápsula del estado
   (`summarizeEngine`; en demo «Motor en línea (demo)») con la versión, el aviso fijo, «Reiniciar el motor» con
   segundo toque de 6 s («¿Seguro? Pulsa otra vez para reiniciar») y «Ver salud de todos los servicios». Al
   reiniciar, la cápsula pasa al momento a «Motor arrancando…», toast «Reiniciando el motor AceStream…» y se vuelve
   a mirar a los 2,5 s. */

struct SeccionMotor: View {
    @Environment(DatosApp.self) private var datos
    @Environment(Avisos.self) private var avisos
    @Environment(Navegador.self) private var navegador
    @Environment(\.vistaActiva) private var vistaActiva
    @Environment(\.modoDemo) private var modoDemo
    @State private var confirmar = SegundoToque()
    @State private var reiniciando = false

    /// Segundo toque del reinicio (`CONFIRM_RESTART_MS`) y vuelta a mirar (`RECHECK_AFTER_RESTART_MS`).
    static let plazo: Duration = .seconds(6)
    static let volverAMirar: Duration = .milliseconds(2500)
    static let aviso = "Reiniciarlo corta la reproducción en todos los dispositivos. Úsalo solo si el motor no responde."

    private var armado: Bool { confirmar.armado == "motor" }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            estado
            Text(Self.aviso)
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
                .fixedSize(horizontal: false, vertical: true)
            Flujo(horizontal: 8, vertical: 12) {
                BotonPalco(armado ? "¿Seguro? Pulsa otra vez para reiniciar" : "Reiniciar el motor", icono: .refresh,
                           variante: armado ? .peligro : .quieto, ocupado: reiniciando) { tocar() }
                BotonPalco("Ver salud de todos los servicios", icono: .senal, variante: .fantasma) {
                    navegador.ir(.ajustes(.salud))
                }
            }
        }
        .task(id: vistaActiva) {
            guard vistaActiva else { return }
            await datos.motor.asegurar(tiempoRealAbierto: datos.tiempoRealAbierto)
        }
        .onChange(of: vistaActiva) { _, activa in if !activa { confirmar.desarmar() } }
    }

    private var estado: some View {
        let resumen = modoDemo ? ResumenMotor(texto: "Motor en línea (demo)", tono: .ok)
            : ResumenMotor.de(datos.motor.datos?.status, fallo: datos.motor.error != nil && datos.motor.datos == nil)
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Capsula(resumen.texto, tono: tono(resumen.tono), punto: resumen.tono == .ok,
                    icono: resumen.tono == .ok ? nil : .motor)
            if let version = datos.motor.datos?.engineVersion {
                Text("versión \(version)").estilo(EstiloTexto(tamano: 13, peso: 560, altoLinea: 1.45)).foregroundStyle(Palco.text3)
            }
        }
    }

    private func tono(_ t: TonoMotor) -> Capsula.Tono {
        switch t {
        case .ok: .ok
        case .weak: .weak
        case .fail: .fail
        case .idle: .neutral
        }
    }

    private func tocar() {
        confirmar.tocar("motor", plazo: Self.plazo) {
            Task {
                reiniciando = true
                await Self.reiniciar(datos: datos, avisos: avisos)
                reiniciando = false
            }
        }
    }

    /// El reinicio (health/engine.ts `restartEngine`): estado «restarting» al momento, `POST engine/restart`,
    /// toast y la comprobación a los 2,5 s (motor; quien llama refresca también la salud).
    static func reiniciar(datos: DatosApp, avisos: Avisos) async {
        if var motor = datos.motor.datos {
            motor.status = .restarting
            motor.online = false
            datos.motor.escribir(motor)
        }
        do {
            _ = try await datos.reiniciarMotor()
            avisos.avisar("Reiniciando el motor AceStream…", tono: .info, icono: .motor)
        } catch {
            avisos.avisar("No se pudo reiniciar el motor. \(APIError.desde(error).mensaje)", tono: .err)
        }
        let motor = datos.motor
        Task {
            try? await Task.sleep(for: volverAMirar)
            await motor.refrescar()
        }
    }
}
