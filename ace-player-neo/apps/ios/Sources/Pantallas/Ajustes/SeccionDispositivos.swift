import SwiftUI

/* Ajustes › Dispositivos en la app (a6 §8 y §8.10; devices/DevicesSection.tsx): la intro de la web, el panel
   para emparejar OTRO aparato (el QR lo dibuja el iPhone), la nota de direcciones y «Emparejados» con «Este
   iPhone» siempre la primera («Olvidar este iPhone» con segundo toque) y los demás con «Revocar». Con un
   servidor 0.8.0 (403 `origin_forbidden`) el aviso de la versión y solo la fila de este iPhone, sin botón
   (a6 §8.10.8). La lista se pide al abrir; en vivo por `devices.changed`; sondeo de 5 s solo con un código a
   la vista y sin SSE. */

struct SeccionDispositivos: View {
    @Environment(DatosApp.self) private var datos
    @Environment(SesionApp.self) private var sesion
    @Environment(Avisos.self) private var avisos
    @Environment(Haptica.self) private var haptica
    @Environment(CicloVida.self) private var cicloVida
    @Environment(\.vistaActiva) private var vistaActiva
    @Environment(\.modoDemo) private var modoDemo
    @State private var modelo: ModeloEmparejarDispositivo?
    @State private var confirmar = SegundoToque()
    @State private var ocupado: String?
    @State private var verRevocados = false
    @State private var ahora = Date.distantPast
    @State private var config = ServerConfig()

    static let intro =
        "Empareja la app de iPhone o iPad con este Ace Player Neo: ve la agenda y tus canales y reproduce desde el propio dispositivo. El código dura 5 minutos y solo sirve una vez."

    private var lista: [Device]? { datos.dispositivos.datos?.devices }
    private var esteId: String? { datos.arranque.datos?.device?.id ?? sesion.dispositivo ?? AccesoProceso.idDelToken }
    private var visible: Bool { vistaActiva && cicloVida.fase == .activa }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(Self.intro)
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, -8)
            if sesion.capacidades.servidorViejo { degradado } else { completo }
        }
        .onAppear(perform: preparar)
        .task(id: vistaActiva) { await vigilar() }
        .task(id: debeSondear) { await sondear() }
        .onChange(of: lista, initial: true) { _, nueva in if let nueva { modelo?.lista(nueva, nombres: nombre) } }
        .onChange(of: datos.dispositivos.error) { _, error in anotar(error, en: .devicesList) }
        .onChange(of: vistaActiva) { _, activa in if !activa { confirmar.desarmar() } }
    }

    // MARK: Completo (servidor 0.8.1)

    @ViewBuilder private var completo: some View {
        if let modelo {
            PanelEmparejarDispositivo(modelo: modelo, nombreEmparejado: modelo.nombreEmparejado(nombre),
                                      direcciones: config.candidatas.count)
        }
        if let nota = NotaDirecciones.de(config) {
            NotaAjustes(icono: nota.icono, aviso: nota.aviso, trozos: nota.trozos)
        }
        emparejados
    }

    private var emparejados: some View {
        let partes = ModeloDispositivos.partir(lista ?? [])
        return VStack(alignment: .leading, spacing: 12) {
            RotuloBloque(titulo: "Emparejados", dato: lista == nil ? nil : "\(partes.activos.count)", datoKicker: true)
            cuerpoLista(partes.activos)
            if !partes.revocados.isEmpty { revocados(partes.revocados) }
        }
    }

    @ViewBuilder private func cuerpoLista(_ activos: [Device]) -> some View {
        if lista != nil {
            let filas = ModeloDispositivos.conEsteIPhone(activos, esteId: esteId, delArranque: datos.arranque.datos?.device)
            if filas.isEmpty {
                FilaEnLinea(icono: .movil, tinta: Palco.text2,
                            texto: "Aún no hay ningún dispositivo emparejado. Empieza con «Emparejar un dispositivo».")
            } else {
                ListaSeparada {
                    ForEach(filas) { (d: Device) in fila(d) }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Dispositivos emparejados")
            }
        } else if let error = datos.dispositivos.error {
            FilaEnLinea(icono: .aviso, tinta: Palco.failInk, texto: "No se pudo leer la lista. \(error.mensaje)") {
                BotonPalco("Reintentar", icono: .refresh, variante: .quieto, tamano: .sm) {
                    Task { await datos.dispositivos.refrescar() }
                }
            }
        } else {
            FilasEsqueleto(2, anuncio: "Cargando los dispositivos…")
        }
    }

    private func fila(_ d: Device) -> some View {
        let este = d.id == esteId
        return FilaDispositivo(
            dispositivo: d, tipo: este ? .este : .otro, ahora: ahora, armado: confirmar.armado == d.id,
            ocupado: ocupado == d.id,
            accion: {
                confirmar.tocar(d.id, plazo: ModeloDispositivos.plazoConfirmar) {
                    Task { if este { await olvidar(d) } else { await revocar(d) } }
                }
            })
    }

    private func revocados(_ lista: [Device]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            BotonPalco(verRevocados ? "Ocultar los revocados" : "Ver los revocados (\(lista.count))", icono: .eye,
                       variante: .fantasma, tamano: .sm) { verRevocados.toggle() }
            if verRevocados {
                ListaSeparada {
                    ForEach(lista) { (d: Device) in
                        FilaDispositivo(dispositivo: d, tipo: .revocado, ahora: ahora, armado: false, ocupado: false, accion: {})
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Dispositivos revocados")
            }
        }
    }

    // MARK: Degradado (servidor 0.8.0)

    @ViewBuilder private var degradado: some View {
        AvisoVersion(frase: AvisoVersion.dispositivos)
        if let propio = datos.arranque.datos?.device {
            VStack(alignment: .leading, spacing: 12) {
                RotuloBloque(titulo: "Este iPhone")
                ListaSeparada {
                    FilaDispositivo(dispositivo: propio, tipo: .esteSinBoton, ahora: ahora, armado: false, ocupado: false,
                                    accion: {})
                }
            }
        }
    }

    // MARK: Datos, relojes y eventos

    private func preparar() {
        ahora = AccesoProceso.reloj.ahora
        config = AccesoProceso.entorno?.configuracion.leer() ?? ServerConfig()
        guard modelo == nil else { return }
        modelo = crearModelo()
    }

    private func crearModelo() -> ModeloEmparejarDispositivo {
        let datos = self.datos
        let sesion = self.sesion
        let haptica = self.haptica
        let avisos = self.avisos
        var servicios = ModeloEmparejarDispositivo.Servicios(
            crear: {
                let entorno = AccesoProceso.entorno
                let guardadas = entorno?.configuracion.leer() ?? ServerConfig()
                let activa = await entorno?.servidores.conocido()?.url
                return try await datos.crearCodigo(CuerpoCodigo.de(activa: activa, config: guardadas))
            },
            ahora: { AccesoProceso.reloj.ahora })
        servicios.cerrado = { (fallo: APIError) in sesion.anotar(fallo, en: .pairingCreate) }
        servicios.emparejado = { (nombre: String) in
            haptica.disparar(.exito)
            avisos.avisar(OpcionesDispositivo.emparejadoOtro(nombre), tono: .ok, icono: .check)
        }
        return ModeloEmparejarDispositivo(servicios: servicios)
    }

    private func nombre(_ id: String) -> String? { lista?.first { $0.id == id }?.name }

    /// Al volver a la vista: la lista de nuevo (`refetchOnMount: 'always'`), el reloj de 60 s en hora y los
    /// eventos `devices.changed` mientras se vea.
    private func vigilar() async {
        guard vistaActiva else { return }
        ahora = AccesoProceso.reloj.ahora
        modelo?.tic()
        let repartidor = AccesoProceso.repartidor
        let oyente = repartidor?.escuchar { (evento: SSEEvent) in alEvento(evento) }
        await datos.dispositivos.refrescar()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            ahora = AccesoProceso.reloj.ahora
        }
        if let oyente { repartidor?.dejarDeEscuchar(oyente) }
    }

    private func alEvento(_ evento: SSEEvent) {
        guard case .devicesChanged(let cambio) = evento else { return }
        modelo?.evento(cambio, nombres: nombre)
        Task { await datos.dispositivos.refrescar() }
    }

    /// Sondeo de respaldo: solo con código a la vista, en vivo, sin SSE, con Ajustes a la vista y la app activa.
    private var debeSondear: Bool {
        (modelo?.hayCodigo ?? false) && !modoDemo && !datos.tiempoRealAbierto && visible
    }

    private func sondear() async {
        guard debeSondear else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: ModeloDispositivos.sondeo)
            guard !Task.isCancelled else { return }
            await datos.dispositivos.refrescar()
        }
    }

    private func anotar(_ error: APIError?, en ruta: RutaAdministracion) {
        guard let error, error.codigo == "origin_forbidden" else { return }
        sesion.anotar(error, en: ruta)
    }

    // MARK: Revocar y olvidar

    private func revocar(_ d: Device) async {
        ocupado = d.id
        do {
            try await datos.revocar(dispositivo: d.id)
            avisos.avisar(OpcionesDispositivo.revocadoBien(d.name), tono: .ok, icono: .check)
        } catch {
            let fallo = APIError.desde(error)
            if fallo.codigo == "origin_forbidden" {
                anotar(fallo, en: .deviceRevoke)
                avisos.avisar(OpcionesDispositivo.revocadoMal(d.name, motivo: AvisoVersion.base), tono: .err)
            } else {
                avisos.avisar(OpcionesDispositivo.revocadoMal(d.name, motivo: fallo.mensaje), tono: .err)
            }
        }
        ocupado = nil
        await datos.dispositivos.refrescar()
    }

    /// «Olvidar este iPhone»: lo hace la sesión (marca `olvidando`, `DELETE` del propio y vuelta a emparejar sin
    /// aviso, a6 §8.10.3). Si no se pudo, el toast «No se pudo olvidar este iPhone. {motivo}» lo da la sesión
    /// (`alAvisar`, a9 §3.5.2): aquí solo vuelve el botón a reposo.
    private func olvidar(_ d: Device) async {
        ocupado = d.id
        await sesion.olvidarEsteIPhone()
        ocupado = nil
    }
}
