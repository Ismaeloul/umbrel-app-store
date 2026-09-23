import SwiftUI
import UIKit

/// Centro de partido: cabecera con equipos, marcador y progreso; el
/// reproductor; acciones (favorito, rebuscar, pegar Content ID, reportar) y
/// el selector de fuentes con los mismos estados y colores que la web.
struct CentroPartidoView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.verticalSizeClass) private var claseVertical
    let modelo: CentroPartidoModelo
    @State private var pegando = false

    private var reproductor: Reproductor { app.reproductor }
    private var marcador: LiveScore? { app.marcadores[modelo.partido.id] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                CabeceraPartido(partido: modelo.partido, marcador: marcador)
                zonaReproductor
                AccionesPartido(modelo: modelo, pegando: $pegando)
                SelectorFuentes(modelo: modelo)
            }
            .padding(.horizontal, Medida.margen)
            .padding(.bottom, 24)
        }
        .background(Tinta.fondo.ignoresSafeArea())
        .navigationTitle(modelo.partido.competition.isEmpty ? "Partido" : modelo.partido.competition)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await modelo.cargar(rebuscar: true) }
        .task { await modelo.cargar() }
        .task { await app.vigilarMarcadores() }
        .onAppear { modelo.vista(abierta: true) }
        .onDisappear {
            modelo.vista(abierta: false)
            modelo.dormir()
        }
        .onChange(of: claseVertical) { _, clase in
            // Girar a horizontal con el partido sonando: pantalla completa.
            if clase == .compact, modelo.suenaAqui, reproductor.conexion.enMarcha {
                reproductor.pantallaCompleta = true
            }
        }
        .sheet(isPresented: $pegando) {
            PegarContentID(modelo: modelo)
                .presentationDetents([.medium])
        }
        .accessibilityIdentifier("centro-partido")
    }

    @ViewBuilder private var zonaReproductor: some View {
        if modelo.suenaAqui {
            ReproductorIntegrado()
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
        } else {
            SinReproduccion(modelo: modelo)
        }
    }
}

// MARK: - Cabecera

struct CabeceraPartido: View {
    let partido: FootballMatch
    let marcador: LiveScore?
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    /// Marcador y hora grandes que crecen con el tamaño de letra del sistema.
    @ScaledMetric(relativeTo: .largeTitle) private var tamanoMarcador: CGFloat = 44
    @ScaledMetric(relativeTo: .largeTitle) private var tamanoHora: CGFloat = 36

    private var enDirecto: Bool { marcador?.state == "in" }
    private var terminado: Bool { marcador?.state == "post" }

    var body: some View {
        VStack(spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                equipo(partido.home)
                centro
                    .frame(minWidth: 96)
                equipo(partido.away.isEmpty ? "—" : partido.away)
            }
            progreso
            Text(estado)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(enDirecto ? Tinta.acentoTinta : Tinta.texto2)
        }
        .padding(16)
        .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(etiqueta)
        .accessibilityIdentifier("cabecera-partido")
    }

    private func equipo(_ nombre: String) -> some View {
        VStack(spacing: 8) {
            MarcaEquipo(nombre, tamano: 52)
            Text(nombre)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Tinta.texto)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var centro: some View {
        if let marcador, marcador.state != "pre" {
            VStack(spacing: 4) {
                HStack(spacing: 10) {
                    Text("\(marcador.home)")
                        .contentTransition(.numericText(value: Double(marcador.home)))
                    Text("–").foregroundStyle(Tinta.texto3)
                    Text("\(marcador.away)")
                        .contentTransition(.numericText(value: Double(marcador.away)))
                }
                .font(.system(size: tamanoMarcador, weight: .heavy).width(.compressed).monospacedDigit())
                .foregroundStyle(Tinta.texto)
                .animation(sinMovimiento ? nil : Muelle.heroe, value: marcador)
                .sensoryFeedback(.impact, trigger: marcador.home + marcador.away)
                if enDirecto {
                    AnilloDirecto(minuto: Marcador.minuto(marcador), tamano: 34)
                }
            }
        } else {
            Text(partido.time)
                .font(.system(size: tamanoHora, weight: .heavy).width(.compressed).monospacedDigit())
                .foregroundStyle(Tinta.acentoTinta)
        }
    }

    private var progreso: some View {
        let valor = Marcador.progreso(marcador, inicio: partido.inicio)
        return Capsule()
            .fill(Tinta.linea)
            .frame(height: 4)
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(enDirecto ? Tinta.acentoTinta : Tinta.texto3)
                    .scaleEffect(x: max(0.001, valor), y: 1, anchor: .leading)
            }
            .animation(sinMovimiento ? nil : Muelle.heroe, value: valor)
            .accessibilityHidden(true)
    }

    private var estado: String {
        if terminado { return marcador?.detail.isEmpty == false ? marcador?.detail ?? "Finalizado" : "Finalizado" }
        if enDirecto {
            let minuto = marcador.flatMap(Marcador.minuto).map { " · \($0)'" } ?? ""
            return "En directo\(minuto)"
        }
        let canales = partido.channels.map(\.name).joined(separator: " · ")
        let dia = FormatoAgenda.etiqueta(dia: partido.date)
        return canales.isEmpty ? "\(dia) a las \(partido.time)" : "\(dia) a las \(partido.time) · \(canales)"
    }

    private var etiqueta: String {
        var partes = [FormatoAgenda.equipos(partido)]
        if let marcador, marcador.state != "pre" { partes.append("\(marcador.home) a \(marcador.away)") }
        partes.append(estado)
        return partes.joined(separator: ", ")
    }
}

// MARK: - Sin reproducción todavía

/// Lo que ocupa el sitio del vídeo mientras no suena este partido.
struct SinReproduccion: View {
    @Environment(AppModel.self) private var app
    let modelo: CentroPartidoModelo

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous)
                .fill(Tinta.fondoHundido)
            VStack(spacing: 12) {
                contenido
            }
            .padding()
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var contenido: some View {
        if modelo.cargando && modelo.entradas.isEmpty {
            ProgressView()
            Text("Buscando fuentes…")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Tinta.texto2)
        } else if let fallo = modelo.fallo, modelo.entradas.isEmpty {
            Image(systemName: "exclamationmark.triangle")
                .font(.title2)
                .foregroundStyle(Tinta.falloTinta)
            Text(fallo)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(Tinta.texto2)
            Button("Reintentar") { Task { await modelo.cargar(rebuscar: true) } }
                .buttonStyle(.borderedProminent)
        } else if modelo.entradas.isEmpty {
            Image(systemName: "antenna.radiowaves.left.and.right.slash")
                .font(.title2)
                .foregroundStyle(Tinta.texto3)
            Text("No hay fuentes para este partido todavía")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Tinta.texto2)
                .multilineTextAlignment(.center)
        } else {
            if app.reproductor.canal != nil && !modelo.suenaAqui {
                Text("Ahora suena otra cosa")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Tinta.texto2)
            } else if modelo.automatico && !modelo.terminado {
                ProgressView(value: modelo.progreso)
                    .frame(maxWidth: 180)
                Text("Esperando una fuente verificada…")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Tinta.texto2)
            }
            Button {
                modelo.verMejor()
            } label: {
                Label("Ver ahora", systemImage: "play.fill")
                    .font(.headline)
                    .frame(minHeight: Medida.toque)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("boton-ver-ahora")
        }
    }
}

// MARK: - Acciones

struct AccionesPartido: View {
    @Environment(AppModel.self) private var app
    let modelo: CentroPartidoModelo
    @Binding var pegando: Bool

    private var enPantalla: CanalReproducible? {
        modelo.suenaAqui ? app.reproductor.canal : nil
    }

    private var entradaEnPantalla: EntradaFuente? {
        guard let canal = enPantalla else { return nil }
        return modelo.entradas.first { $0.id == canal.id }
    }

    var body: some View {
        let favorito = enPantalla.map { app.esFavorito($0.id) } ?? false
        HStack(spacing: 10) {
            Button {
                guard let canal = enPantalla else { return }
                Task { await app.alternarFavorito(id: canal.id, titulo: canal.titulo, ih: canal.ih) }
            } label: {
                Label("Favorito", systemImage: favorito ? "star.fill" : "star")
                    .symbolEffect(.bounce, value: favorito)
            }
            .disabled(enPantalla == nil)
            .sensoryFeedback(.success, trigger: favorito)
            .accessibilityLabel(favorito ? "Quitar de favoritos" : "Añadir a favoritos")
            .accessibilityIdentifier("boton-favorito")

            Button {
                Task { await modelo.cargar(rebuscar: true) }
            } label: {
                Label("Rebuscar", systemImage: "arrow.clockwise")
                    .symbolEffect(.pulse, isActive: modelo.cargando)
            }
            .disabled(modelo.cargando)
            .accessibilityLabel("Rebuscar fuentes")

            Button {
                pegando = true
            } label: {
                Label("Pegar ID", systemImage: "doc.on.clipboard")
            }
            .accessibilityLabel("Pegar un Content ID")
            .accessibilityIdentifier("boton-pegar")

            Menu {
                ForEach(ReglasFuentes.motivosReporte) { opcion in
                    Button(opcion.texto) {
                        guard let entrada = entradaEnPantalla else { return }
                        Task { await modelo.reportar(entrada, motivo: opcion.motivo) }
                    }
                }
            } label: {
                Label("Reportar", systemImage: "flag")
            }
            .disabled(entradaEnPantalla == nil)
            .accessibilityLabel("Reportar la fuente que suena")
        }
        .labelStyle(.iconOnly)
        .font(.title3)
        .buttonStyle(.bordered)
        .controlSize(.large)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Selector de fuentes

struct SelectorFuentes: View {
    @Environment(AppModel.self) private var app
    let modelo: CentroPartidoModelo
    @Namespace private var gota

    var body: some View {
        // Se recalcula con cada cambio del reproductor (la que suena manda).
        let efectivos = modelo.efectivos()
        let activa = modelo.suenaAqui ? app.reproductor.canal?.id : nil
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Fuentes")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Tinta.texto)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Text(modelo.automatico ? "Automático" : "Manual")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Tinta.texto2)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Tinta.superficie2, in: Capsule())
                    .accessibilityLabel(modelo.automatico ? "La app elige la fuente" : "Fuente elegida a mano")
            }
            if !modelo.terminado, modelo.trabajo != nil {
                VStack(alignment: .leading, spacing: 4) {
                    ProgressView(value: modelo.progreso)
                        .tint(Tinta.acentoTinta)
                    Text(textoProgreso)
                        .font(.caption)
                        .foregroundStyle(Tinta.texto2)
                }
                .accessibilityElement(children: .combine)
            }
            if modelo.cargando && modelo.entradas.isEmpty {
                ForEach(0..<3, id: \.self) { _ in
                    FilaFuente(
                        entrada: EntradaFuente(id: "x", titulo: "Canal de ejemplo --> Proveedor", ih: false, origen: "m3u", canal: ""),
                        efectivo: Efectivo(estado: nil, motivo: "", reportada: false), activa: false, gota: gota)
                }
                .redacted(reason: .placeholder)
            } else {
                ForEach(modelo.entradas) { entrada in
                    let efectivo = efectivos[entrada.id] ?? Efectivo(estado: nil, motivo: "", reportada: false)
                    Button {
                        withAnimation(Muelle.estandar) { modelo.elegir(entrada) }
                    } label: {
                        FilaFuente(entrada: entrada, efectivo: efectivo, activa: entrada.id == activa, gota: gota)
                    }
                    .buttonStyle(.plain)
                    .contextMenu { menu(entrada) }
                    .accessibilityHint("Toca para ver esta fuente")
                }
            }
        }
        .animation(Muelle.estandar, value: activa)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Fuentes")
        .accessibilityIdentifier("selector-fuentes")
    }

    private var textoProgreso: String {
        guard let trabajo = modelo.trabajo else { return "" }
        let total = max(trabajo.total, modelo.entradas.count)
        return "Comprobando \(trabajo.checked) de \(total) · \(trabajo.playable) con señal"
    }

    @ViewBuilder
    private func menu(_ entrada: EntradaFuente) -> some View {
        Button {
            Task { await modelo.corregir(entrada, correcto: true) }
        } label: {
            Label("Es el canal correcto", systemImage: "hand.thumbsup")
        }
        Button {
            Task { await modelo.corregir(entrada, correcto: false) }
        } label: {
            Label("No es este canal", systemImage: "hand.thumbsdown")
        }
        Menu {
            ForEach(ReglasFuentes.motivosReporte) { opcion in
                Button(opcion.texto) { Task { await modelo.reportar(entrada, motivo: opcion.motivo) } }
            }
        } label: {
            Label("Reportar", systemImage: "flag")
        }
        Button {
            UIPasteboard.general.string = entrada.id
            app.avisos.mostrar("Content ID copiado", tono: .ok)
        } label: {
            Label("Copiar Content ID", systemImage: "doc.on.doc")
        }
    }
}

/// Una fuente: medidor + palabra, nombre, frase y origen. La activa lleva la gota.
struct FilaFuente: View {
    let entrada: EntradaFuente
    let efectivo: Efectivo
    let activa: Bool
    let gota: Namespace.ID

    var body: some View {
        let senal = ReglasFuentes.senal(efectivo, entrada)
        HStack(alignment: .center, spacing: 12) {
            MedidorSenal(senal.estado, palabra: senal.palabra)
                .frame(width: 104, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(ReglasFuentes.parteCanal(entrada.titulo))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Tinta.texto)
                    .lineLimit(1)
                Text(detalle)
                    .font(.caption)
                    .foregroundStyle(Tinta.texto2)
                    .lineLimit(2)
            }
            Spacer(minLength: 4)
            if activa {
                Image(systemName: "speaker.wave.2.fill")
                    .foregroundStyle(Tinta.acentoTinta)
                    .symbolEffect(.variableColor.iterative, options: .repeating)
                    .accessibilityHidden(true)
            }
        }
        .padding(12)
        .frame(minHeight: Medida.toque)
        .background {
            RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous)
                .fill(Tinta.superficie)
            if activa {
                RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous)
                    .strokeBorder(Tinta.acentoBorde, lineWidth: 2)
                    .matchedGeometryEffect(id: "fuente-activa", in: gota)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(ReglasFuentes.nombreVisible(entrada)). \(senal.palabra). \(detalle)")
        .accessibilityAddTraits(activa ? [.isSelected, .isButton] : [.isButton])
        .accessibilityIdentifier("fuente-\(entrada.id.prefix(8))")
    }

    private var detalle: String {
        var partes: [String] = []
        let proveedor = ReglasFuentes.proveedor(entrada.titulo)
        if !proveedor.isEmpty { partes.append(proveedor) }
        partes.append(ReglasFuentes.detalle(efectivo, entrada))
        if entrada.aprendida == .correct { partes.append("confirmada") }
        return partes.joined(separator: " · ")
    }
}

// MARK: - Pegar Content ID

struct PegarContentID: View {
    let modelo: CentroPartidoModelo
    @Environment(\.dismiss) private var cerrar
    @State private var texto = ""
    @State private var recordar = true
    @FocusState private var enfocado: Bool

    private var valido: Bool { ReglasFuentes.hashValido(texto) != nil }
    private var canal: String { modelo.partido.channels.first?.name ?? "" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Content ID o acestream://…", text: $texto, axis: .vertical)
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($enfocado)
                        .accessibilityIdentifier("campo-content-id")
                    Button {
                        if let pegado = UIPasteboard.general.string { texto = pegado }
                    } label: {
                        Label("Pegar del portapapeles", systemImage: "doc.on.clipboard")
                    }
                } footer: {
                    if !texto.isEmpty && !valido {
                        Text(ReglasFuentes.textoHashNoValido)
                            .foregroundStyle(Tinta.falloTinta)
                    }
                }
                if !canal.isEmpty {
                    Section {
                        Toggle("Recordar para \(canal)", isOn: $recordar)
                    } footer: {
                        Text("La próxima vez se propondrá esta señal para este canal.")
                    }
                }
            }
            .navigationTitle("Pegar Content ID")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { cerrar() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Reproducir") {
                        Task {
                            if await modelo.pegar(texto, recordar: recordar) { cerrar() }
                        }
                    }
                    .disabled(!valido)
                    .accessibilityIdentifier("boton-reproducir-pegado")
                }
            }
            .onAppear { enfocado = true }
        }
    }
}
