import SwiftUI

/* Ajustes › Dónde se está reproduciendo (a6 §6; where-playing/WherePlayingSection.tsx): cada reproducción en
   una tarjeta hundida (relleno 16, radio 8) con la tesela del canal (71 × 40), título 17/800/125 y meta 13; la
   lista de aparatos (radio 10, `--surface`) con su icono de 36, nombre 15/650 con «Este dispositivo» en oro,
   meta 12 y el estado en cápsula sm (a 390 el estado baja bajo el texto: contenedor ≤ 340). Se pide al abrir;
   en vivo por el SSE `playback.sessions`. */

struct SeccionDonde: View {
    @Environment(DatosApp.self) private var datos
    @Environment(SesionApp.self) private var sesion
    @Environment(Navegador.self) private var navegador
    @Environment(\.vistaActiva) private var vistaActiva
    @Environment(\.modoDemo) private var modoDemo
    /// El id que dice el token del Llavero, leído una vez al aparecer (no en cada `body`).
    @State private var idDelToken: String?

    private var dispositivo: String? {
        datos.arranque.datos?.device?.id ?? sesion.dispositivo ?? idDelToken
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            contenido
            if modoDemo {
                Text("En la demo es un ejemplo: un ordenador y un iPhone viendo el mismo canal.")
                    .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onAppear { idDelToken = AccesoProceso.idDelToken(sesion.entorno) }
        .task(id: vistaActiva) {
            guard vistaActiva else { return }
            await datos.reproduccion.refrescar()
        }
    }

    @ViewBuilder private var contenido: some View {
        if let estado = datos.reproduccion.datos {
            let sesiones = ModeloDonde.visibles(estado.sessions, dispositivo: dispositivo)
            if sesiones.isEmpty {
                EstadoVacio(titulo: "No se está reproduciendo nada",
                            texto: "Cuando des al play en este navegador o en la app del iPhone, aquí verás el canal y en qué dispositivo se está viendo.") {
                    BotonPalco("Abrir la agenda", icono: .agenda, variante: .quieto) { navegador.ir(.agenda) }
                }
            } else {
                VStack(spacing: 12) {
                    ForEach(sesiones) { (s: SessionSummary) in TarjetaSesionDonde(sesion: s, dispositivo: dispositivo) }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Reproducciones en curso")
                .accessibilityValue(ModeloDonde.resumen(sesiones))
            }
        } else if let error = datos.reproduccion.error {
            EstadoVacio(titulo: "No se pudo saber qué se está reproduciendo", texto: error.mensaje, error: true) {
                BotonPalco("Reintentar", icono: .refresh, variante: .quieto) { Task { await datos.reproduccion.refrescar() } }
            }
        } else {
            FilasEsqueleto(2, anuncio: "Buscando qué se está reproduciendo…")
        }
    }
}

/// Una reproducción: cabecera con la tesela y la lista de aparatos.
private struct TarjetaSesionDonde: View {
    let sesion: SessionSummary
    let dispositivo: String?

    var body: some View {
        let titulo = ModeloDonde.titulo(sesion)
        let forma = RoundedRectangle(cornerRadius: 8, style: .circular)
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                MarcaCanal(nombre: titulo, forma: .tesela, tamano: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(titulo)
                        .estilo(EstiloTexto(tamano: 17, peso: 800, anchura: 125, trackingEm: -0.01, altoLinea: 1.25))
                        .foregroundStyle(Palco.text)
                    Text(ModeloDonde.meta(sesion))
                        .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.25))
                        .foregroundStyle(Palco.text2)
                }
            }
            VStack(spacing: 0) {
                ForEach(Array(sesion.viewers.enumerated()), id: \.offset) { (par: (offset: Int, element: SessionSummary.Viewer)) in
                    if par.offset > 0 { Rectangle().fill(Palco.lineSoft).frame(height: 1) }
                    FilaVisorDonde(visor: par.element, esEste: ModeloDonde.esEste(par.element, dispositivo: dispositivo))
                }
            }
            .background(Palco.surface, in: RoundedRectangle(cornerRadius: R.s, style: .circular))
            .bordeInterior(Palco.lineSoft, forma: RoundedRectangle(cornerRadius: R.s, style: .circular))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Dispositivos que ven \(titulo)")
        }
        .padding(16)
        .background(Palco.bg, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .accessibilityIdentifier(IDUI.sesion(sesion.id))
    }
}

/// Un aparato: icono 36, nombre y «Este dispositivo», meta y estado (debajo del texto con ≤ 340 de ancho).
private struct FilaVisorDonde: View {
    let visor: SessionSummary.Viewer
    let esEste: Bool
    @State private var ancho: CGFloat = 326

    var body: some View {
        let tipo = ModeloDonde.tipo(visor)
        HStack(alignment: ancho > 340 ? .center : .top, spacing: 12) {
            IconoPalco(tipo.icono, tamano: 20)
                .foregroundStyle(esEste ? Palco.accentInk : Palco.text2)
                .frame(width: 36, height: 36)
                .background(esEste ? Palco.accentWash : Palco.surface2, in: RoundedRectangle(cornerRadius: R.s, style: .circular))
            VStack(alignment: .leading, spacing: 6) {
                texto
                if ancho <= 340 { estado }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if ancho > 340 { estado }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(minHeight: 60)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { ancho = $0 }
        .accessibilityElement(children: .combine)
    }

    private var texto: some View {
        VStack(alignment: .leading, spacing: 2) {
            Flujo(horizontal: 8, vertical: 4) {
                Text(ModeloDonde.nombre(visor)).estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.25)).foregroundStyle(Palco.text)
                if esEste { Capsula("Este dispositivo", tono: .oro, tamano: .sm) }
            }
            Text(ModeloDonde.metaVisor(visor)).estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.25)).foregroundStyle(Palco.text2)
        }
    }

    private var estado: some View {
        let e = ModeloDonde.estado(visor)
        return Capsula(e.texto, tono: e == .reproduciendo ? .ok : .neutral, tamano: .sm, punto: e == .reproduciendo,
                       icono: e == .reproduciendo ? nil : e.icono)
    }
}
