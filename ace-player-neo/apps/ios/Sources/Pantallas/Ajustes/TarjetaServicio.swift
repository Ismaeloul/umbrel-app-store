import SwiftUI

/* Una tarjeta de la rejilla de servicios de Salud (a6 §9.3; HealthSection.tsx `Tile`): columna con separación 6,
   relleno 14 16 16, radio 8, `--bg`; borde `--line-soft` (floja: 1 `--weak`; fallo: 1,5 `--fail`). Cabecera: icono
   32 (radio 10, el estado al 16 %, icono 18 en su tinta), estado compacto a la derecha y el nombre como rótulo en
   mayúsculas debajo; detalle 15/650/1,25; nota 12 (`--weak-ink` si es aviso). La del motor lleva «Reiniciar el
   motor» con segundo toque de 6 s y el aviso debajo al armarlo. */

struct TarjetaServicio: View {
    let fila: FilaServicio
    let indice: Int
    let armado: Bool
    let reiniciando: Bool
    let reiniciar: () -> Void
    @Environment(\.movimientoReducido) private var reducido
    @State private var aparecida = false

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: 8, style: .circular)
        VStack(alignment: .leading, spacing: 6) {
            cabecera
            Text(fila.detalle)
                .estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.25))
                .foregroundStyle(Palco.text)
                .fixedSize(horizontal: false, vertical: true)
            if let nota = fila.nota {
                Text(nota)
                    .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(fila.notaAviso ? Palco.weakInk : Palco.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if fila.id == .engine { motor }
        }
        .padding(.top, 14)
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palco.bg, in: forma)
        .bordeInterior(borde, ancho: fila.senal == .fail ? 1.5 : 1, forma: forma)
        .opacity(aparecida ? 1 : 0)
        .offset(y: aparecida || reducido ? 0 : 8)
        .onAppear {
            withAnimation(Movimiento.estandar(reducido).delay(reducido ? 0 : Movimiento.escalonado(indice))) { aparecida = true }
        }
        .accessibilityElement(children: .contain)
    }

    private var borde: Color {
        switch fila.senal {
        case .weak: Palco.weak
        case .fail: Palco.fail
        default: Palco.lineSoft
        }
    }

    private var cabecera: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                IconoPalco(fila.icono, tamano: 18)
                    .foregroundStyle(ColoresSenal.tinta(fila.senal))
                    .frame(width: 32, height: 32)
                    .background(ColoresSenal.medidor(fila.senal).opacity(0.16),
                                in: RoundedRectangle(cornerRadius: R.s, style: .circular))
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
                MedidorSenal(fila.senal, tamano: .sm, palabra: fila.palabra, compacto: true)
            }
            Text(fila.nombre)
                .estilo(EstiloTexto(tamano: 13, peso: 700, trackingEm: 0.14, altoLinea: 1.25, mayusculas: true))
                .foregroundStyle(Palco.text3)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private var motor: some View {
        VStack(alignment: .leading, spacing: 4) {
            BotonPalco(armado ? "¿Seguro? Pulsa otra vez" : "Reiniciar el motor", icono: .refresh,
                       variante: armado ? .peligro : .quieto, tamano: .sm, ocupado: reiniciando, accion: reiniciar)
            if armado {
                Text(SeccionMotor.aviso)
                    .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 6)
    }
}
