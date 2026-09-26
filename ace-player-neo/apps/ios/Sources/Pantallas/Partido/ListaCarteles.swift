import SwiftUI

/* La rejilla de carteles (SourceList.tsx; a4 §12.6-§12.7): dos columnas iguales, separación 20 en vertical y 12
   en horizontal, relleno 4 4 0, en el orden del servidor y con su número fijo. Aparición escalonada al
   insertarse (36 ms por cartel, tope 10; sin escalonado con movimiento reducido).
   Las plegadas van al final tras «Ver n más…». */

struct ListaCarteles: View {
    let visibles: [FilaFuente]
    let plegadas: [FilaFuente]
    let enPartido: Bool
    /// La sesión del teatro: con ella, abrir las plegadas sobrevive a cambiar de pestaña (MemoriaPestanasTeatro).
    var clave: String? = nil
    @State private var abiertasAqui = false
    private let memoria = MemoriaPestanasTeatro.compartida
    @Namespace private var espacio

    private var abiertas: Bool {
        guard let clave else { return abiertasAqui }
        return memoria.plegadasAbiertas.contains(clave)
    }

    private func alternarPlegadas() {
        let nuevas: Bool = !abiertas
        if let clave {
            memoria.plegadas(abiertas: nuevas, en: clave)
        } else {
            abiertasAqui = nuevas
        }
    }
    @Environment(\.movimientoReducido) private var reducido

    /// «En pantalla» viaja del cartel viejo al nuevo (FLIP de SourceList.tsx; con movimiento reducido, aparece sin más).
    private var enPantalla: String? { (visibles + plegadas).first { $0.enPantalla }?.id }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !visibles.isEmpty {
                RejillaCarteles(filas: visibles, enPartido: enPartido, espacio: espacio)
                    .accessibilityLabel(enPartido ? "Fuentes del partido" : "Fuentes del canal")
            }
            if !plegadas.isEmpty { botonPlegadas.padding(.top, 20) }
            if abiertas && !plegadas.isEmpty {
                RejillaCarteles(filas: plegadas, enPartido: enPartido, espacio: espacio)
                    .padding(.top, 4)
                    .accessibilityLabel(enPartido ? "Fuentes del partido: sin señal o en cola" : "Fuentes del canal: sin señal o en cola")
            }
        }
        .animation(reducido ? nil : Movimiento.estandar(false), value: enPantalla)
    }

    /// Alto 44, relleno 0 12 0 8, separación 6, píldora, 13/650 `--text-2`, icono 18.
    private var botonPlegadas: some View {
        Button { alternarPlegadas() } label: {
            HStack(spacing: 6) {
                IconoPalco(abiertas ? .chevU : .chevD, tamano: 18)
                Text(Self.textoPlegadas(plegadas, abiertas: abiertas)).estilo(.botonSm)
            }
            .padding(.leading, 8)
            .padding(.trailing, 12)
            .frame(height: 44)
            .contentShape(Capsule())
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(Palco.text2)
        .accessibilityAddTraits(abiertas ? .isSelected : [])
    }

    /// «Ver 3 más sin señal» / «Ver 3 más (1 sin señal, 2 en cola)» / «Ver 3 más en cola» / «Ocultar…»
    /// (el botón de SourceList.tsx).
    static func textoPlegadas(_ plegadas: [FilaFuente], abiertas: Bool) -> String {
        if abiertas { return "Ocultar las que no dan señal" }
        let sinSenal: Int = plegadas.filter { $0.senal == .fail }.count
        let n: Int = plegadas.count
        if sinSenal == n { return "Ver \(n) más sin señal" }
        if sinSenal > 0 { return "Ver \(n) más (\(sinSenal) sin señal, \(n - sinSenal) en cola)" }
        return "Ver \(n) más en cola"
    }
}

private struct RejillaCarteles: View {
    let filas: [FilaFuente]
    let enPartido: Bool
    let espacio: Namespace.ID

    private let columnas = [GridItem(.flexible(), spacing: 12, alignment: .top), GridItem(.flexible(), alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columnas, alignment: .leading, spacing: 20) {
            ForEach(Array(filas.enumerated()), id: \.element.id) { indice, fila in
                CartelFuente(fila: fila, enPartido: enPartido, espacio: espacio)
                    .modifier(AparicionEscalonadaCarteles(indice: indice))
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
        .accessibilityElement(children: .contain)
    }
}

/// `ace-aparece` (de `opacity 0, translateY(8)` a normal, 520 ms muelle estándar) con `min(i, 10)·36 ms` de
/// retraso, solo al aparecer. Con movimiento reducido, sin escalonado.
private struct AparicionEscalonadaCarteles: ViewModifier {
    let indice: Int
    @Environment(\.movimientoReducido) private var reducido
    @State private var visible = false

    func body(content: Content) -> some View {
        content
            .opacity(visible ? 1 : 0)
            .offset(y: visible || reducido ? 0 : 8)
            .onAppear {
                guard !visible else { return }
                let retraso: Double = reducido ? 0 : Movimiento.escalonado(indice)
                withAnimation(Movimiento.estandar(reducido).delay(retraso)) { visible = true }
            }
    }
}
