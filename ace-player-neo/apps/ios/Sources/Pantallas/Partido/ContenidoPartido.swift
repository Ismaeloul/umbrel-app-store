import SwiftUI

/* Lo de debajo del vídeo en un partido (`MatchView` de match-center/index.tsx): la cabecera y las pestañas
   Fuentes · Partido · Datos técnicos, o el esqueleto y los vacíos si el partido no está. Al entrar, la sesión de
   fuentes resuelve y arranca la primera verificada (SesionFuentes.entrarPartido); al salir, `salirVista`. Pide
   los marcadores cada 8 s en directo (45 s si no) mientras se ve (`scoresInterval`). */

struct ContenidoPartido: View {
    let id: String
    let video = EntornoVideo()
    @Environment(RelojCompartido.self) private var reloj
    private let memoria = MemoriaPestanasTeatro.compartida

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
        .modifier(SincronizarDatosTecnicos(tipo: .partido))
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

    /// La pestaña que se ve: la elegida si está entre las de ahora (sin partido no hay «Partido»); si no, «Fuentes».
    private func seleccion(conPartido: Bool) -> PestanaTeatro {
        let elegida = memoria.partido
        if elegida == .canal || (elegida == .partido && !conPartido) { return .fuentes }
        return elegida
    }

    private func pestanas(conPartido: Bool) -> PestanasTeatro {
        var opciones = [OpcionPestanaTeatro(valor: .fuentes, titulo: "Fuentes", cuenta: cuentaFuentes)]
        if conPartido { opciones.append(OpcionPestanaTeatro(valor: .partido, titulo: "Partido")) }
        opciones.append(OpcionPestanaTeatro(valor: .datos, titulo: "Datos técnicos"))
        return PestanasTeatro(opciones: opciones, seleccion: seleccion(conPartido: conPartido), etiqueta: "Panel del partido") {
            ElegirPestanaTeatro.elegir($0, en: .partido, video: video)
        }
    }

    @ViewBuilder private func paneles(_ partido: FootballMatch?) -> some View {
        let actual = seleccion(conPartido: partido != nil)
        VStack(alignment: .leading, spacing: 0) {
            PanelMontado(visible: actual == .fuentes) {
                PanelFuentes(enPartido: true, partidoId: id, canalHash: nil, objetivoCanal: nil)
            }
            if let partido {
                PanelMontado(visible: actual == .partido) {
                    PanelPartido(partido: partido, marcador: marcador, ahora: reloj.ahora)
                }
            }
            PanelMontado(visible: actual == .datos) { SeccionDatosTecnicos() }
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

/// Cambiar de pestaña (`onChange` de TheaterTabs.tsx): háptica de selección, se apunta y el reproductor abre o
/// cierra «Datos técnicos» con ella (`setNerdOpen(next === 'datos')`).
@MainActor enum ElegirPestanaTeatro {
    static func elegir(_ pestana: PestanaTeatro, en tipo: MemoriaPestanasTeatro.Tipo, video: EntornoVideo) {
        video.haptica.disparar(.seleccion)
        MemoriaPestanasTeatro.compartida.recordar(pestana, en: tipo)
        let presentacion = video.presentacion
        if pestana == .datos && !presentacion.datosTecnicosAbiertos {
            presentacion.abrirDatosTecnicos()
        } else if pestana != .datos && presentacion.datosTecnicosAbiertos {
            presentacion.cerrarDatosTecnicos()
        }
    }
}

/// «Datos técnicos» del menú del vídeo abre esta pestaña; cerrarlo vuelve a la última que no era «Datos técnicos».
/// Al volver a un teatro con «Datos técnicos» elegida, el reproductor lo sabe.
struct SincronizarDatosTecnicos: ViewModifier {
    let tipo: MemoriaPestanasTeatro.Tipo
    @Environment(PresentacionReproductor.self) private var presentacion
    private let memoria = MemoriaPestanasTeatro.compartida

    func body(content: Content) -> some View {
        content
            .onAppear {
                if memoria.elegida(tipo) == .datos && !presentacion.datosTecnicosAbiertos {
                    presentacion.abrirDatosTecnicos()
                }
            }
            .onChange(of: presentacion.datosTecnicosAbiertos) { _, abiertos in
                memoria.datosTecnicos(abiertos: abiertos, en: tipo)
            }
    }
}
