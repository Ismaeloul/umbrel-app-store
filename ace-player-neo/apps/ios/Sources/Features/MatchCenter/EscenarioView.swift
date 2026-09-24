import AVKit
import SwiftUI
import UIKit

/* El escenario: LA superficie de reproducción de Palco, a pantalla completa
   por encima de las pestañas. Vale para un partido (centro de partido) y
   para un canal suelto. De arriba abajo: cabecera (minimizar · competición ·
   Más), el vídeo 16:9 (la única capa), el título con escudos y el marcador
   tapado, las cápsulas Señal · Dónde se emite · Más, la línea de estado, la
   fila de carteles de fuentes, «También en directo» y «Datos técnicos».

   Gestos: arrastrar el vídeo hacia abajo encoge el escenario siguiendo al
   dedo y minimiza; deslizarlo a los lados cambia de fuente (si hay dos o más
   que no estén caídas); un toque enseña/esconde los controles sin retardo y
   el doble toque abre pantalla completa. En horizontal real, solo el vídeo. */

/// Fuentes «hermanas» de un canal suelto: las candidatas del servidor por su nombre.
@MainActor
@Observable
final class HermanasModelo {
    private(set) var entradas: [EntradaFuente] = []
    private(set) var cargando = false
    @ObservationIgnored private var nombreCargado: String?

    func cargar(_ canal: CanalReproducible?, app: AppModel) async {
        guard let canal, canal.origen != "manual", nombreCargado != canal.titulo else { return }
        nombreCargado = canal.titulo
        cargando = true
        defer { cargando = false }
        let nombre = ReglasFuentes.parteCanal(canal.titulo)
        guard let resolucion = try? await app.entorno.api.enviar(API.resolver(canales: [nombre], cliente: "ios")) else {
            return
        }
        entradas = ReglasFuentes.sinDuplicados(resolucion.candidates.map { EntradaFuente($0) })
            .filter { $0.id.lowercased() != canal.id.lowercased() }
    }
}

/// Las hojas que abre el escenario.
enum HojaEscenario: Identifiable {
    case fuentes
    case reportar(EntradaFuente)
    case pegar
    case dondeSeEmite

    var id: String {
        switch self {
        case .fuentes: "fuentes"
        case .reportar(let entrada): "reportar-\(entrada.id)"
        case .pegar: "pegar"
        case .dondeSeEmite: "donde-se-emite"
        }
    }
}

struct EscenarioView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.verticalSizeClass) private var claseVertical
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    let objetivo: ObjetivoEscenario

    @State private var arrastre: CGFloat = 0
    @State private var arrastreLateral: CGFloat = 0
    @State private var eje: EjeArrastre?
    @State private var armadoMinimizar = false
    @State private var armadoFuente = 0
    @State private var controlesVisibles = true
    @State private var ultimoToque: Date?
    @State private var pantallaCompletaToques = 0
    @State private var corteNegro = false
    @State private var hoja: HojaEscenario?
    @State private var datosTecnicosAbiertos = false
    @State private var hermanas = HermanasModelo()
    @Namespace private var espacioFuentes

    private enum EjeArrastre { case vertical, horizontal }

    private var reproductor: Reproductor { app.reproductor }
    private var horizontal: Bool { claseVertical == .compact }
    private var muelle: Animation { sinMovimiento ? Muelle.reducido : Muelle.estandar }

    private var partido: FootballMatch? {
        if case .partido(let partido) = objetivo { return partido }
        return nil
    }

    private var canalSuelto: CanalReproducible? {
        if case .canal(let canal) = objetivo { return canal }
        return nil
    }

    private var centro: CentroPartidoModelo? { partido.map { app.centro(para: $0) } }
    private var marcador: LiveScore? { partido.flatMap { app.marcadores[$0.id] } }

    /// Lo que suena (o intenta sonar) es de este escenario.
    private var suenaAqui: Bool {
        switch objetivo {
        case .partido: return centro?.suenaAqui ?? false
        case .canal(let canal): return reproductor.canal?.id.lowercased() == canal.id.lowercased()
        }
    }

    private var puedeZapear: Bool {
        guard suenaAqui else { return false }
        if let centro { return centro.puedeZapear }
        return reproductor.lista.count > 1
    }

    // MARK: Cuerpo

    var body: some View {
        GeometryReader { geo in
            let alto = geo.size.height
            let bajada = GestosReproductor.desplazamientoGrande(arrastre)
            ZStack(alignment: .top) {
                (horizontal ? Color.black : Tinta.fondo)
                if horizontal {
                    pantallaCompleta(insets: geo.safeAreaInsets, alto: alto)
                } else {
                    vertical(insets: geo.safeAreaInsets, alto: alto, bajada: bajada)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipShape(RoundedRectangle(cornerRadius: GestosReproductor.radio(bajada), style: .continuous))
            .scaleEffect(sinMovimiento ? 1 : GestosReproductor.escala(bajada), anchor: UnitPoint(x: 0.5, y: 0.38))
            .offset(y: bajada)
            .shadow(color: .black.opacity(bajada > 0 ? 0.35 : 0), radius: 30, y: 20)
        }
        .ignoresSafeArea()
        .statusBarHidden(horizontal)
        .persistentSystemOverlays(horizontal ? .hidden : .automatic)
        .task(id: partido?.id) {
            guard let centro else { return }
            await centro.cargar()
        }
        .task { await app.vigilarMarcadores() }
        .task(id: canalSuelto?.id) { await hermanas.cargar(canalSuelto, app: app) }
        .onAppear { centro?.vista(abierta: true) }
        .onDisappear {
            centro?.vista(abierta: false)
            centro?.dormir()
        }
        .onChange(of: reproductor.cambiosDeFuente) { _, _ in
            // Corte a negro de medio segundo, como un cambio de canal de verdad.
            guard suenaAqui else { return }
            var transaccion = Transaction()
            transaccion.disablesAnimations = true
            withTransaction(transaccion) { corteNegro = true }
            let duracion = sinMovimiento ? 0.1 : 0.55
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(60))
                withAnimation(.easeOut(duration: duracion)) { corteNegro = false }
            }
        }
        .sheet(item: $hoja) { hoja in hojaVista(hoja) }
        .sensoryFeedback(.impact(weight: .medium), trigger: armadoMinimizar) { _, nuevo in nuevo }
        .sensoryFeedback(.impact(weight: .light), trigger: armadoFuente) { _, nuevo in nuevo != 0 }
        .sensoryFeedback(.impact(flexibility: .rigid), trigger: reproductor.cambiosDeFuente)
        .sensoryFeedback(.warning, trigger: reproductor.cambiosAutomaticos)
        .sensoryFeedback(.impact(weight: .medium), trigger: pantallaCompletaToques)
        .sensoryFeedback(.success, trigger: centro?.reportes ?? 0)
        .sensoryFeedback(.success, trigger: centro?.pegados ?? 0)
        .sensoryFeedback(.success, trigger: marcador.map { $0.home + $0.away } ?? 0) { anterior, nuevo in nuevo > anterior }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape) { minimizar() }
        .accessibilityIdentifier("reproductor-grande")
    }

    // MARK: Vertical

    private func vertical(insets: EdgeInsets, alto: CGFloat, bajada: CGFloat) -> some View {
        VStack(spacing: 0) {
            cabecera
                .padding(.top, insets.top)
                .contentShape(Rectangle())
                .simultaneousGesture(gesto(alto: alto, conZapping: false))
            video(alto: alto)
            ScrollView {
                Group {
                    if partido != nil {
                        cuerpoPartido
                    } else {
                        cuerpoCanal
                    }
                }
                .padding(.horizontal, Medida.margen)
                .padding(.top, 16)
                .padding(.bottom, insets.bottom + 40)
            }
            .scrollIndicators(.hidden)
            .opacity(GestosReproductor.opacidadCuerpo(bajada))
        }
    }

    private var cabecera: some View {
        HStack(spacing: 4) {
            Button {
                minimizar()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.title3.weight(.semibold))
                    .frame(width: Medida.toque, height: Medida.toque)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Tinta.texto)
            .accessibilityLabel("Minimizar")
            .accessibilityIdentifier("boton-minimizar")

            Spacer(minLength: 4)
            HStack(spacing: 7) {
                if enDirecto { PuntoDirecto(tamano: 6) }
                Text(tituloCabecera)
                    .font(.antetitulo)
                    .kerning(1.2)
                    .textCase(.uppercase)
                    .foregroundStyle(Tinta.texto2)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 4)

            Menu {
                menuMas
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3.weight(.semibold))
                    .frame(width: Medida.toque, height: Medida.toque)
                    .contentShape(Rectangle())
            }
            .foregroundStyle(Tinta.texto)
            .accessibilityLabel("Más")
        }
        .padding(.horizontal, 8)
        .frame(minHeight: 46)
    }

    private var enDirecto: Bool {
        guard let partido else { return suenaAqui && reproductor.fase == .reproduciendo }
        return ReglasAgenda.estado(partido, reloj: RelojMadrid(.now), marcador: marcador)?.fase == .directo
    }

    private var tituloCabecera: String {
        switch objetivo {
        case .partido(let partido):
            return partido.competition.isEmpty ? "Partido" : partido.competition
        case .canal(let canal):
            let nombre = ReglasFuentes.parteCanal(canal.titulo)
            if let categoria = categoriaCanal, !categoria.isEmpty { return "\(nombre) · \(categoria)" }
            return nombre
        }
    }

    /// Categoría del canal suelto según la biblioteca (o de dónde vino).
    private var categoriaCanal: String? {
        guard let canal = canalSuelto else { return nil }
        if let item = app.biblioteca.map({ $0.favorites + $0.web + $0.history })?.first(where: {
            $0.id.lowercased() == canal.id.lowercased()
        }), !item.category.trimmingCharacters(in: .whitespaces).isEmpty,
            !ReglasBiblioteca.categoriasVacias.contains(item.category.lowercased())
        {
            return item.category
        }
        switch canal.origen {
        case "favorites": return "Favoritos"
        case "history": return "Recientes"
        case "m3u": return "Tu lista"
        case "acestream": return "Búsqueda"
        case "manual": return "Enlace pegado"
        case "sesion": return "Otro dispositivo"
        default: return nil
        }
    }

    private var tituloCorto: String {
        switch objetivo {
        case .partido(let partido): FormatoAgenda.equipos(partido)
        case .canal(let canal): canal.titulo
        }
    }

    // MARK: El vídeo

    private func video(alto: CGFloat) -> some View {
        let rotulo = rotuloEsquina
        return ZStack {
            if suenaAqui {
                VideoApp(prioridad: .grande)
                if !app.pip.activo {
                    ControlesVideo(
                        contexto: .grande, visibles: $controlesVisibles, rotulo: rotulo.texto, rotuloEsError: rotulo.error,
                        automatico: centro?.automatico == true && centro?.entradaEnPantalla != nil, titulo: tituloCorto,
                        alMinimizar: minimizar, alPantallaCompleta: alternarPantallaCompleta)
                }
            } else {
                CajaSinReproduccion(objetivo: objetivo, centro: centro, marcador: marcador, alVer: verAhora)
            }
            pistasZapping
            if corteNegro {
                Color.black
                    .transition(.opacity)
                    .zIndex(3)
                    .allowsHitTesting(false)
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .background(Color.black)
        .offset(x: eje == .horizontal ? GestosReproductor.desplazamientoFuente(CGSize(width: arrastreLateral, height: 0)) : 0)
        .contentShape(Rectangle())
        .onTapGesture { if suenaAqui { toqueEnVideo() } }
        .gesture(gesto(alto: alto, conZapping: true))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Reproductor: \(reproductor.fase.etiqueta)")
        .accessibilityIdentifier("video-grande")
    }

    @ViewBuilder private var pistasZapping: some View {
        if puedeZapear {
            HStack {
                CapsulaPalco(texto: "Fuente anterior", tono: .neutro, icono: "chevron.left", sobreImagen: true)
                    .opacity(min(1, max(0, arrastreLateral / 90)))
                Spacer()
                CapsulaPalco(texto: "Siguiente fuente", tono: .neutro, icono: "chevron.right", sobreImagen: true)
                    .opacity(min(1, max(0, -arrastreLateral / 90)))
            }
            .padding(.horizontal, 12)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    /// «Fuente 2 · Verificada», «Sin señal», «Reconectando · fuente 2», «En otro dispositivo», «Buscando señal…».
    private var rotuloEsquina: (texto: String, error: Bool) {
        if reproductor.motivoParada == .traspaso, reproductor.conexion == .idle { return ("En otro dispositivo", false) }
        switch reproductor.fase {
        case .error:
            return ("Sin señal", true)
        case .reconectando:
            if let n = centro?.indiceEnPantalla { return ("Reconectando · fuente \(n)", false) }
            return ("Reconectando", false)
        default:
            if let centro, let entrada = centro.entradaEnPantalla, let n = centro.indiceEnPantalla {
                let efectivo = centro.efectivos()[entrada.id] ?? Efectivo(estado: nil, motivo: "", reportada: false)
                return ("Fuente \(n) · \(ReglasFuentes.senal(efectivo, entrada).palabra)", false)
            }
            if canalSuelto != nil, let canal = reproductor.canal {
                return (ReglasFuentes.proveedor(canal.titulo).isEmpty ? "En directo" : ReglasFuentes.proveedor(canal.titulo), false)
            }
            return ("Buscando señal…", false)
        }
    }

    // MARK: Gestos

    /// Arrastrar hacia abajo minimiza; de lado (solo sobre el vídeo) cambia de fuente.
    private func gesto(alto: CGFloat, conZapping: Bool) -> some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .onChanged { valor in
                let t = valor.translation
                if eje == nil {
                    eje = conZapping && puedeZapear && abs(t.width) > abs(t.height) ? .horizontal : .vertical
                }
                if eje == .horizontal {
                    arrastreLateral = t.width
                    armadoFuente = GestosReproductor.armadoFuente(t)
                } else {
                    arrastre = t.height
                    armadoMinimizar = GestosReproductor.desplazamientoGrande(t.height) > GestosReproductor.bajadaArmada
                }
            }
            .onEnded { valor in
                let ejeFinal = eje
                eje = nil
                armadoMinimizar = false
                armadoFuente = 0
                if ejeFinal == .horizontal {
                    let paso = GestosReproductor.alSoltarFuente(
                        traslacion: valor.translation, prevista: valor.predictedEndTranslation)
                    withAnimation(muelle) { arrastreLateral = 0 }
                    if paso != 0 { zapear(paso) }
                    return
                }
                let minimiza = GestosReproductor.alSoltarGrande(
                    traslacion: valor.translation.height, prevista: valor.predictedEndTranslation.height, alto: alto)
                if minimiza {
                    minimizar()
                } else {
                    withAnimation(muelle) { arrastre = 0 }
                }
            }
    }

    /// Un toque enseña o esconde los controles al instante; dos seguidos (280 ms), pantalla completa.
    private func toqueEnVideo() {
        let ahora = Date()
        if let anterior = ultimoToque, ahora.timeIntervalSince(anterior) < 0.28 {
            ultimoToque = nil
            // El primer toque ya cambió los controles: se deshace y se va a pantalla completa.
            controlesVisibles.toggle()
            pantallaCompletaToques += 1
            alternarPantallaCompleta()
            return
        }
        ultimoToque = ahora
        controlesVisibles.toggle()
    }

    private func zapear(_ paso: Int) {
        if let centro {
            centro.elegirSiguiente(paso)
        } else {
            reproductor.cambiarCanal(paso)
        }
    }

    private func minimizar() {
        if horizontal { Orientacion.pedir(.portrait) }
        app.cerrarEscenario()
    }

    private func alternarPantallaCompleta() {
        Orientacion.pedir(horizontal ? .portrait : .landscape)
    }

    private func verAhora() {
        switch objetivo {
        case .partido(let partido):
            app.verPartido(partido)
        case .canal(let canal):
            app.reproducirCanal(canal, lista: reproductor.lista)
            reproductor.expandir()
        }
    }

    // MARK: Horizontal (pantalla completa)

    private func pantallaCompleta(insets: EdgeInsets, alto: CGFloat) -> some View {
        let rotulo = rotuloEsquina
        return ZStack {
            if suenaAqui {
                VideoApp(prioridad: .grande)
                if !app.pip.activo {
                    ControlesVideo(
                        contexto: .completa, visibles: $controlesVisibles, rotulo: rotulo.texto,
                        rotuloEsError: rotulo.error, titulo: tituloCorto, alMinimizar: minimizar,
                        alPantallaCompleta: alternarPantallaCompleta
                    )
                    .padding(.leading, insets.leading)
                    .padding(.trailing, insets.trailing)
                    .padding(.bottom, insets.bottom)
                }
            } else {
                CajaSinReproduccion(objetivo: objetivo, centro: centro, marcador: marcador, alVer: verAhora)
                    .overlay(alignment: .topTrailing) {
                        Button {
                            minimizar()
                        } label: {
                            Image(systemName: "chevron.down").font(.headline)
                        }
                        .botonCristal()
                        .padding(.top, 14)
                        .padding(.trailing, insets.trailing + 18)
                        .accessibilityLabel("Minimizar")
                        .accessibilityIdentifier("boton-minimizar")
                    }
            }
            pistasZapping
            VStack {
                Spacer()
                LineaEstado(sobreVideo: true)
                    .padding(.bottom, insets.bottom + 78)
            }
            if corteNegro {
                Color.black.transition(.opacity).zIndex(3).allowsHitTesting(false)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { if suenaAqui { toqueEnVideo() } }
        .gesture(gesto(alto: alto, conZapping: true))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Reproductor: \(reproductor.fase.etiqueta)")
        .accessibilityIdentifier("video-grande")
    }

    // MARK: Cuerpo del partido

    @ViewBuilder private var cuerpoPartido: some View {
        if let partido, let centro {
            VStack(alignment: .leading, spacing: 16) {
                tituloPartido(partido)
                    .entradaEscalonada(0)
                if let goles = app.goles[partido.id], !goles.isEmpty, golesVisibles(partido) {
                    listaGoles(goles, partido: partido)
                }
                capsulasPartido(partido, centro: centro)
                    .entradaEscalonada(1)
                estadoYAvisos(centro: centro)
                fuentes(centro: centro)
                    .entradaEscalonada(2)
                tambienEnDirecto(salvo: partido.id)
                    .entradaEscalonada(3)
                DatosTecnicos(sonda: centro.entradaEnPantalla?.sonda, abiertos: $datosTecnicosAbiertos)
                    .entradaEscalonada(4)
            }
        }
    }

    private func tituloPartido(_ partido: FootballMatch) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    EscudoView(equipo: partido.equipoLocal, tamano: 26, sombra: false)
                    Text(partido.home)
                        .lineLimit(1)
                }
                if !partido.away.isEmpty {
                    HStack(spacing: 8) {
                        EscudoView(equipo: partido.equipoVisitante, tamano: 26, sombra: false)
                        Text(partido.away)
                            .lineLimit(1)
                    }
                }
            }
            .font(.titular(.title3, peso: .heavy))
            .foregroundStyle(Tinta.texto)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity, alignment: .leading)
            if let marcador, marcador.state != "pre", marcador.state != "" {
                CapsulaMarcador(partido: partido, marcador: marcador)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(etiquetaTitulo(partido))
        .accessibilityIdentifier("cabecera-partido")
    }

    private func etiquetaTitulo(_ partido: FootballMatch) -> String {
        var partes = [FormatoAgenda.equipos(partido)]
        if let marcador, marcador.state != "pre" {
            partes.append(app.marcadorTapado(partido) ? "marcador tapado" : "\(marcador.home) a \(marcador.away)")
        }
        return partes.joined(separator: ", ")
    }

    private func golesVisibles(_ partido: FootballMatch) -> Bool {
        !app.marcadorTapado(partido)
    }

    private func listaGoles(_ goles: [Gol], partido: FootballMatch) -> some View {
        DisposicionFlujo(espacio: 14, interlineado: 6) {
            ForEach(goles) { gol in
                HStack(spacing: 5) {
                    EscudoView(
                        equipo: gol.lado == .local ? partido.equipoLocal : partido.equipoVisitante, tamano: 16, sombra: false)
                    Text(gol.minuto)
                        .font(.caption.weight(.bold).monospacedDigit())
                        .foregroundStyle(Tinta.texto)
                    Text(gol.lado == .local ? partido.home : partido.away)
                        .font(.caption)
                        .foregroundStyle(Tinta.texto2)
                        .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Gol de \(gol.lado == .local ? partido.home : partido.away), minuto \(gol.minuto)")
            }
        }
        .transition(.opacity)
        .accessibilityLabel("Goles")
    }

    private func capsulasPartido(_ partido: FootballMatch, centro: CentroPartidoModelo) -> some View {
        let resumen = centro.resumen
        return ScrollView(.horizontal) {
            HStack(spacing: 8) {
                BotonCapsula(
                    texto: "\(resumen.etiqueta.isEmpty ? "Señal" : resumen.etiqueta) · \(centro.entradas.count)",
                    tono: tono(resumen.tono), punto: resumen.tono == .ok,
                    icono: resumen.tono == .fallo ? "exclamationmark.triangle" : nil
                ) {
                    hoja = .fuentes
                }
                .hapticoSeleccion(trigger: hoja?.id)
                .accessibilityLabel("Señal: \(resumen.etiqueta.isEmpty ? "sin comprobar" : resumen.etiqueta), \(centro.entradas.count) fuentes")
                .accessibilityHint("Abre la hoja de fuentes")
                .accessibilityIdentifier("capsula-senal")
                if !partido.channels.isEmpty {
                    BotonCapsula(texto: "Dónde se emite", icono: "tv") { hoja = .dondeSeEmite }
                }
                Menu {
                    menuMas
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "ellipsis").font(.subheadline.weight(.semibold))
                        Text("Más").font(.subheadline.weight(.semibold))
                    }
                    .foregroundStyle(Tinta.texto)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 40)
                    .background(Tinta.superficie2, in: Capsule())
                }
                .accessibilityLabel("Más acciones")
            }
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -Medida.margen)
        .contentMargins(.horizontal, Medida.margen, for: .scrollContent)
    }

    private func tono(_ tono: ResumenFuentes.Tono) -> TonoCapsula {
        switch tono {
        case .ok: .ok
        case .floja: .floja
        case .fallo: .fallo
        case .comprobando: .comprobando
        case .neutro: .neutro
        }
    }

    @ViewBuilder private func estadoYAvisos(centro: CentroPartidoModelo?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            LineaEstado()
            if reproductor.cambiosAutomaticos > 0, suenaAqui, let centro, let n = centro.indiceEnPantalla, centro.automatico {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                    Text("La fuente anterior dejó de responder: has pasado a la fuente \(n) automáticamente.")
                        .fixedSize(horizontal: false, vertical: true)
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(Tinta.flojaTinta)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Tinta.floja.opacity(0.12), in: RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
                .accessibilityElement(children: .combine)
            }
        }
        .animation(muelle, value: reproductor.mensaje)
    }

    // MARK: Fuentes

    private func fuentes(centro: CentroPartidoModelo) -> some View {
        let efectivos = centro.efectivos()
        let activa = centro.entradaEnPantalla?.id
        return VStack(alignment: .leading, spacing: 8) {
            CabeceraFila(
                titulo: "Fuentes", cuenta: centro.entradas.count, subtitulo: centro.resumen.detalle,
                accion: (
                    titulo: centro.cargando ? "Rebuscando…" : "Rebuscar", icono: "arrow.clockwise", girando: centro.cargando,
                    hacer: { Task { await centro.cargar(rebuscar: true) } }
                ))
            if centro.cargando && centro.entradas.isEmpty {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Reuniendo señales…")
                        .font(.subheadline)
                        .foregroundStyle(Tinta.texto2)
                }
                .frame(minHeight: 60)
            } else if centro.entradas.isEmpty {
                Text(
                    centro.fallo
                        ?? "Todavía no hay fuentes para este partido. Se reúnen 45 minutos antes del inicio."
                )
                .font(.subheadline)
                .foregroundStyle(centro.fallo == nil ? Tinta.texto2 : Tinta.falloTinta)
                .fixedSize(horizontal: false, vertical: true)
            } else {
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(centro.entradas) { entrada in
                            let efectivo = efectivos[entrada.id] ?? Efectivo(estado: nil, motivo: "", reportada: false)
                            Button {
                                withAnimation(muelle) { centro.elegir(entrada) }
                            } label: {
                                CartelFuente(
                                    entrada: entrada, efectivo: efectivo, activa: entrada.id == activa, ancho: 160,
                                    espacio: espacioFuentes)
                            }
                            .buttonStyle(.plain)
                            .contextMenu { menuFuente(entrada, centro: centro) }
                            .accessibilityHint("Toca para ver esta fuente")
                        }
                        Button {
                            hoja = .fuentes
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: "chevron.right").font(.title3.weight(.semibold))
                                Text("Todas").font(.caption.weight(.semibold))
                            }
                            .foregroundStyle(Tinta.texto2)
                            .frame(width: 72, height: 90)
                            .background(Tinta.superficie2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Ver todas las fuentes")
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .scrollIndicators(.hidden)
                .padding(.horizontal, -Medida.margen)
                .contentMargins(.horizontal, Medida.margen, for: .scrollContent)
                .animation(muelle, value: activa)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Fuentes")
        .accessibilityIdentifier("selector-fuentes")
    }

    @ViewBuilder
    private func menuFuente(_ entrada: EntradaFuente, centro: CentroPartidoModelo) -> some View {
        Button {
            withAnimation(muelle) { centro.elegir(entrada) }
        } label: {
            Label("Ver esta fuente", systemImage: "play.fill")
        }
        Button {
            Task { await centro.corregir(entrada, correcto: true) }
        } label: {
            Label("Es el canal correcto", systemImage: "hand.thumbsup")
        }
        Button {
            Task { await centro.corregir(entrada, correcto: false) }
        } label: {
            Label("No es este canal", systemImage: "hand.thumbsdown")
        }
        Button {
            hoja = .reportar(entrada)
        } label: {
            Label("Reportar…", systemImage: "flag")
        }
        menuAbrirEn(hash: entrada.id)
    }

    @ViewBuilder
    private func menuAbrirEn(hash: String) -> some View {
        Menu {
            Button {
                if let url = URL(string: "acestream://\(hash)") { UIApplication.shared.open(url) }
            } label: {
                Label("Abrir en la app de AceStream", systemImage: "arrow.up.forward.app")
            }
            Button {
                UIPasteboard.general.string = "acestream://\(hash)"
                app.avisos.mostrar("Enlace copiado", tono: .ok)
            } label: {
                Label("Copiar enlace", systemImage: "link")
            }
        } label: {
            Label("Abrir en…", systemImage: "square.and.arrow.up")
        }
    }

    /// El menú «Más» (cabecera y cápsula).
    @ViewBuilder private var menuMas: some View {
        if let centro {
            Button {
                Task { await centro.cargar(rebuscar: true) }
            } label: {
                Label("Rebuscar señales", systemImage: "arrow.clockwise")
            }
            .disabled(centro.cargando)
        }
        Button {
            hoja = .pegar
        } label: {
            Label("Pegar un Content ID", systemImage: "doc.on.clipboard")
        }
        if let centro, let entrada = centro.entradaEnPantalla {
            Button {
                Task { await centro.corregir(entrada, correcto: true) }
            } label: {
                Label("Es el canal correcto", systemImage: "hand.thumbsup")
            }
            Button {
                hoja = .reportar(entrada)
            } label: {
                Label("Reportar la fuente en pantalla", systemImage: "flag")
            }
        }
        if let canal = reproductor.canal, suenaAqui {
            menuAbrirEn(hash: canal.id)
        }
        Button {
            withAnimation(muelle) { datosTecnicosAbiertos = true }
        } label: {
            Label("Datos técnicos", systemImage: "info.circle")
        }
        Button {
            app.pedirPestana(.ajustes)
        } label: {
            Label("Dónde se está reproduciendo", systemImage: "iphone.and.arrow.forward")
        }
        if suenaAqui {
            Button(role: .destructive) {
                app.detenerConDeshacer()
            } label: {
                Label("Detener", systemImage: "stop.fill")
            }
        }
    }

    // MARK: También en directo

    @ViewBuilder private func tambienEnDirecto(salvo id: String) -> some View {
        let reloj = RelojMadrid(.now)
        let hoy = app.agenda?.days.first { $0.date == reloj.fecha }?.matches ?? []
        let directos = ReglasAgenda.porFase(hoy, reloj: reloj, marcadores: app.marcadores).directo.filter { $0.id != id }
        if !directos.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                CabeceraFila(titulo: "También en directo", cuenta: directos.count, directo: true)
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(directos) { otro in
                            Button {
                                app.verPartido(otro)
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    TarjetaVersus(
                                        partido: otro, marcador: app.marcadores[otro.id], enDirecto: true,
                                        capsula: capsulaSenal(otro, reloj: reloj), tuEquipo: ParaTi.destacado(otro, app.gustos),
                                        enPantalla: false, compacta: true
                                    )
                                    .frame(width: 220)
                                    PieVersus(partido: otro, compacta: true)
                                        .frame(width: 220)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .scrollIndicators(.hidden)
                .padding(.horizontal, -Medida.margen)
                .contentMargins(.horizontal, Medida.margen, for: .scrollContent)
            }
        }
    }

    private func capsulaSenal(_ partido: FootballMatch, reloj: RelojMadrid) -> CapsulaSenal? {
        ReglasSenal.capsula(
            marcador: app.marcadores[partido.id], faltan: ReglasAgenda.minutosParaPartido(partido, reloj: reloj),
            resumen: app.centroCargado(partido.id)?.resumen, compacta: true)
    }

    // MARK: Cuerpo del canal suelto

    @ViewBuilder private var cuerpoCanal: some View {
        if let canal = canalSuelto {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    LogoCanal(titulo: canal.titulo, tamano: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ReglasFuentes.parteCanal(canal.titulo))
                            .font(.titular(.title3, peso: .heavy))
                            .foregroundStyle(Tinta.texto)
                            .lineLimit(2)
                        if let categoria = categoriaCanal {
                            Text(categoria)
                                .font(.subheadline)
                                .foregroundStyle(Tinta.texto2)
                        }
                    }
                    Spacer(minLength: 4)
                    botonFavorito(canal)
                }
                .entradaEscalonada(0)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("cabecera-canal")

                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        Menu {
                            menuMas
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "ellipsis").font(.subheadline.weight(.semibold))
                                Text("Más").font(.subheadline.weight(.semibold))
                            }
                            .foregroundStyle(Tinta.texto)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 40)
                            .background(Tinta.superficie2, in: Capsule())
                        }
                        .accessibilityLabel("Más acciones")
                    }
                }
                .scrollIndicators(.hidden)
                .padding(.horizontal, -Medida.margen)
                .contentMargins(.horizontal, Medida.margen, for: .scrollContent)
                .entradaEscalonada(1)

                estadoYAvisos(centro: nil)
                hermanasCanal(canal)
                    .entradaEscalonada(2)
                otrosCanales(canal)
                    .entradaEscalonada(3)
                DatosTecnicos(sonda: nil, abiertos: $datosTecnicosAbiertos)
                    .entradaEscalonada(4)
            }
        }
    }

    private func botonFavorito(_ canal: CanalReproducible) -> some View {
        let favorito = app.esFavorito(canal.id)
        return Button {
            Task { await app.alternarFavorito(id: canal.id, titulo: canal.titulo, ih: canal.ih) }
        } label: {
            Image(systemName: favorito ? "star.fill" : "star")
                .font(.title3)
                .foregroundStyle(favorito ? Tinta.oro : Tinta.texto2)
                .symbolEffect(.bounce, value: favorito)
                .frame(width: Medida.toque, height: Medida.toque)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(canal.origen == "manual")
        .sensoryFeedback(.success, trigger: favorito)
        .accessibilityLabel(favorito ? "Quitar de favoritos" : "Añadir a favoritos")
        .accessibilityIdentifier("boton-favorito")
    }

    /// Otras señales del mismo canal (candidatas del servidor por su nombre).
    @ViewBuilder private func hermanasCanal(_ canal: CanalReproducible) -> some View {
        if !hermanas.entradas.isEmpty || hermanas.cargando {
            let pantalla = EnPantalla(reproductor)
            VStack(alignment: .leading, spacing: 8) {
                CabeceraFila(titulo: "Otras señales de este canal", cuenta: hermanas.entradas.isEmpty ? nil : hermanas.entradas.count)
                if hermanas.entradas.isEmpty {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Buscando otras señales…").font(.subheadline).foregroundStyle(Tinta.texto2)
                    }
                } else {
                    ScrollView(.horizontal) {
                        LazyHStack(alignment: .top, spacing: 12) {
                            ForEach(hermanas.entradas) { entrada in
                                let efectivo = ReglasFuentes.efectivo(entrada, pantalla: pantalla, ahora: .now)
                                Button {
                                    let nuevo = entrada.canalReproducible(partido: nil)
                                    app.reproducirCanal(nuevo, lista: reproductor.lista)
                                } label: {
                                    CartelFuente(
                                        entrada: entrada, efectivo: efectivo, activa: false, ancho: 160, espacio: espacioFuentes)
                                }
                                .buttonStyle(.plain)
                                .contextMenu { menuAbrirEn(hash: entrada.id) }
                            }
                        }
                        .scrollTargetLayout()
                    }
                    .scrollTargetBehavior(.viewAligned)
                    .scrollIndicators(.hidden)
                    .padding(.horizontal, -Medida.margen)
                    .contentMargins(.horizontal, Medida.margen, for: .scrollContent)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("selector-fuentes")
        }
    }

    /// Otros canales de la misma lista (favoritos, búsqueda o lista M3U) para cambiar sin salir.
    @ViewBuilder private func otrosCanales(_ canal: CanalReproducible) -> some View {
        let otros = Array(reproductor.lista.filter { $0.id != canal.id }.prefix(30))
        if !otros.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                CabeceraFila(titulo: "Otros canales", cuenta: otros.count)
                VStack(spacing: 0) {
                    ForEach(Array(otros.enumerated()), id: \.element.id) { indice, otro in
                        if indice > 0 { Divider().padding(.leading, 62) }
                        Button {
                            withAnimation(muelle) { reproductor.reproducir(otro, origen: .usuario) }
                        } label: {
                            HStack(spacing: 12) {
                                LogoCanal(titulo: otro.titulo, tamano: 38)
                                Text(otro.titulo)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Tinta.texto)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 4)
                                Image(systemName: "play.fill")
                                    .font(.caption)
                                    .foregroundStyle(Tinta.acentoTinta)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .frame(minHeight: Medida.toque)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(EstiloFilaPulsada())
                        .contextMenu { menuAbrirEn(hash: otro.id) }
                        .accessibilityLabel("Ver \(otro.titulo)")
                    }
                }
                .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
            }
        }
    }

    // MARK: Hojas

    @ViewBuilder private func hojaVista(_ hoja: HojaEscenario) -> some View {
        switch hoja {
        case .fuentes:
            if let centro {
                HojaFuentes(centro: centro, alPegar: { cambiarHoja(a: .pegar) }, alReportar: { cambiarHoja(a: .reportar($0)) })
                    .presentationDetents([.medium, .large])
                    .presentationCornerRadius(Medida.radioHoja)
                    .presentationBackground(.regularMaterial)
            }
        case .reportar(let entrada):
            HojaReportar(entrada: entrada) { motivo in
                if let centro {
                    await centro.reportar(entrada, motivo: motivo)
                } else {
                    await reportarCanal(entrada, motivo: motivo)
                }
            }
            .presentationDetents([.medium])
            .presentationCornerRadius(Medida.radioHoja)
        case .pegar:
            HojaPegar(canal: partido?.channels.first?.name) { texto, recordar in
                if let centro { return await centro.pegar(texto, recordar: recordar) }
                guard let hash = ReglasFuentes.hashValido(texto) else {
                    app.avisos.mostrar(ReglasFuentes.textoHashNoValido, tono: .error)
                    return false
                }
                app.reproducirEnlace(hash)
                return true
            }
            .presentationDetents([.medium])
            .presentationCornerRadius(Medida.radioHoja)
        case .dondeSeEmite:
            if let partido {
                HojaDondeSeEmite(partido: partido)
                    .presentationDetents([.medium, .large])
                    .presentationCornerRadius(Medida.radioHoja)
            }
        }
    }

    /// De una hoja a otra: se cierra la actual y, cuando ha bajado, se abre la nueva.
    private func cambiarHoja(a nueva: HojaEscenario) {
        hoja = nil
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            hoja = nueva
        }
    }

    /// Reportar una señal de un canal suelto (sin partido).
    private func reportarCanal(_ entrada: EntradaFuente, motivo: SourceReportReason) async {
        let cuerpo = ReportBody(id: entrada.id, reason: motivo, title: entrada.titulo, source: entrada.origen, ih: entrada.ih)
        do {
            _ = try await app.entorno.api.enviar(API.reportarFuente(cuerpo))
            app.avisos.mostrar("Señal reportada: se vuelve a comprobar", tono: .ok)
        } catch {
            app.avisos.mostrar(APIError.desde(error).mensaje, tono: .error)
        }
    }
}

// MARK: - Marcador tapado

/// La cápsula del marcador: tapada («Marcador») mientras se ve ESE partido
/// hasta que se toca; si no se está viendo, se enseña tal cual. Con un gol
/// (destapada) los dígitos ruedan y la cápsula da un bote.
struct CapsulaMarcador: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    let partido: FootballMatch
    let marcador: LiveScore
    @State private var escala: CGFloat = 1

    private var viendo: Bool { app.reproductor.canal?.partido?.id == partido.id }
    private var tapado: Bool { app.marcadorTapado(partido) }

    var body: some View {
        Button {
            guard viendo else { return }
            withAnimation(sinMovimiento ? Muelle.reducido : Muelle.estandar) {
                app.destaparMarcador(partido.id, tapado)
            }
        } label: {
            HStack(spacing: 8) {
                if viendo, marcador.state == "in" {
                    Image(systemName: tapado ? "eye" : "eye.slash")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Tinta.texto2)
                }
                if tapado {
                    Text("Marcador")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Tinta.texto)
                } else {
                    HStack(spacing: 4) {
                        Text("\(marcador.home)")
                            .contentTransition(.numericText(value: Double(marcador.home)))
                        Text("–").foregroundStyle(Tinta.texto3)
                        Text("\(marcador.away)")
                            .contentTransition(.numericText(value: Double(marcador.away)))
                    }
                    .font(.titular(.title2, peso: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(Tinta.texto)
                }
                Text(Marcador.reloj(marcador))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(marcador.state == "in" ? Tinta.directo : Tinta.texto3)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: Medida.toque)
            .background(Tinta.superficie2, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!viendo || marcador.state != "in")
        .scaleEffect(escala)
        .animation(sinMovimiento ? nil : Muelle.heroe, value: marcador)
        .sensoryFeedback(.impact(weight: .light), trigger: tapado)
        .onChange(of: marcador.home + marcador.away) { anterior, nuevo in
            guard nuevo > anterior, !tapado, !sinMovimiento else { return }
            Task { @MainActor in
                withAnimation(.easeOut(duration: 0.18)) { escala = 1.14 }
                try? await Task.sleep(for: .milliseconds(180))
                withAnimation(Muelle.heroe) { escala = 1 }
            }
        }
        .accessibilityLabel(
            tapado
                ? "Marcador tapado. Toca para verlo (puede haber goles que aún no has visto)"
                : "Marcador \(marcador.home) a \(marcador.away), \(Marcador.reloj(marcador))"
        )
        .accessibilityHint(viendo && marcador.state == "in" ? (tapado ? "Destapa el marcador" : "Vuelve a tapar el marcador") : "")
        .accessibilityIdentifier("capsula-marcador")
    }
}

// MARK: - Sin reproducción

/// Lo que ocupa el sitio del vídeo mientras no suena este partido o canal:
/// la hora en grande y «Ver el canal ahora», «Ahora suena…» y «Ver esto
/// aquí», o «Reproducción detenida» y «Volver a ver».
struct CajaSinReproduccion: View {
    @Environment(AppModel.self) private var app
    let objetivo: ObjetivoEscenario
    let centro: CentroPartidoModelo?
    let marcador: LiveScore?
    let alVer: () -> Void

    private var partido: FootballMatch? {
        if case .partido(let partido) = objetivo { return partido }
        return nil
    }

    var body: some View {
        ZStack {
            if let partido {
                FondoVersus(
                    eleccion: ColoresVersus.elegir(
                        local: partido.homeTeam?.colors, visitante: partido.awayTeam?.colors, nombreLocal: partido.home,
                        nombreVisitante: partido.away.isEmpty ? partido.title : partido.away)
                )
                .opacity(0.55)
            } else {
                Tinta.fondoHundido
            }
            Color.black.opacity(0.5)
            VStack(spacing: 10) {
                contenido
            }
            .padding(16)
            .foregroundStyle(.white)
            .environment(\.colorScheme, .dark)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var contenido: some View {
        let otroSuena = app.reproductor.canal != nil
        if let partido, let centro {
            let estado = ReglasAgenda.estado(partido, reloj: RelojMadrid(.now), marcador: marcador)
            if estado?.fase == .terminado || marcador?.state == "post" {
                Text("Final")
                    .font(.titular(.largeTitle, peso: .heavy))
                Text("Este partido ya ha terminado.")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.8))
                if !centro.entradas.isEmpty { botonVer("Volver a ver", icono: "play.fill") }
            } else if estado?.fase != .directo, marcador?.state != "in" {
                Text(partido.time)
                    .font(.system(size: 44, weight: .heavy).width(.expanded).monospacedDigit())
                Text(estado?.texto ?? FormatoAgenda.etiqueta(dia: partido.date))
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.8))
                botonVer("Ver el canal ahora", icono: "tv")
            } else if otroSuena {
                Text("Ahora suena «\(app.reproductor.canal?.partido?.titulo ?? app.reproductor.canal?.titulo ?? "")»")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.8))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                botonVer("Ver esto aquí", icono: "play.fill")
            } else if centro.cargando && centro.entradas.isEmpty {
                ProgressView().tint(.white)
                Text("Buscando fuentes…")
                    .font(.subheadline.weight(.medium))
            } else if let fallo = centro.fallo, centro.entradas.isEmpty {
                Image(systemName: "exclamationmark.triangle").font(.title2).foregroundStyle(Tinta.floja)
                Text(fallo).font(.footnote).multilineTextAlignment(.center)
                Button("Reintentar") { Task { await centro.cargar(rebuscar: true) } }
                    .botonOro()
            } else if centro.entradas.isEmpty {
                Image(systemName: "antenna.radiowaves.left.and.right.slash").font(.title2)
                Text("No hay fuentes para este partido todavía")
                    .font(.subheadline.weight(.medium))
                    .multilineTextAlignment(.center)
            } else if centro.automatico && !centro.terminado {
                ProgressView(value: centro.progreso).tint(Tinta.oro).frame(maxWidth: 180)
                Text("Esperando una fuente verificada…")
                    .font(.subheadline.weight(.medium))
                botonVer("Ver ahora", icono: "play.fill")
            } else {
                Text("Reproducción detenida")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.8))
                botonVer("Volver a ver", icono: "play.fill")
            }
        } else if otroSuena {
            Text("Ahora suena «\(app.reproductor.canal?.partido?.titulo ?? app.reproductor.canal?.titulo ?? "")»")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.8))
                .lineLimit(2)
                .multilineTextAlignment(.center)
            botonVer("Ver esto aquí", icono: "play.fill")
        } else {
            Text("Reproducción detenida")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white.opacity(0.8))
            botonVer("Volver a ver", icono: "play.fill")
        }
    }

    private func botonVer(_ texto: String, icono: String) -> some View {
        Button(action: alVer) {
            Label(texto, systemImage: icono)
                .font(.subheadline.weight(.bold))
                .padding(.horizontal, 6)
                .frame(minHeight: Medida.toque)
        }
        .botonOro()
        .accessibilityIdentifier("boton-ver-ahora")
    }
}

// MARK: - Datos técnicos

/// Lo único con números y hash, plegado por defecto.
struct DatosTecnicos: View {
    @Environment(AppModel.self) private var app
    let sonda: SondaFuente?
    @Binding var abiertos: Bool

    var body: some View {
        let reproductor = app.reproductor
        DisclosureGroup(isExpanded: $abiertos) {
            VStack(spacing: 0) {
                fila("Pares", valor: reproductor.estadisticas.map { "\($0.peers)" } ?? sonda.map { "\(Int($0.pares))" } ?? "—")
                fila("Bajada", valor: reproductor.estadisticas.map { String(format: "%.2f MB/s", $0.speedDown / 1000).replacingOccurrences(of: ".", with: ",") } ?? "—")
                fila("Colchón", valor: segundos(reproductor.motor.colchonPorDelante))
                fila("Retraso", valor: reproductor.directo.disponible ? (reproductor.directo.retraso < 1 ? "en directo" : segundos(reproductor.directo.retraso)) : "—")
                fila("Primera imagen", valor: reproductor.primeraImagenMs.map { String(format: "%.1f s", $0 / 1000).replacingOccurrences(of: ".", with: ",") } ?? "—")
                fila("Resolución", valor: [ReglasFuentes.calidad(sonda), sonda.map { $0.codec.uppercased() }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ").ifVacio("—"))
                fila("Reconexiones", valor: "\(reproductor.reconexiones)")
                fila("Hash", valor: reproductor.canal.map { String($0.id.prefix(12)) + "…" } ?? "—")
            }
            .padding(.top, 8)
        } label: {
            Label("Datos técnicos", systemImage: "info.circle")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Tinta.texto2)
        }
        .tint(Tinta.texto2)
        .accessibilityIdentifier("datos-tecnicos")
    }

    private func fila(_ nombre: String, valor: String) -> some View {
        HStack {
            Text(nombre)
                .font(.footnote)
                .foregroundStyle(Tinta.texto2)
            Spacer()
            Text(valor)
                .font(.footnote.weight(.semibold).monospacedDigit())
                .foregroundStyle(Tinta.texto)
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
    }

    private func segundos(_ valor: Double) -> String {
        valor.isFinite ? "\(Int(valor.rounded())) s" : "—"
    }
}

extension String {
    /// La cadena, o `alternativa` si está vacía.
    func ifVacio(_ alternativa: String) -> String {
        isEmpty ? alternativa : self
    }
}
