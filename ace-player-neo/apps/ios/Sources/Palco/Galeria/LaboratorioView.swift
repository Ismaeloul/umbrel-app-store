#if DEBUG
    import SwiftUI

    /// Banco de pruebas de la fase 0 (b-arquitectura §4.1.4): fuentes y alto de línea medidos contra la web,
    /// iconos, cristal (normal y opaco), hoja con detent medido y menús, barra de estado, háptica, gestos y marcos
    /// del vuelo. Se abre con `-AceNeoLaboratorio`; `-AceNeoLaboratorioSeccion <n>` enseña solo el bloque n
    /// (capturas por bloque). Vive dentro de `RaizView`: la háptica, las hojas, el tema (`PreferenciasLocales`)
    /// y la ventana (`EstadoVentana` → `HostingRaiz`) son los de la app. Se queda en Debug para siempre: aquí se
    /// calibran tinte, alto de línea y sombras (I2).
    struct LaboratorioView: View {
        @State private var galeria = EstadoGaleria()
        @State private var posicion = ScrollPosition(edge: .top)

        var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: S.s8) {
                    CabeceraVista("Laboratorio", subtitulo: "Banco de Palco (fase 0.4)") { EmptyView() }
                    ControlTema(descripcion: "Todo el cristal del banco pasa a opaco.").tarjeta()
                    bloques
                }
                .padding(.horizontal, S.gutter)
                .padding(.bottom, 120)
                .subeConLaBarraDeEstado(true)
            }
            .scrollPosition($posicion)
            .background(Palco.bg.ignoresSafeArea())
            .task { await EstadoGaleria.desplazarAlAbrir($posicion) }
        }

        @ViewBuilder private var bloques: some View {
            let solo: Int? = ModoEjecucion.seccionLaboratorio
            if solo == nil || solo == 1 { LabFuentes() }
            if solo == nil || solo == 2 { LabIconos() }
            if solo == nil || solo == 3 { LabCristal() }
            if solo == nil || solo == 4 { LabHojasYMenus(galeria: galeria) }
            if solo == nil || solo == 5 { LabBarraEstado() }
            if solo == nil || solo == 6 { LabHaptica() }
            if solo == nil || solo == 7 { LabGestos() }
            if solo == nil || solo == 8 { LabMarcos() }
        }
    }
#endif
