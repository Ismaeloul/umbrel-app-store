import SwiftUI

/* Ajustes › Salud del sistema (a6 §9 y §9.6; health/HealthSection.tsx): el resumen con «Volver a comprobar», los
   avisos del backend, la rejilla de servicios (1 columna a 390, 3 en horizontal), «Fuentes con fallos» y el
   registro. Se pide al abrir y con «Volver a comprobar»; sin sondeos. Con un servidor 0.8.0 (`health` → 403) el
   aviso de la versión sustituye al resumen y no hay avisos ni rejilla; las fuentes y el registro se quedan. */

struct SeccionSalud: View {
    @Environment(DatosApp.self) private var datos
    @Environment(SesionApp.self) private var sesion
    @Environment(Avisos.self) private var avisos
    @Environment(\.vistaActiva) private var vistaActiva
    @Environment(\.modoDemo) private var modoDemo
    @Environment(\.maquetacion) private var maquetacion
    @State private var ahora = Date.distantPast
    @State private var confirmar = SegundoToque()
    @State private var reiniciando = false

    private var salud: HealthResponse? { datos.salud.datos }
    private var viejo: Bool { sesion.capacidades.servidorViejo || datos.salud.error?.codigo == "origin_forbidden" }
    private var comprobando: Bool { datos.salud.cargando || datos.diagnosticos.cargando }

    var body: some View {
        Group {
            if !viejo, salud == nil, datos.salud.error != nil {
                EstadoVacio(titulo: "No se pudo leer la salud", texto: "Vuelve a comprobar cuando el NAS esté accesible.",
                            error: true) {
                    BotonPalco("Volver a comprobar", icono: .refresh, variante: .primario, ocupado: comprobando) {
                        Task { await volverAComprobar() }
                    }
                }
            } else {
                contenido
            }
        }
        .task(id: vistaActiva) { await vigilar() }
        .onChange(of: datos.salud.error) { _, error in
            if let error, error.codigo == "origin_forbidden" { sesion.anotar(error, en: .health) }
        }
        .onChange(of: vistaActiva) { _, activa in if !activa { confirmar.desarmar() } }
    }

    private var contenido: some View {
        VStack(alignment: .leading, spacing: 20) {
            arriba
            if !viejo {
                if let avisosBackend = salud?.warnings, !avisosBackend.isEmpty { avisosDelBackend(avisosBackend) }
                rejilla
            }
            fuentes
            RegistroFallos(todas: datos.diagnosticos.datos, errorTodas: datos.diagnosticos.error,
                           cuentasSalud: salud?.diagnostics.counts24h, nombres: nombres, ahora: ahora,
                           reintentar: { Task { await datos.diagnosticos.refrescar() } })
        }
    }

    // MARK: Arriba

    /// Resumen y «Volver a comprobar»: en la misma fila en horizontal (≥ 768); a 390 el botón baja a su línea.
    @ViewBuilder private var arriba: some View {
        if maquetacion.tipo == .tableta {
            HStack(alignment: .center, spacing: 12) { cabezaResumen; botonComprobar }
        } else {
            VStack(alignment: .leading, spacing: 12) { cabezaResumen; botonComprobar }
        }
    }

    @ViewBuilder private var cabezaResumen: some View {
        if viejo {
            AvisoVersion(frase: AvisoVersion.salud)
        } else if let salud, let resumen = resumen(salud) {
            ResumenSaludVista(resumen: resumen, demo: modoDemo)
        } else {
            ComprobandoSalud()
        }
    }

    private var botonComprobar: some View {
        BotonPalco("Volver a comprobar", icono: .refresh, variante: .quieto, ocupado: comprobando) {
            Task { await volverAComprobar() }
        }
    }

    private func resumen(_ salud: HealthResponse) -> ResumenSalud? {
        ModeloSalud.resumen(salud, filas: ModeloSalud.filas(salud, motorEnVivo: datos.motor.datos, ahora: ahora))
    }

    private func avisosDelBackend(_ lista: [HealthResponse.Warning]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // Por posición: el backend puede mandar dos avisos con el mismo `code`.
            ForEach(Array(lista.enumerated()), id: \.offset) { (par: (offset: Int, element: HealthResponse.Warning)) in
                let aviso = par.element
                let forma = RoundedRectangle(cornerRadius: 8, style: .circular)
                HStack(alignment: .top, spacing: 8) {
                    IconoPalco(.aviso, tamano: 18).foregroundStyle(Palco.weakInk)
                    Text(aviso.message).estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 10)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palco.weak.opacity(0.10), in: forma)
                .bordeInterior(Palco.weak.opacity(0.4), forma: forma)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Avisos")
    }

    @ViewBuilder private var rejilla: some View {
        if let salud {
            let filas = ModeloSalud.filas(salud, motorEnVivo: datos.motor.datos, ahora: ahora)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8, alignment: .top)], spacing: 8) {
                ForEach(Array(filas.enumerated()), id: \.element.id) { (par: (offset: Int, element: FilaServicio)) in
                    TarjetaServicio(fila: par.element, indice: par.offset, armado: confirmar.armado == "motor",
                                    reiniciando: reiniciando, reiniciar: tocarReiniciar)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Servicios")
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
                ForEach(0..<6, id: \.self) { (_: Int) in EsqueletoServicio() }
            }
            .accessibilityHidden(true)
        }
    }

    // MARK: Fuentes con fallos

    @ViewBuilder private var fuentes: some View {
        let grupos = RegistroSalud.porFuente(datos.diagnosticos.datos?.entries ?? [], ahora: ahora)
        if !grupos.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                RotuloBloque(titulo: "Fuentes con fallos", dato: "últimas 24 h", datoKicker: true)
                ListaSeparada {
                    ForEach(grupos) { (g: GrupoFuente) in FilaFuenteFallos(grupo: g, ahora: ahora) }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Fuentes con fallos en las últimas 24 horas")
                if let salud {
                    Text("\(TiemposSalud.plural(salud.components.scanner.cachedSources, "fuente comprobada", "fuentes comprobadas")) en caché del segundo motor.")
                        .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                        .foregroundStyle(Palco.text2)
                }
            }
        }
    }

    /// Nombres de los aparatos del registro (solo si alguna entrada trae `deviceId`, como la web).
    private var nombres: [String: String] {
        var salida: [String: String] = [:]
        for d in datos.dispositivos.datos?.devices ?? [] { salida[d.id] = d.name }
        if let propio = datos.arranque.datos?.device { salida[propio.id] = propio.name }
        return salida
    }

    // MARK: Acciones

    private func vigilar() async {
        guard vistaActiva else { return }
        ahora = datos.reloj.ahora
        let salud = datos.salud
        let registro = datos.diagnosticos
        async let pedirSalud: Void = salud.refrescar()
        async let pedirRegistro: Void = registro.refrescar()
        _ = await (pedirSalud, pedirRegistro)
        if datos.diagnosticos.datos?.entries.contains(where: { $0.deviceId != nil }) == true, !viejo {
            await datos.dispositivos.asegurar(tiempoRealAbierto: datos.tiempoRealAbierto)
        }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            ahora = datos.reloj.ahora
        }
    }

    private func volverAComprobar() async {
        let salud = datos.salud
        let registro = datos.diagnosticos
        let motor = datos.motor
        async let pedirSalud: Void = salud.refrescar()
        async let pedirRegistro: Void = registro.refrescar()
        async let pedirMotor: Void = motor.refrescar()
        _ = await (pedirSalud, pedirRegistro, pedirMotor)
    }

    private func tocarReiniciar() {
        confirmar.tocar("motor", plazo: SeccionMotor.plazo) {
            Task {
                reiniciando = true
                await SeccionMotor.reiniciar(datos: datos, avisos: avisos)
                reiniciando = false
                await datos.salud.refrescar()
            }
        }
    }
}

/// El resumen (a6 §9.1): fila de 64, relleno 12 18 12 12, radio 18, el estado al 12 % con borde al 34 %.
private struct ResumenSaludVista: View {
    let resumen: ResumenSalud
    let demo: Bool

    private var color: Color {
        switch resumen.tono {
        case .ok: Palco.ok
        case .weak: Palco.weak
        case .fail: Palco.fail
        }
    }

    private var tinta: Color {
        switch resumen.tono {
        case .ok: Palco.okInk
        case .weak: Palco.weakInk
        case .fail: Palco.failInk
        }
    }

    private var icono: NombreIcono {
        switch resumen.tono {
        case .ok: .check
        case .weak: .aviso
        case .fail: .x
        }
    }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        HStack(spacing: 12) {
            IconoPalco(icono, tamano: 20)
                .foregroundStyle(tinta)
                .frame(width: 40, height: 40)
                .background(color.opacity(0.2), in: Circle())
                .bordeInterior(tinta, ancho: 1.5, forma: Circle())
            VStack(alignment: .leading, spacing: 2) {
                titular
                Text(resumen.hechos.joined(separator: " · "))
                    .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.25))
                    .foregroundStyle(Palco.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 12)
        .padding(.leading, 12)
        .padding(.trailing, 18)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .background(color.opacity(0.12), in: forma)
        .bordeInterior(color.opacity(0.34), forma: forma)
        .accessibilityElement(children: .combine)
    }

    private var titular: some View {
        let cabeza: Text = Text(resumen.titular).foregroundStyle(Palco.text)
        let cola: Text = demo
            ? Text(" (demo)").font(Mona.fuente(17, peso: 560)).foregroundStyle(Palco.text2)
            : Text(verbatim: "")
        return Text("\(cabeza)\(cola)")
            .estilo(EstiloTexto(tamano: 17, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.25))
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Mientras no hay datos: «Comprobando el NAS y los servicios…» con pulso de opacidad 1 ↔ 0,45 cada 1,4 s.
private struct ComprobandoSalud: View {
    @Environment(\.movimientoReducido) private var reducido
    @State private var tenue = false

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        Text("Comprobando el NAS y los servicios…")
            .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.25))
            .foregroundStyle(Palco.text2)
            .opacity(tenue ? 0.45 : 1)
            .animation(reducido ? nil : .easeOut(duration: 1.4).repeatForever(autoreverses: true), value: tenue)
            .padding(.leading, 6)
            .padding(.vertical, 12)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .background(Palco.text3.opacity(0.12), in: forma)
            .bordeInterior(Palco.text3.opacity(0.34), forma: forma)
            .onAppear { tenue = !reducido }
            .accessibilityAddTraits(.updatesFrequently)
    }
}

/// Tarjeta de carga de la rejilla (a6 §1.13 `GridSkeleton`): dos barras 55 % × 18 y 80 % × 14, alto mínimo 108.
private struct EsqueletoServicio: View {
    var body: some View {
        let forma = RoundedRectangle(cornerRadius: 8, style: .circular)
        VStack(alignment: .leading, spacing: 10) {
            Esqueleto(ancho: 120, alto: 18, radio: R.s)
            Esqueleto(ancho: 180, alto: 14, radio: R.s)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 108, alignment: .topLeading)
        .background(Palco.bg, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
    }
}

/// Una fuente con fallos (a6 §9.4): nombre 15/800/125 y causas 12 a la izquierda; «3 fallos» 13/650 en
/// `--fail-ink` y «último hace 5 min» 12 a la derecha.
private struct FilaFuenteFallos: View {
    let grupo: GrupoFuente
    let ahora: Date

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(grupo.nombre).estilo(EstiloTexto(tamano: 15, peso: 800, anchura: 125, trackingEm: -0.01)).foregroundStyle(Palco.text)
                Text(grupo.causas.map { (c: DiagnosticCause) -> String in RegistroSalud.info(c).palabra }.joined(separator: " · "))
                    .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 1) {
                HStack(spacing: 0) {
                    Num("\(grupo.cuenta)", estilo: EstiloTexto(tamano: 13, peso: 650), celda: Num.celdaTexto)
                    Text(grupo.cuenta == 1 ? " fallo" : " fallos").estilo(EstiloTexto(tamano: 13, peso: 650))
                }
                .foregroundStyle(Palco.failInk)
                Text("último \(TiemposSalud.cuando(grupo.ultimo.at, ahora: ahora).relativo)")
                    .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text2)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 14)
        .frame(minHeight: 56)
        .accessibilityElement(children: .combine)
    }
}
