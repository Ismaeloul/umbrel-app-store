#if DEBUG
    import SwiftUI
    import UIKit

    /// Banco de pruebas de la fase 0.4 (b-arquitectura §4.1.4): fuentes y alto de línea medidos contra la web,
    /// iconos, cristal (normal y opaco), hoja con detent medido y menús, barra de estado y háptica. Se abre con
    /// `-AceNeoLaboratorio`; `-AceNeoLaboratorioSeccion <n>` enseña solo el bloque n (capturas por bloque).
    /// Se queda en Debug para siempre: aquí se calibran tinte, alto de línea y sombras (I2).
    struct LaboratorioView: View {
        @State private var haptica = Haptica()
        @State private var galeria = EstadoGaleria()
        @State private var opacoForzado = ModoGaleria.transparenciaReducida
        @Environment(\.accessibilityReduceTransparency) private var reducirTransparencia
        @Environment(\.accessibilityReduceMotion) private var reducirMovimiento

        private var movimientoReducido: Bool { reducirMovimiento || ModoGaleria.movimientoReducido }

        var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: S.s8) {
                    CabeceraVista("Laboratorio", subtitulo: "Banco de Palco (fase 0.4)") { EmptyView() }
                    ControlesLaboratorio(galeria: galeria, opaco: $opacoForzado)
                    bloques
                }
                .padding(.horizontal, S.gutter)
                .padding(.bottom, 120)
                .subeConLaBarraDeEstado(true)
            }
            .scrollPosition($posicion)
            .background(Palco.bg.ignoresSafeArea())
            .font(Mona.fuente(15, peso: 450))
            .environment(haptica)
            .environment(\.cristalOpaco, reducirTransparencia || opacoForzado)
            .environment(\.movimientoReducido, movimientoReducido)
            .modifier(HapticaRaiz(haptica: haptica))
            .onAppear {
                haptica.reducirMovimiento = movimientoReducido
                galeria.aplicarTemaInicial()
            }
            .task {
                guard ModoGaleria.desplazamiento > 0 else { return }
                try? await Task.sleep(for: .milliseconds(500))
                posicion.scrollTo(point: CGPoint(x: 0, y: ModoGaleria.desplazamiento))
            }
        }

        @State private var posicion = ScrollPosition(edge: .top)

        @ViewBuilder private var bloques: some View {
            let solo = ModoGaleria.seccionLaboratorio
            if solo == nil || solo == 1 { LabFuentes() }
            if solo == nil || solo == 2 { LabIconos() }
            if solo == nil || solo == 3 { LabCristal() }
            if solo == nil || solo == 4 { LabHojasYMenus(galeria: galeria) }
            if solo == nil || solo == 5 { LabBarraEstado(galeria: galeria) }
            if solo == nil || solo == 6 { LabHaptica() }
            if solo == nil || solo == 7 { LabGestos() }
        }
    }

    /// Tema de la ventana y transparencia reducida para todo el banco.
    private struct ControlesLaboratorio: View {
        let galeria: EstadoGaleria
        @Binding var opaco: Bool

        var body: some View {
            VStack(alignment: .leading, spacing: S.s4) {
                Segmentado([
                    OpcionSegmento(valor: EstadoGaleria.Tema.sistema, titulo: "Sistema", icono: .pantalla),
                    OpcionSegmento(valor: EstadoGaleria.Tema.claro, titulo: "Claro", icono: .sol),
                    OpcionSegmento(valor: EstadoGaleria.Tema.oscuro, titulo: "Oscuro", icono: .luna),
                ], seleccion: Binding(get: { galeria.tema }, set: { galeria.cambiarTema($0) }), etiqueta: "Tema")
                FilaInterruptor("Reducir transparencia", descripcion: "Todo el cristal del banco pasa a opaco.", activo: $opaco)
            }
            .tarjeta()
        }
    }

    /// Un bloque del banco: título de sección y contenido.
    struct BloqueLab<Contenido: View>: View {
        let numero: Int
        let titulo: String
        let contenido: Contenido

        init(_ numero: Int, _ titulo: String, @ViewBuilder contenido: () -> Contenido) {
            self.numero = numero
            self.titulo = titulo
            self.contenido = contenido()
        }

        var body: some View {
            VStack(alignment: .leading, spacing: S.s3) {
                Text("\(numero). \(titulo)").estilo(.tituloSeccion).foregroundStyle(Palco.text).accessibilityAddTraits(.isHeader)
                contenido
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Enseña una pieza y, debajo, su caja medida frente a la de la web (Chrome, mismo build): verde si las dos
    /// medidas caen a ±1 pt, rojo si no. Así cada captura del banco se revisa sola.
    struct Medido<Contenido: View>: View {
        let web: CGSize?
        let contenido: Contenido
        @State private var caja: CGSize = .zero

        init(web ancho: CGFloat? = nil, _ alto: CGFloat? = nil, @ViewBuilder contenido: () -> Contenido) {
            if let ancho { self.web = CGSize(width: ancho, height: alto ?? 0) } else { self.web = nil }
            self.contenido = contenido()
        }

        private var casa: Bool {
            guard let web else { return true }
            let dx = abs(caja.width - web.width)
            let dy = web.height > 0 ? abs(caja.height - web.height) : 0
            return dx <= 1 && dy <= 1
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                contenido
                    .fixedSize()
                    .onGeometryChange(for: CGSize.self) { $0.size } action: { caja = $0 }
                Text(texto)
                    .font(Martian.fuente(10))
                    .foregroundStyle(casa ? Palco.okInk : Palco.failInk)
            }
        }

        private var texto: String {
            let propia = "\(Medido.pt(caja.width))×\(Medido.pt(caja.height))"
            guard let web else { return propia }
            let marca = casa ? "✓" : "✗"
            return "\(propia) · web \(Medido.pt(web.width))×\(Medido.pt(web.height)) \(marca)"
        }

        static func pt(_ v: CGFloat) -> String { String(format: "%.2f", Double(v)) }
    }
#endif
