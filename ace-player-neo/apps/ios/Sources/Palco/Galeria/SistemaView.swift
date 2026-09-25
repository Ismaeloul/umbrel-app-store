import SwiftUI

/// La galería «Sistema» de la web (a1 §11; app/sistema/SistemaPage.tsx): cada token y cada primitiva de Palco
/// en sus estados, con los textos literales, para compararla lado a lado con la web en el mismo iPhone. Se
/// abre con 7 toques en «Versión» (Ajustes › Acerca de, M7) o con `-AceNeoSistema` en Debug. Sus datos son de
/// muestra: no toca el servidor ni la biblioteca. El tema, la transparencia, la háptica y las hojas son los de
/// la app (entorno de `RaizView`).
struct SistemaView: View {
    @State private var galeria = EstadoGaleria()
    @State private var posicion = ScrollPosition(edge: .top)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: S.s8) {
                CabeceraVista("Sistema", subtitulo: "Tokens y componentes de la piel «Palco»") {
                    MenuMuestra(galeria: galeria)
                }
                VStack(alignment: .leading, spacing: S.s8) {
                    SeccionesSistemaA(galeria: galeria)
                    SeccionesSistemaB(galeria: galeria)
                    SeccionesSistemaC(galeria: galeria)
                }
            }
            .padding(.horizontal, S.gutter)
            .padding(.bottom, 120)
            .subeConLaBarraDeEstado(true)
        }
        .scrollPosition($posicion)
        .background(Palco.bg.ignoresSafeArea())
        .overlay(alignment: .bottom) { AvisosGaleria(galeria: galeria) }
        .task { await EstadoGaleria.desplazarAlAbrir($posicion) }
    }
}

/// Toasts y línea de estado de muestra, abajo (en la app los pinta `Avisos`, M4).
private struct AvisosGaleria: View {
    let galeria: EstadoGaleria
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        VStack(spacing: 8) {
            if let toast = galeria.toast {
                ToastVista(toast, alAccion: {
                    galeria.cerrarToast()
                    galeria.avisar("Recuperado", tono: .ok)
                }, alCerrar: { galeria.cerrarToast() })
                .id(toast.id)
                .transition(.opacity.combined(with: .offset(y: 12)))
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 12)
        .animation(Movimiento.estandar(reducido), value: galeria.toast?.id)
    }
}
