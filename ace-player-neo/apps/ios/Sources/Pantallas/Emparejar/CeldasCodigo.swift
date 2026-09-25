import SwiftUI

/* El campo «Código» (a2 §22.4): caja de 64 con radio 14 y las seis cifras en dos grupos «000 000» a
   30/800/125, cada una en una celda de 0,72 em (21,6 pt) centrada; las tecleadas en `--accent-ink`, las que
   faltan «0» en `--text-3` al 45 %; con foco, cursor 2 × 30 en la celda siguiente que parpadea cada 1,06 s
   (fijo con movimiento reducido), borde `--accent-edge` y halo de 3 al 30 %; con error, borde 1,5 `--fail`.
   Encima, un `TextField` transparente (teclado numérico, `oneTimeCode`) que recibe lo que se teclea o pega. */

struct CeldasCodigo: View {
    @Binding var codigo: String
    let error: String?
    let enfocado: FocusState<Bool>.Binding
    @Environment(\.movimientoReducido) private var reducido

    private static let tamano: CGFloat = 30
    private static let celda: CGFloat = 30 * 0.72  // a2 §22.4 y a6 §8.3: 0,72 em
    private var conFoco: Bool { enfocado.wrappedValue }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Código").estilo(.etiquetaCampo).foregroundStyle(Palco.text2)
            caja
            if let error {
                Text(error).estilo(.errorCampo).foregroundStyle(Palco.failInk)
            } else {
                Text("Caduca a los 5 minutos y solo sirve una vez.").estilo(.pista).foregroundStyle(Palco.text2)
            }
        }
    }

    private var caja: some View {
        ZStack {
            cifras
            TextField("", text: $codigo)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .foregroundStyle(Color.clear)
                .tint(Color.clear)
                .focused(enfocado)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
                .accessibilityLabel("Código de emparejamiento")
                .accessibilityValue(ModeloDispositivos.deletrear(codigo))
                .accessibilityIdentifier(IDUI.campoCodigo)
        }
        .frame(height: 64)
        .frame(maxWidth: .infinity)
        .background(MarcoCodigo(foco: conFoco, error: error != nil))
    }

    private var cifras: some View {
        let digitos = Array(codigo)
        return HStack(spacing: 0) {
            ForEach(0..<6, id: \.self) { i in
                if i == 3 { Text(" ").estilo(estilo) }
                CeldaCifra(cifra: i < digitos.count ? digitos[i] : nil, cursor: conFoco && i == digitos.count,
                           reducido: reducido, estilo: estilo, ancho: Self.celda)
            }
        }
        .accessibilityHidden(true)
    }

    private var estilo: EstiloTexto { EstiloTexto(tamano: 30, peso: 800, anchura: 125) }
}

/// Una celda: la cifra tecleada, o el «0» pendiente, y el cursor si toca.
private struct CeldaCifra: View {
    let cifra: Character?
    let cursor: Bool
    let reducido: Bool
    let estilo: EstiloTexto
    let ancho: CGFloat

    var body: some View {
        ZStack {
            Text(String(cifra ?? "0"))
                .estilo(estilo)
                .foregroundStyle(cifra == nil ? Palco.text3.opacity(0.45) : Palco.accentInk)
            if cursor { Cursor(reducido: reducido) }
        }
        .frame(width: ancho)
    }
}

/// Barra 2 × 30 `--accent-edge` que parpadea (opacidad 1 ↔ 0) cada 1,06 s.
private struct Cursor: View {
    let reducido: Bool

    var body: some View {
        TimelineView(.periodic(from: .distantPast, by: 0.53)) { contexto in
            let fase = Int(contexto.date.timeIntervalSinceReferenceDate / 0.53)
            Capsule()
                .fill(Palco.accentEdge)
                .frame(width: 2, height: 30)
                .opacity(reducido || fase % 2 == 0 ? 1 : 0)
        }
    }
}

/// Caja del código: `--surface`, borde `--line-strong`; con foco, `--accent-edge` + halo 3 al 30 %; con error,
/// 1,5 `--fail`.
private struct MarcoCodigo: View {
    let foco: Bool
    let error: Bool

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        forma
            .fill(Palco.surface)
            .bordeInterior(error ? Palco.fail : (foco ? Palco.accentEdge : Palco.lineStrong), ancho: error ? 1.5 : 1, forma: forma)
            .background { if foco && !error { forma.stroke(Palco.accentEdge.opacity(0.3), lineWidth: 6) } }
    }
}

