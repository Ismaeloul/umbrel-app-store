import SwiftUI
import UIKit

/* Las hojas modales del escenario (radio 24, medias o enteras): todas las
   fuentes en una rejilla de carteles, reportar una fuente, pegar un Content
   ID y «Dónde se emite» (los canales del partido y si están en la biblioteca). */

// MARK: - Fuentes

/// Todas las fuentes del partido como carteles, en dos columnas.
struct HojaFuentes: View {
    @Environment(\.dismiss) private var cerrar
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    let centro: CentroPartidoModelo
    let alPegar: () -> Void
    let alReportar: (EntradaFuente) -> Void
    @Namespace private var espacio

    var body: some View {
        let efectivos = centro.efectivos()
        let activa = centro.entradaEnPantalla?.id
        NavigationStack {
            GeometryReader { geo in
                let ancho = max(120, (geo.size.width - Medida.margen * 2 - 12) / 2)
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if !centro.resumen.detalle.isEmpty {
                            Text(centro.resumen.detalle)
                                .font(.footnote)
                                .foregroundStyle(Tinta.texto2)
                        }
                        LazyVGrid(
                            columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                            alignment: .leading, spacing: 16
                        ) {
                            ForEach(centro.entradas) { entrada in
                                let efectivo = efectivos[entrada.id] ?? Efectivo(estado: nil, motivo: "", reportada: false)
                                Button {
                                    withAnimation(sinMovimiento ? Muelle.reducido : Muelle.estandar) { centro.elegir(entrada) }
                                    cerrar()
                                } label: {
                                    CartelFuente(
                                        entrada: entrada, efectivo: efectivo, activa: entrada.id == activa, ancho: ancho,
                                        espacio: espacio)
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
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
                                        cerrar()
                                        alReportar(entrada)
                                    } label: {
                                        Label("Reportar…", systemImage: "flag")
                                    }
                                    Button {
                                        UIPasteboard.general.string = "acestream://\(entrada.id)"
                                    } label: {
                                        Label("Copiar enlace", systemImage: "link")
                                    }
                                }
                                .accessibilityHint("Toca para ver esta fuente")
                            }
                        }
                        if centro.entradas.isEmpty {
                            Text(
                                centro.cargando
                                    ? "Reuniendo señales…"
                                    : "Todavía no hay fuentes para este partido. Se reúnen 45 minutos antes del inicio."
                            )
                            .font(.subheadline)
                            .foregroundStyle(Tinta.texto2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            Text(
                                "\(centro.resumen.verificadas) \(centro.resumen.verificadas == 1 ? "verificada" : "verificadas") · el anillo dorado marca la que está en pantalla."
                            )
                            .font(.footnote)
                            .foregroundStyle(Tinta.texto3)
                        }
                    }
                    .padding(.horizontal, Medida.margen)
                    .padding(.top, 8)
                    .padding(.bottom, 90)
                }
            }
            .navigationTitle("Fuentes · \(centro.entradas.count)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { cerrar() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await centro.cargar(rebuscar: true) }
                    } label: {
                        Label(centro.cargando ? "Rebuscando…" : "Rebuscar", systemImage: "arrow.clockwise")
                            .symbolEffect(.pulse, isActive: centro.cargando)
                    }
                    .disabled(centro.cargando)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    cerrar()
                    alPegar()
                } label: {
                    Label("Pegar Content ID", systemImage: "doc.on.clipboard")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: Medida.toque)
                }
                .botonOro()
                .padding(.horizontal, Medida.margen)
                .padding(.vertical, 10)
                .background(.thinMaterial)
            }
        }
        .accessibilityIdentifier("hoja-fuentes")
    }
}

// MARK: - Reportar

/// Reportar una fuente: cinco motivos y «Reportar y apartar».
struct HojaReportar: View {
    @Environment(\.dismiss) private var cerrar
    let entrada: EntradaFuente
    /// En el actor principal: se llama desde un `Task` de la vista sin cruzar de aislamiento.
    let alReportar: @MainActor (SourceReportReason) async -> Void
    @State private var motivo: SourceReportReason = .notStarting
    @State private var enviando = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(ReglasFuentes.motivosReporte) { opcion in
                        Button {
                            motivo = opcion.motivo
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(opcion.texto)
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(Tinta.texto)
                                    Text(Self.pista(opcion.motivo))
                                        .font(.caption)
                                        .foregroundStyle(Tinta.texto2)
                                }
                                Spacer(minLength: 8)
                                Image(systemName: motivo == opcion.motivo ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(motivo == opcion.motivo ? Tinta.acentoTinta : Tinta.texto3)
                                    .contentTransition(.symbolEffect(.replace))
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(motivo == opcion.motivo ? [.isSelected] : [])
                    }
                } header: {
                    Text("Fuente: \(ReglasFuentes.nombreVisible(entrada))")
                } footer: {
                    Text("La fuente se apartará durante un rato y se volverá a comprobar.")
                }
            }
            .hapticoSeleccion(trigger: motivo)
            .navigationTitle("Reportar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { cerrar() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    enviando = true
                    Task {
                        await alReportar(motivo)
                        enviando = false
                        cerrar()
                    }
                } label: {
                    HStack(spacing: 8) {
                        if enviando { ProgressView().tint(Tinta.sobreAcento) } else { Image(systemName: "flag.fill") }
                        Text("Reportar y apartar")
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: Medida.toque)
                }
                .botonOro()
                .disabled(enviando)
                .padding(.horizontal, Medida.margen)
                .padding(.vertical, 10)
                .background(.thinMaterial)
                .accessibilityIdentifier("boton-reportar")
            }
        }
    }

    static func pista(_ motivo: SourceReportReason) -> String {
        switch motivo {
        case .notStarting: "Se queda conectando y nunca llega la imagen"
        case .stuttering: "Arranca pero se para cada poco"
        case .wrongChannel: "La imagen es de otro canal o de otro partido"
        case .badQuality: "Bloques, imagen borrosa o a saltos"
        case .audio: "Sin sonido, desincronizado o en otro idioma"
        case .desconocido: ""
        }
    }
}

// MARK: - Pegar Content ID

/// Pegar un Content ID o un enlace `acestream://` (con «Enlace detectado» al
/// reconocerlo). Sirve para el partido (con «Recordar para el canal») y para
/// reproducirlo suelto desde Canales.
struct HojaPegar: View {
    @Environment(\.dismiss) private var cerrar
    /// Canal del partido para «Recordar para…» (nil: sin partido).
    var canal: String?
    /// Reproduce lo pegado; devuelve true si se aceptó (en el actor principal, como `alReportar`).
    let alReproducir: @MainActor (String, Bool) async -> Bool
    @State private var texto = ""
    @State private var recordar = true
    @State private var enviando = false
    @FocusState private var enfocado: Bool

    private var hash: String? { ReglasFuentes.hashValido(texto) }
    private var valido: Bool { hash != nil }

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
                    if valido {
                        Label("Enlace detectado", systemImage: "link")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Tinta.okTinta)
                            .accessibilityIdentifier("enlace-detectado")
                    }
                } footer: {
                    if !texto.isEmpty && !valido {
                        Text(ReglasFuentes.textoHashNoValido)
                            .foregroundStyle(Tinta.falloTinta)
                    } else {
                        Text("Se reproduce como señal externa, sin guardarla en recientes.")
                    }
                }
                if let canal, !canal.isEmpty {
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
                        enviando = true
                        Task {
                            let aceptado = await alReproducir(texto, recordar && canal != nil)
                            enviando = false
                            if aceptado { cerrar() }
                        }
                    }
                    .disabled(!valido || enviando)
                    .accessibilityIdentifier("boton-reproducir-pegado")
                }
            }
            .onAppear { enfocado = true }
        }
    }
}

// MARK: - Dónde se emite

/// Los canales que anuncia la agenda para el partido y si están en la biblioteca.
struct HojaDondeSeEmite: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var cerrar
    let partido: FootballMatch

    var body: some View {
        NavigationStack {
            List {
                ForEach(partido.channels) { canal in
                    let items = app.canalesDeBiblioteca(para: canal.name)
                    Section {
                        if items.isEmpty {
                            Label("No está en tu biblioteca: se buscará al reproducir el partido", systemImage: "magnifyingglass")
                                .font(.subheadline)
                                .foregroundStyle(Tinta.texto2)
                        } else {
                            ForEach(items) { item in
                                Button {
                                    let lista = items.map { app.canalReproducible($0) }
                                    app.abrirCanal(app.canalReproducible(item), lista: lista)
                                    cerrar()
                                } label: {
                                    HStack(spacing: 12) {
                                        LogoCanal(titulo: item.title, tamano: 40)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.title)
                                                .font(.body.weight(.semibold))
                                                .foregroundStyle(Tinta.texto)
                                                .lineLimit(2)
                                            Text("En tu biblioteca")
                                                .font(.caption.weight(.semibold))
                                                .foregroundStyle(Tinta.okTinta)
                                        }
                                        Spacer(minLength: 4)
                                        Image(systemName: "play.fill")
                                            .font(.caption)
                                            .foregroundStyle(Tinta.acentoTinta)
                                    }
                                }
                                .accessibilityLabel("Ver \(item.title), en tu biblioteca")
                            }
                        }
                    } header: {
                        Label(canal.name, systemImage: "tv")
                    }
                }
            }
            .navigationTitle("Dónde se emite")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { cerrar() }
                }
            }
        }
    }
}
