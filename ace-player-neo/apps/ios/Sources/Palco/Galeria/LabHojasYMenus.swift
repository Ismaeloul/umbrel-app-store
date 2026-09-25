#if DEBUG
    import SwiftUI

    /// Bloque 4: hojas nativas de la única puerta de la app (`CentroHojas` → `hojasDeLaApp`: detent medido y
    /// grande, canario C6), menú contextual con vista previa (`menuContextual`, C7) y `Menu` con
    /// `.menuOrder(.fixed)` e iconos de Palco (C14).
    struct LabHojasYMenus: View {
        let galeria: EstadoGaleria
        @Environment(CentroHojas.self) private var hojas

        var body: some View {
            BloqueLab(4, "Hoja y menús") {
                VStack(alignment: .leading, spacing: S.s3) {
                    BotonPalco("Hoja medida", icono: .plus, variante: .quieto) { hojas.abrir(.muestra(.reproducirOtroHash)) }
                    BotonPalco("Hoja grande", icono: .panel, variante: .quieto) { hojas.abrir(.muestra(.atajos)) }
                    ZonaMenuContextual()
                    HStack(spacing: S.s2) {
                        Text("Menú «Más opciones»").estilo(.cuerpo).foregroundStyle(Palco.text2)
                        MenuMuestra(galeria: galeria)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .tarjeta()
            }
        }
    }
#endif
