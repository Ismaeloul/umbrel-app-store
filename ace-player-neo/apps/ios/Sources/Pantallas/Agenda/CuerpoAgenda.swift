import SwiftUI

/* El cuerpo de la agenda bajo la tira (M5; a3 §6, §10): cargando, error, los vacíos o el panel de partidos
   con el gesto de deslizar para cambiar de día y el menú de cada tarjeta (`menuFor`, seguir equipos y ligas). */

struct CuerpoAgenda: View {
    let modelo: ModeloAgenda
    let foto: FotoAgenda
    @Environment(DatosApp.self) private var datos
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(Avisos.self) private var avisos
    @Environment(Haptica.self) private var haptica
    @Environment(MarcadoresDestapados.self) private var destapados
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido

    private var cargando: Bool { datos.agenda.datos == nil && datos.agenda.error == nil }
    private var error: Bool { datos.agenda.datos == nil && datos.agenda.error != nil }

    var body: some View {
        if cargando {
            CargandoPartidos()
        } else if error {
            ErrorAgenda(
                reintentando: datos.agenda.cargando, reintentar: actualizar, irACanales: { navegador.ir(.canales(nil)) })
        } else if foto.visibles.isEmpty {
            vacio
        } else {
            panel
        }
    }

    @ViewBuilder private var vacio: some View {
        if foto.modo == .paraTi && foto.hayGustos {
            NadaDeLosTuyos(editarGustos: { hojas.abrir(.gustos) }, verTodos: { cambiarModo(.todos) })
        } else {
            DiaSinPartidos(
                haySiguiente: foto.diaSiguiente != nil, actualizando: datos.agenda.cargando,
                verSiguiente: { if let siguiente = foto.diaSiguiente { cambiarDia(siguiente) } }, actualizar: actualizar)
        }
    }

    private var panel: some View {
        PanelPartidos(grupos: foto.grupos, direccion: modelo.direccion) { partido, escalonado in
            celda(partido).modifier(AparicionEscalonada(indice: escalonado))
        }
        .id("\(foto.dia ?? "")|\(foto.modo)")
        .transition(AnyTransition.entradaLista(modelo.direccion, reducido: reducido))
        .offset(x: CGFloat(modelo.arrastre))
        .gesture(
            DeslizamientoHorizontal(
                activo: foto.fechas.count > 1,
                alMover: { dx in modelo.arrastre = GestoLateral.resistencia(Double(dx)) },
                alSoltar: { dx, dy, vx in soltar(Double(dx), Double(dy), Double(vx)) }))
    }

    private func celda(_ partido: FootballMatch) -> some View {
        let canales = modelo.canales(partido, biblioteca: datos.biblioteca.datos, version: datos.biblioteca.actualizadaEn)
        return TarjetaPartido(
            partido: partido, foto: foto, canales: canales, opciones: opciones(partido, canales: canales),
            origenVuelo: modelo.apertura == AperturaPartido(id: partido.id, desdeHeroe: false)
        ) {
            abrir(partido)
        }
    }

    // MARK: Acciones

    private func abrir(_ partido: FootballMatch) {
        modelo.abrir(partido, desdeHeroe: false, navegador: navegador, avisos: avisos, haptica: haptica)
    }

    private func actualizar() {
        Task { await datos.agenda.refrescar() }
    }

    private func cambiarDia(_ fecha: String) {
        withAnimation(Movimiento.estandar(reducido)) {
            if modelo.cambiarDia(fecha, actual: foto.dia, fechas: foto.fechas, tiraArriba: true) {
                haptica.disparar(.seleccion)
            }
        }
    }

    private func cambiarModo(_ modo: ModoAgenda) {
        guard modo != foto.modo else { return }
        haptica.disparar(.seleccion)
        withAnimation(Movimiento.estandar(reducido)) { modelo.cambiarModo(modo) }
    }

    /// Al soltar: cuenta como deslizamiento (a3 §6.7) → día siguiente o anterior; si no, vuelve con muelle.
    private func soltar(_ dx: Double, _ dy: Double, _ vx: Double) {
        let paso = GestoLateral.paso(dx: dx, dy: dy, vx: vx)
        withAnimation(Movimiento.rapido(reducido)) { modelo.arrastre = 0 }
        guard paso != 0, let destino = foto.vecino(paso) else { return }
        modelo.bloquearToques()
        cambiarDia(destino)
    }

    // MARK: Menú de la tarjeta

    private func opciones(_ partido: FootballMatch, canales: [InfoCanal]) -> [AccionMenu] {
        let estado = Destapado.estado(foto.marcadores[partido.id], destapado: destapados.destapado(partido.id))
        let menu = OpcionesPartido.menu(
            partido, disponible: canales.contains(where: \.enBiblioteca), marcador: estado,
            gustos: datos.preferencias.datos?.preferences)
        return menu.map { (item: OpcionPartido) -> AccionMenu in
            AccionMenu(item.opcion) { ejecutar(item.accion, partido) }
        }
    }

    private func ejecutar(_ accion: AccionPartido, _ partido: FootballMatch) {
        switch accion {
        case .abrir: abrir(partido)
        case .verMarcador: destapados.destapar(partido.id)
        case .taparMarcador: destapados.tapar(partido.id)
        case .seguirEquipo(let equipo): seguir(.equipos, equipo)
        case .seguirLiga(let liga): seguir(.ligas, liga)
        }
    }

    /// Seguir o dejar de seguir: guarda al momento y avisa (a3 §6.5).
    private func seguir(_ tipo: TipoGusto, _ valor: String) {
        let actual = datos.preferencias.datos?.preferences
        guard let borrador = ModeloGustos.alternarSeguir(actual, tipo, valor) else {
            let tope = tipo == .equipos ? "Ya sigues 24 equipos: quita alguno antes" : "Ya sigues 12 ligas: quita alguna antes"
            avisos.avisar(tope, tono: .warn)
            return
        }
        let seguia = tipo == .equipos ? ModeloGustos.equipoSeguido(actual, valor) != nil : ModeloGustos.ligaSeguida(actual, valor) != nil
        let cuerpo = ModeloGustos.cuerpo(actual, borrador)
        Task {
            do {
                try await datos.guardarPreferencias(cuerpo)
                avisos.avisar(seguia ? "Ya no sigues \(valor)" : "Ahora sigues \(valor)", tono: .ok)
            } catch {
                avisos.avisar(APIError.desde(error).mensaje, tono: .err)
            }
        }
    }
}
