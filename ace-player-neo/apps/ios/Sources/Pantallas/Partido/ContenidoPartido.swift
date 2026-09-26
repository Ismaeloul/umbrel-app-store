import SwiftUI

/* Lo de debajo del vídeo en un partido (`MatchView` de match-center/index.tsx): la cabecera y las pestañas
   Fuentes · Partido · Datos técnicos, o el esqueleto y los vacíos si el partido no está. Al entrar, la sesión de
   fuentes resuelve y arranca la primera verificada (SesionFuentes.entrarPartido); al salir, `salirVista`. Pide
   los marcadores cada 8 s en directo (45 s si no) mientras se ve (`scoresInterval`). */

struct ContenidoPartido: View {
    let id: String
    let video = EntornoVideo()
    @Environment(RelojCompartido.self) private var reloj
    @SceneStorage("aceneo-teatro-pestana-partido") private var guardada = PestanaTeatro.fuentes.rawValue
    @State private var ultimaNormal = PestanaTeatro.fuentes

    private var partido: FootballMatch? { BuscarPartido.en(video.datos.agenda.datos, id: id) }
    private var marcador: LiveScore? { video.datos.marcadores.datos?.scores[id] }
    private var cuentaFuentes: Int { video.fuentes.clave == "partido:\(id)" ? video.fuentes.entradas.count : 0 }

    var body: some View {
        Group {
            if let partido {
                DesplazableTeatro(pestanas: pestanas(conPartido: true)) {
                    CabeceraPartido(partido: partido, marcador: marcador, ahora: reloj.ahora)
                } panel: {
                    paneles(partido)
                }
            } else if video.datos.agenda.datos == nil && video.datos.agenda.error == nil {
                EsqueletoPartido().padding(.horizontal, 16)
                Spacer(minLength: 0)
            } else {
                sinPartido
            }
        }
        .task(id: id) { await entrar() }
        .task(id: "\(id)-\(partido != nil)") { await sondearMarcadores() }
        .onDisappear { video.fuentes.salirVista() }
        .modifier(SincronizarDatosTecnicos(guardada: $guardada, ultimaNormal: $ultimaNormal))
    }

    /// «Ya no está» o el error de la agenda; si había sesión de ese partido, debajo siguen las pestañas.
    @ViewBuilder private var sinPartido: some View {
        let error = video.datos.agenda.error != nil && video.datos.agenda.datos == nil
        let reintentar = { () -> Void in
            let agenda = video.datos.agenda
            Task { await agenda.refrescar() }
        }
        if video.fuentes.clave == "partido:\(id)" {
            DesplazableTeatro(pestanas: pestanas(conPartido: false)) {
                PartidoQueNoEsta(error: error, reintentar: reintentar)
            } panel: {
                paneles(nil)
            }
        } else {
            ScrollView { PartidoQueNoEsta(error: error, reintentar: reintentar) }
        }
    }

    private var seleccion: PestanaTeatro {
        let elegida = PestanaTeatro(rawValue: guardada) ?? .fuentes
        return elegida == .canal ? .fuentes : elegida
    }

    private func pestanas(conPartido: Bool) -> PestanasTeatro {
        var opciones = [OpcionPestanaTeatro(valor: .fuentes, titulo: "Fuentes", cuenta: cuentaFuentes)]
        if conPartido { opciones.append(OpcionPestanaTeatro(valor: .partido, titulo: "Partido")) }
        opciones.append(OpcionPestanaTeatro(valor: .datos, titulo: "Datos técnicos"))
        let actual = opciones.contains { $0.valor == seleccion } ? seleccion : .fuentes
        return PestanasTeatro(opciones: opciones, seleccion: actual, etiqueta: "Panel del partido") { elegir($0) }
    }

    @ViewBuilder private func paneles(_ partido: FootballMatch?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelMontado(visible: seleccion == .fuentes) {
                PanelFuentes(enPartido: true, partidoId: id, canalHash: nil, objetivoCanal: nil)
            }
            if let partido {
                PanelMontado(visible: seleccion == .partido) {
                    PanelPartido(partido: partido, marcador: marcador, ahora: reloj.ahora)
                }
            }
            PanelMontado(visible: seleccion == .datos) { SeccionDatosTecnicos() }
        }
    }

    /// Cambiar de pestaña: háptica de selección; «Datos técnicos» va de la mano del menú del vídeo (TheaterTabs.tsx).
    private func elegir(_ pestana: PestanaTeatro) {
        video.haptica.disparar(.seleccion)
        guardada = pestana.rawValue
        if pestana == .datos {
            video.presentacion.abrirDatosTecnicos()
        } else {
            ultimaNormal = pestana
            if video.presentacion.datosTecnicosAbiertos { video.presentacion.cerrarDatosTecnicos() }
        }
    }

    private func entrar() async {
        let datos = video.datos
        await datos.agenda.asegurar(tiempoRealAbierto: datos.tiempoRealAbierto)
        guard let partido = BuscarPartido.en(datos.agenda.datos, id: id) else { return }
        await video.fuentes.entrarPartido(partido)
    }

    /// Marcadores del partido mientras se ve: cada 8 s si está en juego, 45 s si no (`SCORES_LIVE_MS`, `SCORES_IDLE_MS`),
    /// solo en la ventana en que ESPN puede saber algo (`scoresWanted`: de 15 min antes a 3,5 h después).
    private func sondearMarcadores() async {
        let marcadores = video.datos.marcadores
        while !Task.isCancelled {
            guard let partido else { return }
            let faltan = DatosTeatro.minutosParaPartido(fecha: partido.date, hora: partido.time, ahora: reloj.ahora)
            let enVentana = faltan.map { $0 <= 15 && $0 >= -210 } ?? false
            if enVentana { await marcadores.refrescar() }
            let enJuego = marcadores.datos?.scores.values.contains { $0.state == "in" } ?? false
            try? await Task.sleep(for: .seconds(enJuego ? 8 : 45))
        }
    }
}

/// «Datos técnicos» del menú del vídeo abre esta pestaña; cerrarlo vuelve a la última que no era «Datos técnicos».
struct SincronizarDatosTecnicos: ViewModifier {
    @Binding var guardada: String
    @Binding var ultimaNormal: PestanaTeatro
    @Environment(PresentacionReproductor.self) private var presentacion

    func body(content: Content) -> some View {
        content
            .onAppear {
                if guardada == PestanaTeatro.datos.rawValue && !presentacion.datosTecnicosAbiertos {
                    presentacion.abrirDatosTecnicos()
                }
            }
            .onChange(of: presentacion.datosTecnicosAbiertos) { _, abiertos in
                let enDatos = guardada == PestanaTeatro.datos.rawValue
                if abiertos && !enDatos {
                    ultimaNormal = PestanaTeatro(rawValue: guardada) ?? .fuentes
                    guardada = PestanaTeatro.datos.rawValue
                } else if !abiertos && enDatos {
                    guardada = ultimaNormal.rawValue
                }
            }
    }
}
