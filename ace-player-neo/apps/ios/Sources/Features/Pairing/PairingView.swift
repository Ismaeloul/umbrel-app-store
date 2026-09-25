import SwiftUI
import UIKit

/// Emparejar el iPhone, en negro cine: escanear el QR de la web (la acción
/// principal, de oro) o teclear el código y las direcciones debajo.
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
                VStack(alignment: .leading, spacing: 22) {
                    cabecera
                    if let aviso = modelo.aviso {
                        Label(aviso, systemImage: "exclamationmark.triangle.fill")
                            .font(.callout)
                            .foregroundStyle(Color(red: 1, green: 0.48, blue: 0.44))
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
                    }
                    Button {
                        errorEscaner = nil
                        vm.mostrandoEscaner = true
                    } label: {
                        Label("Escanear el código QR", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 50)
                    }
                    .botonOro()
                    .accessibilityIdentifier("boton-escanear")

                    Text("o escribe el código")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.55))
                        .frame(maxWidth: .infinity)

                    codigo
                    direcciones
                    if let mensaje = vm.mensajeError {
                        Label(mensaje, systemImage: "xmark.octagon.fill")
                            .font(.callout)
                            .foregroundStyle(Color(red: 1, green: 0.48, blue: 0.44))
                            .accessibilityIdentifier("error-emparejar")
                    }
                }
                .padding(Medida.margen)
                .padding(.top, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(fondo.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .bottom) { botonEmparejar }
            .sheet(isPresented: $vm.mostrandoEscaner) { escaner }
            .onChange(of: enlace, initial: true) { _, nuevo in
                guard let nuevo else { return }
                vm.aplicar(nuevo)
                enlace = nil
            }
            .sensoryFeedback(.error, trigger: vm.mensajeError) { _, nuevo in nuevo != nil }
        }
        .environment(\.colorScheme, .dark)
    }

    /// Negro cine con una luz de oro y otra roja, como el plató del prototipo.
    private var fondo: some View {
        ZStack {
            Color(red: 0.02, green: 0.027, blue: 0.04)
            RadialGradient(
                colors: [Tinta.oro.opacity(0.22), .clear], center: UnitPoint(x: 0.15, y: 0.1), startRadius: 0,
                endRadius: 420)
            RadialGradient(
                colors: [Tinta.directo.opacity(0.16), .clear], center: UnitPoint(x: 0.9, y: 0.35), startRadius: 0,
                endRadius: 380)
            LinearGradient(
                colors: [.clear, Color(red: 0.02, green: 0.027, blue: 0.04).opacity(0.9)], startPoint: .center,
                endPoint: .bottom)
        }
    }

    private var cabecera: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image("Marca")
                    .resizable()
                    .frame(width: 32, height: 32)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .accessibilityHidden(true)
                Text("Ace Player Neo")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .padding(.bottom, 18)
            Text("Empareja este iPhone")
                .font(.titular(.largeTitle, peso: .heavy))
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            Text("En la web, abre Ajustes › Dispositivos › Emparejar un dispositivo. Escanea el QR o escribe los seis dígitos y la dirección.")
                .font(.body)
                .foregroundStyle(.white.opacity(0.78))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var codigo: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Código de emparejamiento")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))
            TextField("000000", text: $vm.codigo)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.numeros(.largeTitle, peso: .bold))
                .kerning(8)
                .multilineTextAlignment(.center)
                .focused($enfoque, equals: .codigo)
                .padding(.horizontal, 14)
                .frame(minHeight: 60)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous)
                        .strokeBorder(
                            enfoque == .codigo ? Tinta.oro : (vm.codigo.count == 6 ? Tinta.oro.opacity(0.7) : .white.opacity(0.22)),
                            lineWidth: 1))
                .accessibilityLabel("Código de 6 dígitos")
                .accessibilityIdentifier("campo-codigo")
            Text("Caduca a los 5 minutos y solo sirve una vez.")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.55))
        }
    }

    private var direcciones: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dirección del servidor")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))
            campoDireccion(
                "Red local", ejemplo: "http://umbrel.local:7792", texto: $vm.direccionLAN, campo: .lan,
                id: "campo-lan")
            campoDireccion(
                "Tailscale", ejemplo: "http://umbrel.tu-red.ts.net:7792", texto: $vm.direccionTailscale,
                campo: .tailscale, id: "campo-tailscale")
            Text("Pon una o las dos: la app usa la que responda y cambia sola al salir de casa.")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.55))
        }
    }

    private func campoDireccion(
        _ titulo: String, ejemplo: String, texto: Binding<String>, campo: Campo, id: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(titulo)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(0.7))
            TextField(ejemplo, text: texto)
                .keyboardType(.URL)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($enfoque, equals: campo)
                .padding(.horizontal, 14)
                .frame(minHeight: Medida.toque)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous)
                        .strokeBorder(enfoque == campo ? Tinta.oro : .white.opacity(0.22), lineWidth: 1))
                .accessibilityLabel("Dirección de \(titulo)")
                .accessibilityIdentifier(id)
        }
    }

    private var botonEmparejar: some View {
        VStack(spacing: 0) {
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
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .tint(.white)
            .disabled(!vm.puedeEnviar)
            .accessibilityIdentifier("boton-emparejar")
        }
        .padding(.horizontal, Medida.margen)
        .padding(.top, 18)
        .padding(.bottom, 8)
        // El contenido se funde con el fondo por detrás del botón (sin barra de material).
        .background {
            LinearGradient(
                stops: [
                    .init(color: Color(red: 0.02, green: 0.027, blue: 0.04).opacity(0), location: 0),
                    .init(color: Color(red: 0.02, green: 0.027, blue: 0.04), location: 0.3),
                    .init(color: Color(red: 0.02, green: 0.027, blue: 0.04), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea(.container, edges: .bottom)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
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
            .overlay {
                MarcoEnfoque()
                    .frame(width: 240, height: 240)
                    .accessibilityHidden(true)
            }
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

/// Marco de enfoque del escáner: cuatro esquinas de oro y un velo alrededor.
struct MarcoEnfoque: View {
    var body: some View {
        GeometryReader { geo in
            let lado: CGFloat = 28
            let w = geo.size.width
            let h = geo.size.height
            Path { camino in
                for (x, y, dx, dy) in [(0, 0, 1, 1), (w, 0, -1, 1), (0, h, 1, -1), (w, h, -1, -1)] as [(CGFloat, CGFloat, CGFloat, CGFloat)] {
                    camino.move(to: CGPoint(x: x, y: y + dy * lado))
                    camino.addLine(to: CGPoint(x: x, y: y))
                    camino.addLine(to: CGPoint(x: x + dx * lado, y: y))
                }
            }
            .stroke(Tinta.oro, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
        }
    }
}
