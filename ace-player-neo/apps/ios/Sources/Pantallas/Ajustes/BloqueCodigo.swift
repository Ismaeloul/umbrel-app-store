import SwiftUI

/* La fase «código» del panel de emparejar (a6 §8.3, §8.10.5): bloque hundido con borde 1,5 `--accent-edge`
   que entra con `ace-aparece`; el QR (208 o el 62 % del ancho) dibujado en el iPhone, «QR de muestra (demo)» en
   la demo; «CÓDIGO PARA EMPAREJAR», el código en oro a 44 (64 en horizontal ≥ 520: QR a la izquierda), la
   cuenta atrás (barra fina + «Caduca en 4:58»), los tres pasos numerados y «Crear otro código» · «Cancelar».
   El tic de 1 s solo corre con Ajustes a la vista y la app activa (a6 §14.1). */

struct BloqueCodigo: View {
    let modelo: ModeloEmparejarDispositivo
    let vivo: CodigoVivo
    let direcciones: Int
    let demo: Bool
    @Environment(\.vistaActiva) private var vistaActiva
    @Environment(CicloVida.self) private var cicloVida
    @Environment(\.movimientoReducido) private var reducido
    @State private var ancho: CGFloat = 326
    @State private var aparecido = false

    private var ladoAncho: Bool { ancho >= 520 }
    private var qr: QRPalco { QRPalco(enlace: vivo.enlace) }

    var body: some View {
        BloqueHundido(borde: Palco.accentEdge, anchoBorde: 1.5) {
            Group {
                if ladoAncho {
                    HStack(alignment: .top, spacing: 24) { figura; lado }
                } else {
                    VStack(spacing: 16) { figura; lado }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { ancho = $0 }
        .opacity(aparecido ? 1 : 0)
        .offset(y: aparecido || reducido ? 0 : 8)
        .onAppear { withAnimation(Movimiento.estandar(reducido)) { aparecido = true } }
        .task(id: vistaActiva && cicloVida.fase == .activa) {
            guard vistaActiva, cicloVida.fase == .activa else { return }
            while !Task.isCancelled {
                modelo.tic()
                try? await Task.sleep(for: .seconds(1))
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var figura: some View {
        let lado: CGFloat = min(208, 0.62 * ancho)
        return VStack(spacing: 8) {
            TarjetaQR(qr: qr, lado: lado, direcciones: direcciones)
            if demo {
                Text("QR de muestra (demo)").estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text3)
            }
        }
    }

    private var tamanoCodigo: Double { ladoAncho ? 64 : min(64, max(44, 0.13 * Double(ancho))) }

    private var lado: some View {
        VStack(alignment: ladoAncho ? .leading : .center, spacing: 12) {
            Text("Código para emparejar").estilo(.kicker).foregroundStyle(Palco.text3)
            Num(ModeloDispositivos.agrupar(vivo.codigo),
                estilo: EstiloTexto(tamano: tamanoCodigo, peso: 800, anchura: 125, altoLinea: 1), celda: Num.celdaCodigo,
                etiqueta: "Código \(ModeloDispositivos.deletrear(vivo.codigo))")
                .foregroundStyle(Palco.accentInk)
            cuentaAtras
            pasos
            Flujo(horizontal: 8, vertical: 8, alineacion: ladoAncho ? .leading : .center) {
                BotonPalco("Crear otro código", icono: .refresh, variante: .quieto) { modelo.crear() }
                BotonPalco("Cancelar", variante: .fantasma) { modelo.cancelar() }
            }
        }
        .frame(maxWidth: .infinity, alignment: ladoAncho ? .leading : .center)
    }

    private var cuentaAtras: some View {
        let queda = ModeloDispositivos.cuentaAtras(modelo.restante)
        return VStack(spacing: 6) {
            BarraProgreso(valor: modelo.fraccion, fina: true, etiqueta: "Tiempo que le queda al código")
            HStack(spacing: 0) {
                Text("Caduca en ").estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                Num(queda, tamano: 13, condensado: false)
            }
            .foregroundStyle(Palco.text2)
            .accessibilityHidden(true)
        }
        .frame(maxWidth: 300)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Caduca en \(queda)")
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var pasos: some View {
        VStack(alignment: .leading, spacing: 8) {
            PasoNumerado(n: 1, texto: "Abre Ace Player Neo en el iPhone o el iPad.")
            PasoNumerado(n: 2, texto: "Toca «Emparejar» y escanea el QR, o escribe la dirección y el código.")
            PasoNumerado(n: 3, texto: "Saldrá aquí abajo, en «Emparejados».")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Un paso: círculo oro de 22 con la cifra 12/800 en `--on-accent` y el texto 13/1,25.
private struct PasoNumerado: View {
    let n: Int
    let texto: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)")
                .estilo(EstiloTexto(tamano: 12, peso: 800))
                .foregroundStyle(Palco.onAccent)
                .frame(width: 22, height: 22)
                .background(Palco.accent, in: Circle())
            Text(texto)
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.25))
                .foregroundStyle(Palco.text)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        }
    }
}
