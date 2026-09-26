import SwiftUI

/* La portada «Agenda» (M5; a3; agenda/index.tsx): una columna que se desplaza con el héroe a sangre y la
   cabecera encima, la tira de días y el filtro, la tarjeta de primer uso, los bloques por competición y el pie.
   Tirar hacia abajo actualiza (decisión 3; el botón ⟳ de la web se queda). La portada nunca reproduce. */

struct AgendaView: View {
    @State private var modelo = ModeloAgenda()
    @Environment(DatosApp.self) private var datos
    @Environment(RelojCompartido.self) private var reloj
    @Environment(TiempoReal.self) private var tiempoReal
    @Environment(CentroHojas.self) private var hojas
    @Environment(\.vistaActiva) private var vistaActiva

    private var marcadores: [String: LiveScore] {
        guard let respuesta = datos.marcadores.datos, respuesta.available else { return [:] }
        return respuesta.scores
    }

    private var foto: FotoAgenda {
        FotoAgenda.calcular(
            agenda: datos.agenda.datos, preferencias: datos.preferencias.datos?.preferences, marcadores: marcadores,
            ahora: reloj.ahora, diaElegido: modelo.diaElegido, modoQuerido: modelo.modoQuerido)
    }

    var body: some View {
        let foto = self.foto
        ColumnaAgenda(modelo: modelo, foto: foto)
            .mira(datos.agenda)
            .mira(datos.preferencias)
            .mira(datos.biblioteca)
            .task(id: vistaActiva) { await asegurar(datos.agenda) }
            .task(id: vistaActiva) { await asegurar(datos.preferencias) }
            .task(id: vistaActiva) { await asegurar(datos.biblioteca) }
            .task(id: vistaActiva) { await relojDeLaAgenda() }
            .task(id: claveMarcadores(foto)) { await sondearMarcadores(foto) }
            .onChange(of: hojas.actual) { antes, despues in vigilarGustos(antes, despues) }
    }

    // MARK: Datos

    /// Pide la consulta si no hay datos o están caducados (la agenda caduca a los 10 min, a3 §9.7).
    private func asegurar<V: Sendable>(_ consulta: Consulta<V>) async {
        guard vistaActiva else { return }
        await consulta.asegurar(tiempoRealAbierto: tiempoReal.abierto)
    }

    /// «Ahora» avanza cada 20 s mientras la agenda se ve (a3 §9.1; data.ts TICK_MS): el tic es el del reloj
    /// compartido (M1), que corre mientras alguien lo mira. Aquí solo se mira mientras la vista está activa.
    private func relojDeLaAgenda() async {
        guard vistaActiva else { return }
        reloj.empezarAMirar()
        defer { reloj.dejarDeMirar() }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3600))  // hasta que la vista deje de verse (cancela la tarea)
        }
    }

    private func claveMarcadores(_ foto: FotoAgenda) -> String {
        "\(vistaActiva)|\(Marcadores.hacenFalta(foto.delDia, ahora: foto.ahora))|\(foto.dia ?? "")"
    }

    /// `useScores`: solo si el día que miras tiene algo en su ventana; cada 8 s con algo en juego, si no 45 s.
    private func sondearMarcadores(_ foto: FotoAgenda) async {
        guard vistaActiva, Marcadores.hacenFalta(foto.delDia, ahora: foto.ahora) else { return }
        while !Task.isCancelled {
            await datos.marcadores.refrescar()
            let espera = Marcadores.intervalo(datos.marcadores.datos?.scores)
            try? await Task.sleep(for: .seconds(espera))
        }
    }

    /// `modeAfterSaving`: si la hoja de gustos se cierra habiendo guardado, el filtro pasa a «Para ti» o «Todos».
    private func vigilarGustos(_ antes: Hoja?, _ despues: Hoja?) {
        if despues == .gustos {
            modelo.preferenciasAlAbrirGustos = datos.preferencias.actualizadaEn
        } else if antes == .gustos {
            let ahora = datos.preferencias.actualizadaEn
            if ahora != modelo.preferenciasAlAbrirGustos, let guardadas = datos.preferencias.datos?.preferences {
                modelo.modoTrasGuardar(hayGustos: ParaTi.tieneGustos(GustosFutbol(guardadas)))
            }
        }
    }
}

/// La columna que se desplaza (partes con nombre para que el compilador la tipe rápido).
private struct ColumnaAgenda: View {
    let modelo: ModeloAgenda
    let foto: FotoAgenda
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(EstadoVentana.self) private var estadoVentana
    @Environment(PresentacionReproductor.self) private var presentacion
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.vistaActiva) private var vistaActiva
    @State private var posicion = ScrollPosition(edge: .top)
    @State private var desplazamiento: Double = 0
    @State private var yTira: Double = 0

    private var hayHeroe: Bool { datos.agenda.datos == nil ? datos.agenda.error == nil : foto.destacado != nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                FilaSuperiorAgenda(modelo: modelo, foto: foto, hayHeroe: hayHeroe)
                BarraDiasAgenda(modelo: modelo, foto: foto, tiraArriba: yTira < desplazamiento + maquetacion.seguras.arriba)
                    .onGeometryChange(for: Double.self) { Double($0.frame(in: .scrollView).minY) } action: { yTira = $0 + desplazamiento }
                    .id("tira")
                PrimerUsoAgenda(modelo: modelo)
                CuerpoAgenda(modelo: modelo, foto: foto)
                PieAgenda(
                    agenda: datos.agenda.datos, cargando: datos.agenda.datos == nil && datos.agenda.error == nil,
                    error: datos.agenda.datos == nil && datos.agenda.error != nil, actualizada: datos.agenda.actualizadaEn)
            }
            .padding(.leading, CGFloat(maquetacion.rellenoIzquierdo))
            .padding(.trailing, CGFloat(maquetacion.rellenoDerecho))
            .padding(.bottom, CGFloat(maquetacion.rellenoInferiorContenido(mini: miniVisible, teatro: false)))
            .subeConLaBarraDeEstado(vistaActiva)
        }
        .scrollPosition($posicion)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Double.self) { Double($0.contentOffset.y + $0.contentInsets.top) } action: { _, nuevo in
            desplazamiento = nuevo
            publicarBarraDeEstado()
        }
        .refreshable { await datos.agenda.refrescar() }  // la háptica al soltar la da el sistema (b2 §B.7: «si no, nada»)
        .ignoresSafeArea(edges: .top)
        .background(Palco.bg.ignoresSafeArea())
        .onChange(of: navegador.subirArriba[.agenda]) { _, _ in subir() }
        .onChange(of: modelo.subirATira) { _, _ in subirATira() }
        .onChange(of: vistaActiva) { _, _ in publicarBarraDeEstado() }
        .onChange(of: hayHeroe) { _, _ in publicarBarraDeEstado() }
        .onDisappear { estadoVentana.heroeBajoBarra = false }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.pantalla("agenda"))
        .accessibilityValue(TextosPieAgenda.resumen(
            cargando: datos.agenda.datos == nil && datos.agenda.error == nil,
            error: datos.agenda.datos == nil && datos.agenda.error != nil, foto: foto))
    }

    private var miniVisible: Bool { presentacion.miniVisible(teatroVisible: false, inmersivo: false) }

    /// Barra de estado blanca mientras el héroe está debajo (a3 §4.7; b §0.4).
    private func publicarBarraDeEstado() {
        let bajo = vistaActiva && hayHeroe && maquetacion.tipo == .movil && desplazamiento < maquetacion.altoHeroe - maquetacion.seguras.arriba
        if estadoVentana.heroeBajoBarra != bajo { estadoVentana.heroeBajoBarra = bajo }
    }

    /// Tocar la pestaña activa sube arriba (decisión 3).
    private func subir() {
        withAnimation(Movimiento.estandar(false)) { posicion.scrollTo(edge: .top) }
    }

    /// Al cambiar de día con la tira por encima del borde: la página salta sin animación a la tira (a3 §6.7).
    private func subirATira() {
        let destino: Double = max(0, yTira - maquetacion.seguras.arriba - 8)
        posicion.scrollTo(y: CGFloat(destino))
    }
}

/// Fila 1: el héroe con la cabecera encima (o la cabecera sola sin héroe).
private struct FilaSuperiorAgenda: View {
    let modelo: ModeloAgenda
    let foto: FotoAgenda
    let hayHeroe: Bool
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(Avisos.self) private var avisos
    @Environment(Haptica.self) private var haptica
    @Environment(\.maquetacion) private var maquetacion

    var body: some View {
        if maquetacion.tipo == .movil {
            ZStack(alignment: .top) {
                heroe
                cabecera.padding(.top, CGFloat(maquetacion.seguras.arriba))
            }
        } else {
            // ≥ 768: la cabecera no flota; va encima, bajo la barra superior (64 + safeTop + 12; a3 §12).
            VStack(alignment: .leading, spacing: 20) {
                cabecera.padding(.top, CGFloat(maquetacion.rellenoSuperiorCabecera(agenda: true)) - 24)
                heroe
            }
        }
    }

    private var cabecera: some View {
        let entradilla = maquetacion.tipo == .tableta ? foto.dia.map { ReglasAgenda.entradilla($0, hoy: foto.hoy) } : nil
        return CabeceraAgenda(
            sobreHeroe: hayHeroe && maquetacion.tipo == .movil, entradilla: entradilla, cargando: datos.agenda.cargando
        ) {
            Task { await datos.agenda.refrescar() }
        }
    }

    @ViewBuilder private var heroe: some View {
        Group {
            if datos.agenda.datos == nil && datos.agenda.error == nil {
                HeroeEsqueleto()
            } else if let destacado = foto.destacado {
                Heroe(
                    partido: destacado, foto: foto,
                    canales: modelo.canales(destacado, biblioteca: datos.biblioteca.datos, version: datos.biblioteca.actualizadaEn),
                    origenVuelo: modelo.apertura == AperturaPartido(id: destacado.id, desdeHeroe: true)
                ) {
                    modelo.abrir(destacado, desdeHeroe: true, navegador: navegador, avisos: avisos, haptica: haptica)
                }
                .id(destacado.id)
            }
        }
    }
}

/// La tira de días y la fila del filtro (separación 12).
private struct BarraDiasAgenda: View {
    let modelo: ModeloAgenda
    let foto: FotoAgenda
    let tiraArriba: Bool
    @Environment(CentroHojas.self) private var hojas
    @Environment(Haptica.self) private var haptica
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido

    private var dias: [DiaTira] {
        foto.fechas.map { DiaTira(fecha: $0, etiqueta: ReglasAgenda.etiquetaDia($0, hoy: foto.hoy), cuenta: foto.cuentas[$0] ?? 0) }
    }

    var body: some View {
        if maquetacion.tipo == .movil {
            VStack(alignment: .leading, spacing: 12) {
                tira
                filtro
            }
        } else {
            // ≥ 768: días y filtro en la misma fila (`1fr | auto`, separación 16); la tira no va a sangre.
            HStack(spacing: 16) {
                tira
                filtro.fixedSize()
            }
        }
    }

    private var tira: some View {
        TiraDias(dias: dias, elegido: foto.dia, hoy: foto.hoy, sangrar: maquetacion.tipo == .movil) { fecha in cambiarDia(fecha) }
    }

    private var filtro: some View {
        FilaFiltro(
            modo: foto.modo, hayGustos: foto.hayGustos, paraTi: foto.paraTi, todos: foto.delDia.count,
            enDirecto: foto.enDirecto, cambiarModo: cambiarModo, editarGustos: { hojas.abrir(.gustos) })
    }

    private func cambiarDia(_ fecha: String) {
        withAnimation(Movimiento.estandar(reducido)) {
            if modelo.cambiarDia(fecha, actual: foto.dia, fechas: foto.fechas, tiraArriba: tiraArriba) {
                haptica.disparar(.seleccion)
            }
        }
    }

    private func cambiarModo(_ modo: ModoAgenda) {
        guard modo != foto.modo else { return }
        haptica.disparar(.seleccion)
        withAnimation(Movimiento.estandar(reducido)) { modelo.cambiarModo(modo) }
    }
}

/// La tarjeta de primer uso: si las preferencias existen, no están completas y no se ha descartado (a3 §11).
private struct PrimerUsoAgenda: View {
    let modelo: ModeloAgenda
    @Environment(DatosApp.self) private var datos
    @Environment(CentroHojas.self) private var hojas
    @Environment(Avisos.self) private var avisos

    private var visible: Bool {
        guard let preferencias = datos.preferencias.datos?.preferences else { return false }
        return !preferencias.onboardingComplete && !modelo.primerUsoDescartado
    }

    var body: some View {
        if visible {
            TarjetaPrimerUso(ocupado: modelo.guardando, personalizar: { hojas.abrir(.gustos) }, ahoraNo: ahoraNo)
        }
    }

    /// «Ahora no»: desaparece al momento y guarda `onboardingComplete` con los gustos que hubiera.
    private func ahoraNo() {
        modelo.primerUsoDescartado = true
        modelo.guardando = true
        let actual = datos.preferencias.datos?.preferences
        let cuerpo = ModeloGustos.cuerpo(actual, ModeloGustos.borrador(actual))
        Task {
            defer { modelo.guardando = false }
            do {
                try await datos.guardarPreferencias(cuerpo)
                let guardadas = datos.preferencias.datos?.preferences
                let hay = guardadas.map { ParaTi.tieneGustos(GustosFutbol($0)) } ?? false
                avisos.avisar(
                    hay ? "Tu agenda ya está personalizada" : "Puedes personalizar tu agenda cuando quieras", tono: .ok,
                    icono: .check)
            } catch {
                avisos.avisar(APIError.desde(error).mensaje, tono: .err)
            }
        }
    }
}
