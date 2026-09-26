import SwiftUI

/* La pantalla de emparejar este iPhone (b-arquitectura §2.8, M7; a2 §22, §23.3, §27.3): lo único que la web
   no tiene. En vertical, el cartel de la cámara a sangre (alto `min(max(360, 0,6 × alto), 500)`) y debajo la
   columna (texto de entrada, aviso de acceso perdido, fila de error y la tarjeta «Escribir el código»); en
   horizontal, dos columnas: la cámara en una tarjeta cuadrada y el formulario con su propio desplazamiento
   (a2 §22.7). La decisión la toma el tamaño medido, con el MISMO modelo y la MISMA cámara (al girar no se
   pierden ni el estado ni la sesión de la cámara). Las zonas seguras salen de `Maquetacion` (medida de la
   ventana, no GeometryReader + ignoresSafeArea: §5 y a2 §27.1). */

struct PantallaEmparejar: View {
    let motivo: MotivoEmparejar?
    @Environment(SesionApp.self) private var sesion
    @Environment(Raiz.self) private var raiz
    @Environment(Haptica.self) private var haptica
    @Environment(CicloVida.self) private var cicloVida
    @Environment(EstadoVentana.self) private var estadoVentana
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.maquetacion) private var maquetacion
    @State private var modelo: ModeloEmparejar?
    @State private var camara: CamaraQR?
    @State private var tamano: CGSize = .zero

    init(motivo: MotivoEmparejar?) {
        self.motivo = motivo
    }

    var body: some View {
        ZStack {
            Palco.bg.ignoresSafeArea()
            if let modelo, let camara, tamano.width > 0 {
                VistaEmparejar(modelo: modelo, camara: camara, motivo: motivo, tamano: tamano, seguras: seguras)
            }
        }
        .background {
            // Medida de la ventana entera (sin restar el teclado: el cartel no cambia de alto al escribir).
            Color.clear
                .ignoresSafeArea()
                .onGeometryChange(for: CGSize.self) { $0.size } action: { nuevo in tamano = nuevo }
        }
        .ignoresSafeArea(.container)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.pantalla("emparejar"))
        .onAppear {
            if modelo == nil { modelo = crearModelo() }
            if camara == nil { camara = CamaraQR() }
            aplicarEnlacePendiente()
        }
        .onChange(of: sesion.enlaceParaEmparejar) { _, _ in aplicarEnlacePendiente() }
        .task(id: motivo) { await anunciarAviso() }
        .onDisappear {
            estadoVentana.fondoOscuroArriba = false
            camara?.detener()
        }
    }

    /// Las zonas seguras de la ventana (las mide la raíz con `MedidaVentana`).
    private var seguras: UIEdgeInsets {
        let zonas = maquetacion.seguras
        return UIEdgeInsets(top: CGFloat(zonas.arriba), left: CGFloat(zonas.izquierda), bottom: CGFloat(zonas.abajo),
                            right: CGFloat(zonas.derecha))
    }

    /// VoiceOver anuncia el aviso de acceso perdido al entrar (a2 §23.3 punto 6), cuando acaba la transición
    /// «atrás» (340 ms, punto 5). «Olvidar este iPhone» no tiene aviso.
    private func anunciarAviso() async {
        guard let motivo, let aviso = ReglasEmparejar.avisoAcceso(MotivoEmparejarPuro.de(motivo)) else { return }
        try? await Task.sleep(for: .milliseconds(340))
        guard !Task.isCancelled else { return }
        AccessibilityNotification.Announcement(aviso).post()
    }

    /// Un enlace `aceneo://pair` abierto con esta pantalla delante se aplica y se empareja solo (a2 §22.1).
    private func aplicarEnlacePendiente() {
        guard let enlace = sesion.enlaceParaEmparejar, let modelo else { return }
        sesion.enlaceParaEmparejar = nil
        modelo.aplicar(enlace)  // todas sus `u=` (a2 §22.4, a9 §3.4)
        Task { await modelo.emparejar() }
    }

    /// El modelo con sus servicios: el canje del núcleo, la háptica central, VoiceOver y la raíz (a2 §22.6).
    private func crearModelo() -> ModeloEmparejar {
        let entorno = sesion.entorno
        let servicio = PairingService(api: entorno.api, configuracion: entorno.configuracion)
        let nombre = AccesoProceso.nombreDispositivo
        var servicios = ModeloEmparejar.Servicios(canjear: { (config: ServerConfig, codigo: String) in
            try await servicio.emparejar(config: config, codigo: codigo, nombre: nombre)
        })
        let haptica = self.haptica
        servicios.vibrar = { (tipo: TipoHaptico) in haptica.disparar(tipo) }
        servicios.anunciar = { (texto: String) in AccessibilityNotification.Announcement(texto).post() }
        let sesion = self.sesion
        // La raíz entra en la app siguiendo a `sesion.fase` (FasesDeLaSesion en RaizView): una sola vía (I1).
        servicios.alEmparejar = { (respuesta: PairingClaimResponse, servidores: [URL], _: String) in
            await sesion.emparejado(respuesta, servidores: servidores)
        }
        return ModeloEmparejar(servicios: servicios, guardadas: entorno.configuracion.leer())
    }
}

/// El contenido con el modelo ya hecho: vertical u horizontal según el tamaño medido.
private struct VistaEmparejar: View {
    let modelo: ModeloEmparejar
    let camara: CamaraQR
    let motivo: MotivoEmparejar?
    let tamano: CGSize
    let seguras: UIEdgeInsets
    @Environment(CicloVida.self) private var cicloVida
    @Environment(EstadoVentana.self) private var estadoVentana
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.openURL) private var abrirURL
    @FocusState private var focoCodigo: Bool
    @FocusState private var focoCasa: Bool
    @FocusState private var focoTailscale: Bool
    @State private var recomprobar = 0
    @State private var ir: String?

    private var horizontal: Bool { tamano.width > tamano.height }

    var body: some View {
        Group {
            if horizontal { dosColumnas } else { columna }
        }
        .onChange(of: cicloVida.fase) { _, fase in
            if fase == .activa { recomprobar += 1 }
        }
        .onChange(of: focoCodigo || focoCasa || focoTailscale) { _, alguno in
            if alguno { modelo.tocarCampo() }
        }
        .onChange(of: modelo.codigo.count) { _, cuenta in
            guard cuenta == 6, focoCodigo else { return }
            siguienteCampo()
        }
        .onChange(of: modelo.peticionFila) { _, _ in
            focoCodigo = false
            focoCasa = false
            focoTailscale = false
            ir = "ancla-fila"
        }
    }

    // MARK: Vertical

    private var altoCartel: CGFloat {
        let maquetacion = Maquetacion(ancho: Double(tamano.width), alto: Double(tamano.height), seguras: Margenes())
        return CGFloat(maquetacion.altoHeroe)
    }

    private var columna: some View {
        ScrollViewReader { lector in
            ScrollView {
                VStack(spacing: 0) {
                    cartel(CartelCamara.Medidas(
                        tamano: CGSize(width: tamano.width, height: altoCartel), lado: 232,
                        centroY: altoCartel * 0.52, arriba: seguras.top, vertical: true))
                    formulario
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                    Color.clear.frame(height: seguras.bottom + 28)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .onScrollGeometryChange(for: Bool.self) { geometria in
                geometria.contentOffset.y < altoCartel - seguras.top
            } action: { _, sobreCartel in
                estadoVentana.fondoOscuroArriba = sobreCartel
            }
            .onChange(of: ir) { _, destino in desplazar(lector, destino) }
            .onAppear { estadoVentana.fondoOscuroArriba = true }
        }
    }

    // MARK: Horizontal (a2 §22.7)

    private var ladoCamara: CGFloat { min(tamano.height - seguras.top - seguras.bottom - 32, 480) }

    private var dosColumnas: some View {
        HStack(alignment: .top, spacing: 24) {
            cartel(CartelCamara.Medidas(
                tamano: CGSize(width: ladoCamara, height: ladoCamara), lado: min(232, ladoCamara - 96),
                centroY: ladoCamara / 2, arriba: 0, vertical: false))
                .padding(.top, 16 + seguras.top)
            ScrollViewReader { lector in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        CabeceraVista("Emparejar", ocultarMotor: true) { EmptyView() }
                            .environment(\.modoDemo, false)
                            .padding(.top, -4)
                        formulario
                        Color.clear.frame(height: seguras.bottom + 28)
                    }
                    .padding(.top, seguras.top)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: ir) { _, destino in desplazar(lector, destino) }
            }
        }
        .padding(.leading, seguras.left + 16)
        .padding(.trailing, seguras.right + 16)
        .onAppear { estadoVentana.fondoOscuroArriba = false }
    }

    // MARK: Piezas

    private func cartel(_ medidas: CartelCamara.Medidas) -> some View {
        CartelCamara(
            modelo: modelo, camaraQR: camara, medidas: medidas, recomprobar: recomprobar, activa: cicloVida.fase == .activa,
            alAbrirAjustes: abrirAjustes, alEscribirCodigo: escribirCodigo)
    }

    private var formulario: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(ReglasEmparejar.entrada)
                .estilo(.cuerpo)
                .foregroundStyle(Palco.text2)
                .fixedSize(horizontal: false, vertical: true)
            if let aviso = textoAviso {
                FilaAvisoEmparejar(texto: aviso, tono: .acceso)
            }
            if let fila = modelo.fila {
                VStack(spacing: 0) {
                    anclaFila
                    FilaAvisoEmparejar(texto: fila, tono: .error)
                }
                .padding(.top, -(seguras.top + 16))
            }
            TarjetaCodigo(modelo: modelo, focoCodigo: $focoCodigo, focoCasa: $focoCasa, focoTailscale: $focoTailscale,
                          alEnviar: enviar)
                .id("tarjeta")
        }
        .animation(Movimiento.salida, value: modelo.fila)
    }

    /// Marca a 16 pt (más la zona segura) por encima de la fila de error: desplazar a ella deja la fila a 16 del
    /// borde de arriba (a2 §22.5).
    private var anclaFila: some View {
        Color.clear
            .frame(height: seguras.top + 16)
            .id("ancla-fila")
            .accessibilityHidden(true)
    }

    private var textoAviso: String? {
        guard let motivo else { return nil }
        return ReglasEmparejar.avisoAcceso(MotivoEmparejarPuro.de(motivo))
    }

    // MARK: Acciones

    private func desplazar(_ lector: ScrollViewProxy, _ destino: String?) {
        guard let destino else { return }
        withAnimation(Movimiento.estandar(reducido)) { lector.scrollTo(destino, anchor: .top) }
        ir = nil
    }

    private func enviar() {
        focoCodigo = false
        focoCasa = false
        focoTailscale = false
        Task { await modelo.emparejar() }
    }

    /// «Escribir el código»: desplaza hasta la tarjeta y pone el foco en el código (a2 §22.3.2).
    private func escribirCodigo() {
        ir = "tarjeta"
        focoCodigo = true
    }

    private func abrirAjustes() {
        if let url = URL(string: UIApplication.openSettingsURLString) { abrirURL(url) }
    }

    /// Al llegar a 6 cifras, a la primera dirección vacía; si ya hay alguna, se esconde el teclado (a2 §22.4).
    private func siguienteCampo() {
        focoCodigo = false
        if modelo.direccionCasa.trimmingCharacters(in: .whitespaces).isEmpty
            && modelo.direccionTailscale.trimmingCharacters(in: .whitespaces).isEmpty
        {
            focoCasa = true
        }
    }
}

extension MotivoEmparejarPuro {
    /// El motivo de la sesión, en puro.
    static func de(_ motivo: MotivoEmparejar) -> MotivoEmparejarPuro {
        switch motivo {
        case .olvidadoAqui: .olvidadoAqui
        case .revocadoDesdeOtro: .revocadoDesdeOtro
        case .noAutorizado: .noAutorizado
        case .dispositivoRetirado: .dispositivoRetirado
        case .llaveroIlegible: .llaveroIlegible
        }
    }
}
