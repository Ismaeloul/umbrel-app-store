import SwiftUI
import UIKit

/* La barra superior de la web en horizontal ≥ 768 (b-arquitectura §3.5, M4; a2 §16.1; app/Nav.tsx › TopBar,
   shell.css `.topbar`). Pegada arriba, a lo ancho, alto 64 + safeT (se calca 64, a2 §20.1), rejilla
   `1fr · auto · 1fr` con separación 16 y relleno lateral 16 + zonas:

   - izquierda: la marca (logo 28×28 de radio 8; el nombre se oculta entre 768 y 1023), «Ace Player Neo: ir a la
     agenda», zona de 44;
   - centro: los 4 destinos en un grupo de relleno 4 y radio 999, celdas de 104 × 44 (icono 20 + 13/620/88,
     separación 7, relleno 0 8), con la misma píldora `--accent-wash` que se desliza con el muelle estándar;
   - derecha: el rayo del motor sin texto (alturas ≤ 540) y «?» «Atajos de teclado», separación 2.
   Fondo `--glass` (cristal regular); cuando la vista baja más de 32 pt aparece la capa `--glass-dense` con el filo
   inferior `--line-soft` en 340 ms (`--dur-rapido`, `ease-out`). Transparencia reducida: `--glass-solid`. */

struct BarraSuperior: View {
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(\.maquetacion) private var maquetacion
    @State private var vigia = VigiaDesplazamiento()

    var body: some View {
        let alto: CGFloat = CGFloat(maquetacion.altoBarraSuperior)
        HStack(spacing: S.s4) {
            marca.frame(maxWidth: .infinity, alignment: .leading)
            DestinosBarraSuperior()
            derecha.frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.top, CGFloat(maquetacion.seguras.arriba))
        .padding(.leading, CGFloat(maquetacion.rellenoIzquierdo))
        .padding(.trailing, CGFloat(maquetacion.rellenoDerecho))
        .frame(width: CGFloat(maquetacion.ancho), height: alto)
        .background { FondoBarraSuperior(solida: vigia.bajada) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Principal")
        .accessibilityIdentifier(IDUI.barraSuperior)
        .task(id: navegador.pestana) {
            // La lista puede llegar después (primera carga, error → lista) o cambiar de vista: se vuelve a mirar
            // cada medio segundo mientras la barra se ve (solo en horizontal ≥ 768). La primera, cuando la
            // pestaña nueva ya está maquetada.
            try? await Task.sleep(for: .milliseconds(60))
            while !Task.isCancelled {
                vigia.vigilar()
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
    }

    private var marca: some View {
        Button { navegador.ir(.agenda) } label: {
            Image("Marca")
                .resizable()
                .frame(width: 28, height: 28)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .circular))
                .frame(minWidth: S.tap, minHeight: S.tap)
                .contentShape(Rectangle())
        }
        .buttonStyle(EstiloPlano())
        .accessibilityLabel("Ace Player Neo: ir a la agenda")
        .accessibilityIgnoresInvertColors()
    }

    private var derecha: some View {
        HStack(spacing: 2) {
            MotorBarraSuperior(soloIcono: maquetacion.bajo)
            BotonIcono(.ayuda, etiqueta: "Atajos de teclado") { hojas.abrir(.ayuda) }
                .accessibilityShowsLargeContentViewer()
        }
    }
}

/// El indicador del motor de la cabecera, en la barra (a2 §16.1: solo el rayo en alturas ≤ 540).
private struct MotorBarraSuperior: View {
    let soloIcono: Bool
    @Environment(\.estadoMotor) private var estadoMotor
    @Environment(\.abrirSaludMotor) private var abrirSaludMotor

    var body: some View {
        if let estadoMotor {
            IndicadorMotor(estadoMotor, soloIcono: soloIcono) { abrirSaludMotor?.ejecutar() }
                .accessibilityShowsLargeContentViewer()
        }
    }
}

/// Los cuatro destinos con su píldora (a2 §16.1).
private struct DestinosBarraSuperior: View {
    @Environment(Navegador.self) private var navegador
    @Environment(\.movimientoReducido) private var reducido
    private let celda: CGFloat = 104  // shell.css: `--topbar-item-w` entre 768 y 1023

    var body: some View {
        let dentro: Bool = navegador.capa == nil || navegador.capa?.pestana != nil
        ZStack(alignment: .leading) {
            Capsule()
                .fill(Palco.accentWash)
                .frame(width: celda, height: S.tap)
                .offset(x: CGFloat(navegador.pestana.indice) * celda)
                .opacity(dentro ? 1 : 0)
                .animation(Movimiento.estandar(reducido), value: navegador.pestana)
            HStack(spacing: 0) {
                ForEach(Pestana.allCases) { pestana in
                    boton(pestana, activa: dentro && pestana == navegador.pestana)
                }
            }
        }
        .padding(4)
    }

    private func boton(_ pestana: Pestana, activa: Bool) -> some View {
        Button { navegador.tocarPestana(pestana) } label: {
            HStack(spacing: 7) {
                IconoPalco(pestana.icono, tamano: 20)
                Text(pestana.titulo).estilo(.destinoBarraSuperior).lineLimit(1)
            }
            .padding(.horizontal, 8)
            .frame(width: celda, height: S.tap)
            .contentShape(Capsule())
        }
        .buttonStyle(EstiloPlano())
        .foregroundStyle(activa ? Palco.accentInk : Palco.text2)
        .accessibilityLabel(pestana.titulo)
        .accessibilityAddTraits(activa ? [.isSelected] : [])
        .accessibilityShowsLargeContentViewer()
        .accessibilityIdentifier(IDUI.pestana(pestana.rawValue))
    }
}

/// `--glass` de cristal y, al bajar, la capa `--glass-dense` con el filo inferior (a2 §16.1).
private struct FondoBarraSuperior: View {
    let solida: Bool
    @Environment(\.cristalOpaco) private var opaco
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        ZStack {
            Color.clear.cristal(.regular, en: Rectangle())
            Palco.glassDense
                .overlay(alignment: .bottom) { Palco.lineSoft.frame(height: 1) }
                .opacity(solida && !opaco ? 1 : 0)
                .animation(.easeOut(duration: reducido ? 0.12 : 0.34), value: solida)
        }
        .allowsHitTesting(false)
    }
}

/// ¿La vista que se ve ha bajado más de 32 pt? (el centinela de 32 px de la web, app/Nav.tsx › useScrolledPast).
/// Mira con KVO la vista desplazable de la pestaña que se ve (`SubirArriba.vistaVisible`, nunca una oculta).
@MainActor @Observable final class VigiaDesplazamiento {
    private(set) var bajada = false
    @ObservationIgnored private var observacion: NSKeyValueObservation?
    @ObservationIgnored private weak var vista: UIScrollView?

    func vigilar() {
        guard let nueva = SubirArriba.vistaVisible() else {
            // Sin una vista clara (p. ej. a mitad de un cambio): se sigue con la de antes mientras esté puesta.
            if let vista, vista.window != nil { return }
            observacion = nil
            vista = nil
            bajada = false
            return
        }
        guard nueva !== vista else { return }
        vista = nueva
        observacion = nueva.observe(\.contentOffset, options: [.initial, .new]) { [weak self] desplazable, _ in
            MainActor.assumeIsolated { self?.anotar(desplazable) }  // permitido: UIKit cambia el desplazamiento en el hilo principal
        }
    }

    private func anotar(_ desplazable: UIScrollView) {
        let bajado: Bool = desplazable.contentOffset.y + desplazable.adjustedContentInset.top > 32
        if bajado != bajada { bajada = bajado }
    }
}
