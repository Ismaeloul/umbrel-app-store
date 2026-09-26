import SwiftUI

/* Pestañas del teatro (TheaterTabs.tsx; a4 §11): «Fuentes n · Partido · Datos técnicos» o «[Fuentes n] · Canal ·
   Datos técnicos», segmentado a todo el ancho con la gota que se desliza (muelle estándar), pestañas de 44
   (padding 0 8; ≤ 400: 0 4 y anchura 88 %), la cuenta en `--text-3`. Se queda pegado bajo el vídeo con fondo
   `--bg` y relleno 8 16. Cambiar: háptica de selección. Sin deslizar entre paneles (la web tampoco). */

enum PestanaTeatro: String, CaseIterable, Sendable { case fuentes, partido, canal, datos }

/// La pestaña elegida por tipo de teatro (`theaterTabStore` de TheaterTabs.tsx): una para los partidos y otra para
/// los canales, mientras dura la app (la web la guarda en sessionStorage, que dura lo que la pestaña del
/// navegador). Antes era `@SceneStorage`, que con la raíz en un UIHostingController no guardaba nada: tocar
/// «Canal» o «Datos técnicos» no cambiaba el panel. «Datos técnicos» va de la mano del menú del vídeo
/// (`nerdOpen`): abrirlo elige esa pestaña y cerrarlo vuelve a la última que no lo era.
@MainActor @Observable final class MemoriaPestanasTeatro {
    enum Tipo: Sendable { case partido, canal }

    static let compartida = MemoriaPestanasTeatro()

    private(set) var partido: PestanaTeatro = .fuentes
    private(set) var canal: PestanaTeatro = .fuentes
    /// La última que no era «Datos técnicos», por tipo (`lastPlain`).
    @ObservationIgnored private var ultimaPartido: PestanaTeatro = .fuentes
    @ObservationIgnored private var ultimaCanal: PestanaTeatro = .fuentes

    func elegida(_ tipo: Tipo) -> PestanaTeatro { tipo == .partido ? partido : canal }

    /// `remember`: apunta la pestaña (y la última normal si no es «Datos técnicos»).
    func recordar(_ pestana: PestanaTeatro, en tipo: Tipo) {
        switch tipo {
        case .partido:
            if pestana != .datos { ultimaPartido = pestana }
            if partido != pestana { partido = pestana }
        case .canal:
            if pestana != .datos { ultimaCanal = pestana }
            if canal != pestana { canal = pestana }
        }
    }

    /// Las sesiones (`partido:<id>`, `canal:<hash>`) con las plegadas abiertas. En la web los paneles siguen
    /// montados con `hidden` y al volver a «Fuentes» siguen abiertas; aquí el panel se desmonta, así que se apunta
    /// aquí y se olvida al salir del teatro (cuando la web también desmonta).
    private(set) var plegadasAbiertas: Set<String> = []

    func plegadas(abiertas: Bool, en clave: String) {
        if abiertas {
            plegadasAbiertas.insert(clave)
        } else {
            plegadasAbiertas.remove(clave)
        }
    }

    func olvidarPlegadas() {
        if !plegadasAbiertas.isEmpty { plegadasAbiertas.removeAll() }
    }

    /// El menú del vídeo abre o cierra «Datos técnicos» (`nerdOpen` de TheaterTabs.tsx).
    func datosTecnicos(abiertos: Bool, en tipo: Tipo) {
        if abiertos {
            recordar(.datos, en: tipo)
        } else if elegida(tipo) == .datos {
            recordar(tipo == .partido ? ultimaPartido : ultimaCanal, en: tipo)
        }
    }
}

struct OpcionPestanaTeatro: Identifiable, Hashable {
    var valor: PestanaTeatro
    var titulo: String
    var cuenta: Int?
    var id: PestanaTeatro { valor }

    var identificador: String {
        switch valor {
        case .fuentes: IDUI.pestanaFuentes
        case .partido: IDUI.pestanaPartido
        case .canal: IDUI.pestanaCanal
        case .datos: IDUI.pestanaDatos
        }
    }
}

struct PestanasTeatro: View {
    let opciones: [OpcionPestanaTeatro]
    let seleccion: PestanaTeatro
    let etiqueta: String
    let alElegir: (PestanaTeatro) -> Void
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido
    @State private var anchoFila: CGFloat = 0

    private var indice: Int { opciones.firstIndex { $0.valor == seleccion } ?? 0 }
    private var celda: CGFloat { opciones.isEmpty ? 0 : anchoFila / CGFloat(opciones.count) }
    private var estrecho: Bool { maquetacion.ancho <= 400 }

    var body: some View {
        ZStack(alignment: .leading) {
            GotaPestana()
                .frame(width: celda, height: 44)
                .offset(x: celda * CGFloat(indice))
                .animation(Movimiento.estandar(reducido), value: indice)
            HStack(spacing: 0) {
                ForEach(opciones) { opcion in boton(opcion) }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { anchoFila = $0 }
        }
        .padding(4)
        .background(Palco.lineSoft, in: Capsule())
        .padding(.horizontal, CGFloat(16 + maquetacion.seguras.izquierda))
        .padding(.vertical, 8)
        .background(Palco.bg)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(etiqueta)
        .accessibilityAddTraits(.isTabBar)
    }

    private func boton(_ opcion: OpcionPestanaTeatro) -> some View {
        let activa = opcion.valor == seleccion
        return Button {
            guard !activa else { return }
            alElegir(opcion.valor)
        } label: {
            HStack(spacing: 6) {
                Text(opcion.titulo)
                    .estilo(EstiloTexto(tamano: 13, peso: 620, anchura: estrecho ? 88 : 100, altoLinea: 1.1))
                    .lineLimit(1)
                if let cuenta = opcion.cuenta, cuenta > 0 {
                    Num(String(cuenta), tamano: 13).foregroundStyle(Palco.text3)
                }
            }
            .padding(.horizontal, estrecho ? 4 : 8)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(activa ? Palco.text : Palco.text2)
        .accessibilityAddTraits(activa ? .isSelected : [])
        .accessibilityIdentifier(opcion.identificador)
    }
}

/// La gota: `--surface`, `inset 0 1 0 --glass-hi`, `0 4 14 −6 rgba(0,0,0,.35)`, `0 0 0 1 --line-soft`.
private struct GotaPestana: View {
    var body: some View {
        Capsule()
            .fill(Palco.surface)
            .brilloSuperior(forma: Capsule())
            .background(Capsule().stroke(Palco.lineSoft, lineWidth: 2))
            .sombra([CapaSombra(y: 4, desenfoque: 14, expansion: -6, color: Color.black.opacity(0.35))], forma: Capsule())
    }
}
