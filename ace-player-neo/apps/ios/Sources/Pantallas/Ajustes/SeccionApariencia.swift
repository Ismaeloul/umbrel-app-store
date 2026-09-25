import SwiftUI

/* Ajustes › Apariencia (a6 §7 y §7.1; SettingsView.tsx `AppearanceSection`): el tema (segmentado a todo el
   ancho: Sistema · Claro · Oscuro) y «Reducir transparencia», con los dos textos de la web según pida ya el
   sistema reducir la transparencia. Se guardan en este iPhone (`aceneo-tema`, `aceneo-transparencia`). */

struct SeccionApariencia: View {
    @Environment(PreferenciasLocales.self) private var preferencias
    @Environment(Haptica.self) private var haptica
    @Environment(\.accessibilityReduceTransparency) private var sistemaReduce

    private static let temas: [OpcionSegmento<TemaApp>] = [
        OpcionSegmento(valor: .sistema, titulo: "Sistema", icono: .pantalla),
        OpcionSegmento(valor: .claro, titulo: "Claro", icono: .sol),
        OpcionSegmento(valor: .oscuro, titulo: "Oscuro", icono: .luna),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Tema").estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.45)).foregroundStyle(Palco.text)
                Segmentado(Self.temas, seleccion: tema, bloque: true, etiqueta: "Tema")
                    .accessibilityIdentifier(IDUI.segmentadoTema)
                Text("«Sistema» sigue el modo claro u oscuro de tu dispositivo.")
                    .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
            }
            FilaInterruptor("Reducir transparencia", descripcion: descripcion, activo: transparencia)
                .accessibilityIdentifier(IDUI.interruptorTransparencia)
        }
    }

    private var descripcion: String {
        sistemaReduce
            ? "Tu sistema ya lo pide: el cristal se ve opaco aunque esto esté apagado."
            : "Cambia el cristal de la barra, las hojas y los menús por superficies opacas."
    }

    private var tema: Binding<TemaApp> {
        Binding(get: { preferencias.tema }, set: { nuevo in
            haptica.disparar(.seleccion)
            preferencias.cambiarTema(nuevo)
        })
    }

    private var transparencia: Binding<Bool> {
        Binding(get: { preferencias.transparenciaReducida }, set: { nuevo in
            haptica.disparar(.seleccion)
            preferencias.cambiarTransparencia(nuevo)
        })
    }
}
