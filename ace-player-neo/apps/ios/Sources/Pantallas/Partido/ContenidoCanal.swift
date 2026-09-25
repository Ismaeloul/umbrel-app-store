import SwiftUI

/* Lo de debajo del vídeo en un canal suelto (`ChannelCenter` de ChannelCenter.tsx; a4 §16): la cabecera del canal
   y las pestañas «[Fuentes n] · Canal · Datos técnicos». «Fuentes» solo con hermanas (≥ 92, «Otras fuentes»,
   §0.0 punto 1); sin ellas, la pestaña «Canal» lleva el inspector y la ficha. Al entrar: la sesión de fuentes
   del canal (SesionFuentes.entrarCanal) y, si el reproductor estaba en reposo desde el inicio, suena solo.
   Aquí nunca se salta de fuente sola. */

struct ContenidoCanal: View {
    let hash: String
    let video = EntornoVideo()
    @SceneStorage("aceneo-teatro-pestana-canal") private var guardada = PestanaTeatro.fuentes.rawValue
    @State private var ultimaNormal = PestanaTeatro.fuentes

    private var biblioteca: LibraryView? { video.datos.biblioteca.datos }
    private var item: Item? { OtrasFuentes.item(biblioteca, hash: hash) }
    private var hermanas: [Item] { OtrasFuentes.hermanas(biblioteca, hash: hash) }
    private var titulo: String {
        let suena = video.reproductor.canal?.id == hash ? video.reproductor.canal?.titulo : nil
        return OtrasFuentes.titulo(item, reproductor: suena, hash: hash)
    }
    private var ih: Bool {
        if let item { return item.ih }
        guard let canal = video.reproductor.canal, canal.id == hash else { return false }
        return canal.ih == true
    }
    private var origen: String { OtrasFuentes.origen(item, biblioteca: biblioteca) }

    /// Fuentes de la sesión del canal o, mientras está vacía, sus hermanas.
    private var cuenta: Int {
        if video.fuentes.clave == "canal:\(hash)" && !video.fuentes.entradas.isEmpty { return video.fuentes.entradas.count }
        return OtrasFuentes.cuenta(hermanas)
    }

    var body: some View {
        DesplazableTeatro(pestanas: pestanas) {
            CabeceraCanal(hash: hash, titulo: titulo, origen: origen, hermanas: OtrasFuentes.cuenta(hermanas), ih: ih)
        } panel: {
            paneles
        }
        .task(id: "\(hash)-\(titulo)-\(hermanas.map(\.id).joined(separator: ","))") { await entrar() }
        .onDisappear { video.fuentes.salirVista() }
        .modifier(SincronizarDatosTecnicos(guardada: $guardada, ultimaNormal: $ultimaNormal))
    }

    private var seleccion: PestanaTeatro {
        let elegida = PestanaTeatro(rawValue: guardada) ?? .fuentes
        if elegida == .partido { return cuenta > 0 ? .fuentes : .canal }
        if elegida == .fuentes && cuenta == 0 { return .canal }
        return elegida
    }

    private var pestanas: PestanasTeatro {
        var opciones: [OpcionPestanaTeatro] = []
        if cuenta > 0 { opciones.append(OpcionPestanaTeatro(valor: .fuentes, titulo: "Fuentes", cuenta: cuenta)) }
        opciones.append(OpcionPestanaTeatro(valor: .canal, titulo: "Canal"))
        opciones.append(OpcionPestanaTeatro(valor: .datos, titulo: "Datos técnicos"))
        return PestanasTeatro(opciones: opciones, seleccion: seleccion, etiqueta: "Panel del canal") { elegir($0) }
    }

    private var objetivo: ObjetivoInspector {
        ObjetivoInspector(hash: hash, titulo: titulo, ih: ih, aprendida: false, numero: 0)
    }

    @ViewBuilder private var paneles: some View {
        let ficha = FichaCanal(hash: hash, origen: origen, hermanas: OtrasFuentes.cuenta(hermanas), ih: ih)
        VStack(alignment: .leading, spacing: 0) {
            if cuenta > 0 {
                PanelMontado(visible: seleccion == .fuentes) {
                    PanelFuentes(enPartido: false, partidoId: nil, canalHash: hash, objetivoCanal: objetivo)
                }
                PanelMontado(visible: seleccion == .canal) { ficha }
            } else {
                PanelMontado(visible: seleccion == .canal) {
                    VStack(alignment: .leading, spacing: 16) {
                        PanelFuentes(enPartido: false, partidoId: nil, canalHash: hash, objetivoCanal: objetivo)
                        ficha
                    }
                }
            }
            PanelMontado(visible: seleccion == .datos) { SeccionDatosTecnicos() }
        }
    }

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

    /// `enterChannel`: la sesión del canal con sus hermanas y, en reposo desde el inicio, suena (origen biblioteca).
    private func entrar() async {
        let datos = video.datos
        await datos.biblioteca.asegurar(tiempoRealAbierto: datos.tiempoRealAbierto)
        let coleccion: LibraryCollection? =
            switch item?.type {
            case .some(.fav): .favorites
            case .some(.recent): .history
            case .some(.web): .web
            default: nil
            }
        let canal = RefCanal(hash: hash, titulo: titulo, coleccion: coleccion, ih: item?.ih)
        await video.fuentes.entrarCanal(canal, listaActiva: biblioteca?.activeWebSourceId)
        let r = video.reproductor
        if r.fase == .idle && r.canal?.id != hash && r.motivoParada == nil {
            r.reproducir(CanalReproducible(id: hash, titulo: titulo, ih: item?.ih))
        }
    }
}
