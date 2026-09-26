import SwiftUI

/* El panel de emparejar otro aparato (a6 §8.2-§8.7; devices/PairingPanel.tsx): la tarjeta «Añade el iPhone o
   el iPad», el código con su QR, la cuenta atrás y los pasos, «ya está emparejado», «El código ha caducado» y el
   error. Todos los bloques son hundidos (`--bg`, radio 8, relleno 16). */

struct PanelEmparejarDispositivo: View {
    let modelo: ModeloEmparejarDispositivo
    let nombreEmparejado: String?
    let direcciones: Int
    @Environment(\.modoDemo) private var modoDemo
    @Environment(\.maquetacion) private var maquetacion

    var body: some View {
        Group {
            switch modelo.fase {
            case .reposo, .creando: empezar
            case .codigo(let vivo): BloqueCodigo(modelo: modelo, vivo: vivo, direcciones: direcciones, demo: modoDemo)
            case .emparejado: emparejado
            case .caducado: caducado
            case .fallo(let motivo):
                FilaEnLinea(icono: .aviso, tinta: Palco.failInk, texto: "No se pudo crear el código. \(motivo)") {
                    BotonPalco("Volver a intentarlo", icono: .refresh, variante: .quieto, tamano: .sm) { modelo.crear() }
                }
            }
        }
        .onChange(of: modelo.fase.id) { _, _ in anunciar() }
    }

    private func anunciar() {
        let texto = modelo.maquina.anuncio(nombre: nombreEmparejado)
        guard !texto.isEmpty else { return }
        AccessibilityNotification.Announcement(texto).post()
    }

    // MARK: Empezar

    private var empezar: some View {
        let creando = modelo.fase == .creando
        let ancho = maquetacion.ancho >= 560
        return BloqueHundido {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 16) {
                    IconoPalco(.qr, tamano: 28)
                        .foregroundStyle(Palco.accentInk)
                        .frame(width: 52, height: 52)
                        .background(Palco.accentWash, in: RoundedRectangle(cornerRadius: R.m, style: .circular))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Añade el iPhone o el iPad").estilo(Self.titulo).foregroundStyle(Palco.text)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("En la app, escanea el código QR o escribe los seis dígitos que salen aquí.")
                            .estilo(Self.ayuda).foregroundStyle(Palco.text2).fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                BotonPalco(creando ? "Creando el código…" : "Emparejar un dispositivo", icono: .qr, variante: .primario,
                           bloque: !ancho, ocupado: creando) { modelo.crear() }
                    .frame(maxWidth: .infinity, alignment: ancho ? .trailing : .leading)
                    .accessibilityIdentifier(IDUI.botonEmparejarDispositivo)
            }
        }
    }

    // MARK: Emparejado y caducado

    private var emparejado: some View {
        let forma = RoundedRectangle(cornerRadius: 8, style: .circular)
        return HStack(alignment: .top, spacing: 16) {
            IconoPalco(.check, tamano: 24)
                .foregroundStyle(Palco.okInk)
                .frame(width: 44, height: 44)
                .background(Palco.ok.opacity(0.16), in: Circle())
                .bordeInterior(Palco.okInk, ancho: 1.5, forma: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text(nombreEmparejado.map { "«\($0)» ya está emparejado" } ?? "Dispositivo emparejado")
                    .estilo(Self.titulo).foregroundStyle(Palco.text).fixedSize(horizontal: false, vertical: true)
                Text("Ya puede ver la agenda y tus canales. Si lo pierdes, revócalo desde la lista.")
                    .estilo(Self.ayuda).foregroundStyle(Palco.text2).fixedSize(horizontal: false, vertical: true)
                Flujo(horizontal: 8, vertical: 8) {
                    BotonPalco("Emparejar otro", icono: .qr, variante: .quieto) { modelo.crear() }
                    BotonPalco("Hecho", variante: .fantasma) { modelo.cancelar() }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(PalcoMezcla.ok8SobreBg, in: forma)
        .bordeInterior(Palco.ok, ancho: 1.5, forma: forma)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Emparejamiento")
    }

    private var caducado: some View {
        let forma = RoundedRectangle(cornerRadius: 8, style: .circular)
        return VStack(alignment: .leading, spacing: 8) {
            Text("El código ha caducado").estilo(Self.titulo).foregroundStyle(Palco.text)
            Text("Duran 5 minutos y solo sirven una vez. Crea otro cuando tengas el iPhone a mano.")
                .estilo(Self.ayuda).foregroundStyle(Palco.text2).fixedSize(horizontal: false, vertical: true)
            Flujo(horizontal: 8, vertical: 8) {
                BotonPalco("Crear otro código", icono: .refresh, variante: .primario) { modelo.crear() }
                BotonPalco("Cancelar", variante: .fantasma) { modelo.cancelar() }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palco.bg, in: forma)
        .bordeInterior(Palco.line, forma: forma)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Emparejamiento")
    }

    static let titulo = EstiloTexto(tamano: 17, peso: 800, anchura: 125, trackingEm: -0.01, altoLinea: 1.25)
    static let ayuda = EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)
}

/// Un bloque hundido de Ajustes (`--bg`, radio 8 = `--r-inner` de la tarjeta, relleno 16, borde `--line-soft`).
struct BloqueHundido<Contenido: View>: View {
    var borde: Color = Palco.lineSoft
    var anchoBorde: CGFloat = 1
    let contenido: Contenido

    init(borde: Color = Palco.lineSoft, anchoBorde: CGFloat = 1, @ViewBuilder contenido: () -> Contenido) {
        self.borde = borde
        self.anchoBorde = anchoBorde
        self.contenido = contenido()
    }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: 8, style: .circular)
        contenido
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palco.bg, in: forma)
            .bordeInterior(borde, ancho: anchoBorde, forma: forma)
    }
}
