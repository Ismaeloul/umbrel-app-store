#if DEBUG
    import SwiftUI
    import UIKit

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
            if solo == nil || solo == 9 { CalibracionTinte() }
        }
    }

    /// Bloque 9: candidatos de tinte del cristal en claro sobre la retransmisión de mentira, para elegir el de
    /// `CristalPalco.vidrio` comparando con la barra de la web (c0-cristal/). En oscuro todos llevan el token
    /// (`--glass-dense`), que ya casa. Único `.glassEffect(` fuera de Cristal.swift (excepción de R5).
    private struct CalibracionTinte: View {
        private static let candidatos: [(titulo: String, alfa: Double, claro: Bool)] = [
            ("A · regular + blanco 0,72", 0.72, false), ("B · regular + blanco 0,90", 0.9, false),
            ("C · regular + blanco 0,97", 0.97, false), ("D · regular + blanco 1,00", 1, false),
            ("E · clear + blanco 0,90", 0.9, true), ("F · clear + blanco 1,00", 1, true),
        ]

        var body: some View {
            BloqueLab(9, "Calibración del tinte") {
                VStack(spacing: S.s3) {
                    ForEach(CalibracionTinte.candidatos, id: \.titulo) { candidato in
                        fila(candidato.titulo, alfa: candidato.alfa, claro: candidato.claro)
                    }
                }
                .padding(S.s3)
                .background(FondoRetransmision())
                .clipShape(RoundedRectangle(cornerRadius: R.l, style: .circular))
            }
        }

        private func fila(_ titulo: String, alfa: Double, claro: Bool) -> some View {
            let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
            let base: Glass = claro ? .clear : .regular
            return Text(titulo)
                .estilo(.pestanaBarra)
                .foregroundStyle(Palco.text2)
                .frame(maxWidth: .infinity, minHeight: Alturas.barra)
                .glassEffect(base.tint(CalibracionTinte.blanco(alfa)), in: forma)
        }

        /// Blanco con `alfa` en claro; el token denso en oscuro.
        private static func blanco(_ alfa: Double) -> Color {
            Color(uiColor: UIColor { rasgos in
                rasgos.userInterfaceStyle == .dark
                    ? UIColor(Palco.glassDense).resolvedColor(with: rasgos) : UIColor.white.withAlphaComponent(CGFloat(alfa))
            })
        }
    }
#endif
