import SwiftUI
import UIKit

/// Emparejar el iPhone: escanear el QR de la web o teclear dirección y código.
struct PairingView: View {
    @Environment(AppModel.self) private var modelo
    @Binding var enlace: PairingLink?
    @State private var vm: PairingViewModel
    @State private var errorEscaner: String?
    @FocusState private var enfoque: Campo?

    private enum Campo: Hashable {
        case tailscale, lan, codigo
    }

    init(entorno: Entorno, enlace: Binding<PairingLink?>) {
        _enlace = enlace
        _vm = State(
            initialValue: PairingViewModel(
                servicio: PairingService(api: entorno.api, configuracion: entorno.configuracion),
                configuracionGuardada: entorno.configuracion.leer()))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    cabecera
                    if let aviso = modelo.aviso {
                        Label(aviso, systemImage: "exclamationmark.triangle.fill")
                            .font(.callout)
                            .foregroundStyle(Tinta.falloTinta)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioM))
                    }
                    Button {
                        errorEscaner = nil
                        vm.mostrandoEscaner = true
                    } label: {
                        Label("Escanear el código QR", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: Medida.toque)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("boton-escanear")

                    direcciones
                    codigo
                    if let mensaje = vm.mensajeError {
                        Label(mensaje, systemImage: "xmark.octagon.fill")
                            .font(.callout)
                            .foregroundStyle(Tinta.falloTinta)
                            .accessibilityIdentifier("error-emparejar")
                    }
                }
                .padding(Medida.margen)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Tinta.fondo.ignoresSafeArea())
            // Título grande del sistema arriba (se encoge al desplazar, con su
            // propio fondo): nada de franjas propias encima del contenido.
            .navigationTitle("Emparejar")
            .safeAreaInset(edge: .bottom) { botonEmparejar }
            .sheet(isPresented: $vm.mostrandoEscaner) { escaner }
            .onChange(of: enlace, initial: true) { _, nuevo in
                guard let nuevo else { return }
                vm.aplicar(nuevo)
                enlace = nil
            }
            .sensoryFeedback(.error, trigger: vm.mensajeError) { _, nuevo in nuevo != nil }
        }
    }

    private var cabecera: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image("Marca")
                .resizable()
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
                .accessibilityHidden(true)
            Text("Ace Neo")
                .font(.titular(.title))
                .foregroundStyle(Tinta.texto)
                .accessibilityAddTraits(.isHeader)
            Text("Empareja este iPhone con tu Ace Player Neo. En la web, abre Ajustes → Dispositivos → Emparejar un dispositivo.")
                .font(.body)
                .foregroundStyle(Tinta.texto2)
        }
    }

    private var direcciones: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dirección del servidor")
                .font(.headline)
                .foregroundStyle(Tinta.texto)
            campoDireccion(
                "Tailscale", ejemplo: "http://umbrel.tu-red.ts.net:7792", texto: $vm.direccionTailscale,
                campo: .tailscale, id: "campo-tailscale")
            campoDireccion(
                "Red local", ejemplo: "http://umbrel.local:7792", texto: $vm.direccionLAN, campo: .lan,
                id: "campo-lan")
            Text("Pon una o las dos: la app usa la que responda y cambia sola al salir de casa.")
                .font(.footnote)
                .foregroundStyle(Tinta.texto3)
        }
    }

    private func campoDireccion(
        _ titulo: String, ejemplo: String, texto: Binding<String>, campo: Campo, id: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(titulo)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Tinta.texto2)
            TextField(ejemplo, text: texto)
                .keyboardType(.URL)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($enfoque, equals: campo)
                .padding(.horizontal, 14)
                .frame(minHeight: Medida.toque)
                .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioM))
                .overlay(
                    RoundedRectangle(cornerRadius: Medida.radioM)
                        .strokeBorder(enfoque == campo ? Tinta.acentoBorde : Tinta.linea, lineWidth: 1))
                .accessibilityLabel("Dirección de \(titulo)")
                .accessibilityIdentifier(id)
        }
    }

    private var codigo: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Código de emparejamiento")
                .font(.headline)
                .foregroundStyle(Tinta.texto)
            TextField("000000", text: $vm.codigo)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.numeros(.largeTitle, peso: .bold))
                .kerning(6)
                .focused($enfoque, equals: .codigo)
                .padding(.horizontal, 14)
                .frame(minHeight: 60)
                .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioM))
                .overlay(
                    RoundedRectangle(cornerRadius: Medida.radioM)
                        .strokeBorder(enfoque == .codigo ? Tinta.acentoBorde : Tinta.linea, lineWidth: 1))
                .accessibilityLabel("Código de 6 dígitos")
                .accessibilityIdentifier("campo-codigo")
            Text("Caduca a los 5 minutos y solo sirve una vez.")
                .font(.footnote)
                .foregroundStyle(Tinta.texto3)
        }
    }

    private var botonEmparejar: some View {
        VStack(spacing: 0) {
            botonEmparejarSolo
        }
        .padding(.horizontal, Medida.margen)
        .padding(.top, 18)
        .padding(.bottom, 8)
        // Sin barra de material (en oscuro salía como una franja gris): el
        // contenido se funde con el fondo por detrás del botón. El fondo va en
        // el contenedor: en el botón, su marco llegaba hasta debajo del
        // teclado y XCUITest (y VoiceOver) lo tocaban fuera.
        .background {
            LinearGradient(
                stops: [
                    .init(color: Tinta.fondo.opacity(0), location: 0),
                    .init(color: Tinta.fondo, location: 0.28),
                    .init(color: Tinta.fondo, location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea(.container, edges: .bottom)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private var botonEmparejarSolo: some View {
        Button {
            enfoque = nil
            let nombre = UIDevice.current.name
            Task {
                if await vm.emparejar(nombreDispositivo: nombre) {
                    modelo.emparejado()
                }
            }
        } label: {
            HStack(spacing: 10) {
                if vm.estado == .enviando {
                    ProgressView()
                } else {
                    Image(systemName: "link")
                }
                Text(vm.estado == .enviando ? "Emparejando…" : "Emparejar")
            }
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: Medida.toque)
        }
        .buttonStyle(.borderedProminent)
        .disabled(!vm.puedeEnviar)
        .accessibilityIdentifier("boton-emparejar")
    }

    private var escaner: some View {
        NavigationStack {
            QRScannerView(
                alLeer: { texto in
                    let valido = vm.leido(texto)
                    if valido { vm.mostrandoEscaner = false }
                    return valido
                },
                alFallar: { mensaje in errorEscaner = mensaje }
            )
            .ignoresSafeArea()
            .overlay(alignment: .bottom) {
                Text(errorEscaner ?? vm.mensajeError ?? "Apunta al código QR que enseña la web.")
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .cristal(en: RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous))
                    .padding(Medida.margen)
            }
            .navigationTitle("Escanear")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { vm.mostrandoEscaner = false }
                }
            }
        }
    }
}
