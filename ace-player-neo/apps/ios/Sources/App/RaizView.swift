import SwiftUI

/// Raíz de la app (b-arquitectura §2.3, I0→M4). PROVISIONAL de la poda (fase 0.2, §4.1.2): «Ace Neo»
/// sobre el fondo de la app, para que el objetivo compile sin la interfaz vieja. La fase 0.3b escribe
/// la raíz del contrato (emparejar ↔ app, entorno, háptica y fuente raíz).
///
/// Fase 0.4 (P): con `-AceNeoLaboratorio` o `-AceNeoSistema` (solo Debug, §3.3.1) abre el banco de Palco o la
/// galería «Sistema»; la raíz de 0.3b debe conservar estas dos entradas.
struct RaizView: View {
    var body: some View {
        #if DEBUG
            if ModoGaleria.laboratorio {
                LaboratorioView()
            } else if ModoGaleria.sistema {
                SistemaView()
            } else {
                provisional
            }
        #else
            provisional
        #endif
    }

    private var provisional: some View {
        ZStack {
            Palco.bg.ignoresSafeArea()
            Text("Ace Neo")
                .foregroundStyle(Palco.text)
        }
    }
}
