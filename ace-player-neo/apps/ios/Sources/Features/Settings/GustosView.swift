import SwiftUI

/// Qué parte de los gustos (las tres listas de la web).
enum TipoGusto: String, CaseIterable, Identifiable {
    case ligas, equipos, nacionalidades

    var id: String { rawValue }

    var titulo: String {
        switch self {
        case .ligas: "Tus ligas"
        case .equipos: "Tus equipos"
        case .nacionalidades: "Nacionalidades"
        }
    }

    var explicacion: String {
        switch self {
        case .ligas: "Selecciona todas las que sigues."
        case .equipos: "Marca los tuyos o añade otro."
        case .nacionalidades: "Sus selecciones y sus ligas."
        }
    }

    var marcador: String {
        switch self {
        case .ligas: "Añadir otra liga…"
        case .equipos: "Añadir otro equipo…"
        case .nacionalidades: "Añadir otro país…"
        }
    }

    /// Chips fijos de la web (preferences/model.ts), en su orden.
    var sugerencias: [String] {
        switch self {
        case .ligas:
            [
                "LaLiga", "LaLiga Hypermotion", "Champions League", "Premier League", "Europa League", "Copa del Rey",
                "Serie A", "Bundesliga", "Ligue 1",
            ]
        case .equipos:
            [
                "Real Madrid", "Barcelona", "Atlético de Madrid", "Athletic Club", "Real Betis", "Real Sociedad",
                "Villarreal", "Sevilla", "Manchester City", "Arsenal", "Liverpool", "Inter",
            ]
        case .nacionalidades:
            GustosEditables.banderas.map(\.0)
        }
    }

    /// Topes del servidor (`MAX_FOOTBALL_*` y `TEXT_LIMITS`).
    var maximo: Int { self == .ligas ? 12 : 24 }
    var largoMaximo: Int { self == .equipos ? 80 : 60 }

    var clave: WritableKeyPath<GustosFutbol, [String]> {
        switch self {
        case .ligas: \.leagues
        case .equipos: \.teams
        case .nacionalidades: \.nationalities
        }
    }
}

/// Las reglas del borrador de gustos (preferences/model.ts de la web).
enum GustosEditables {
    /// País y bandera; los que se añaden a mano llevan el globo.
    static let banderas: [(String, String)] = [
        ("España", "🇪🇸"), ("Argentina", "🇦🇷"), ("Brasil", "🇧🇷"), ("Inglaterra", "🇬🇧"), ("Francia", "🇫🇷"),
        ("Italia", "🇮🇹"), ("Alemania", "🇩🇪"), ("Portugal", "🇵🇹"), ("Países Bajos", "🇳🇱"), ("Marruecos", "🇲🇦"),
        ("México", "🇲🇽"), ("Estados Unidos", "🇺🇸"), ("Uruguay", "🇺🇾"), ("Colombia", "🇨🇴"),
    ]

    static func bandera(_ nombre: String) -> String {
        banderas.first { $0.0 == nombre }?.1 ?? "🌍"
    }

    /// Espacios colapsados y recortado.
    static func colapsar(_ texto: String) -> String {
        texto.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// `cleanPreferenceList`: sin vacíos ni repetidos por clave, cortado y con tope.
    static func limpiar(_ valores: [String], tipo: TipoGusto) -> [String] {
        var vistos = Set<String>()
        var salida: [String] = []
        for bruto in valores {
            let valor = String(colapsar(bruto).prefix(tipo.largoMaximo))
            let clave = ParaTi.clavePreferencia(valor)
            guard !valor.isEmpty, !clave.isEmpty, !vistos.contains(clave) else { continue }
            vistos.insert(clave)
            salida.append(valor)
            if salida.count >= tipo.maximo { break }
        }
        return salida
    }

    static func desde(_ preferencias: Preferences?) -> GustosFutbol {
        let gustos = GustosFutbol(preferencias)
        return GustosFutbol(
            leagues: limpiar(gustos.leagues, tipo: .ligas), teams: limpiar(gustos.teams, tipo: .equipos),
            nationalities: limpiar(gustos.nationalities, tipo: .nacionalidades))
    }

    /// El que ya está en la lista con la misma clave («real madrid» = «Real Madrid»).
    static func mismo(_ lista: [String], _ valor: String) -> String? {
        let clave = ParaTi.clavePreferencia(valor)
        return lista.first { ParaTi.clavePreferencia($0) == clave }
    }

    /// Marca o desmarca. Con la lista llena no se añade nada.
    static func alternar(_ gustos: GustosFutbol, _ tipo: TipoGusto, _ valor: String) -> GustosFutbol {
        var copia = gustos
        var lista = copia[keyPath: tipo.clave]
        if let presente = mismo(lista, valor) {
            lista.removeAll { $0 == presente }
        } else if lista.count < tipo.maximo {
            lista.append(valor)
        }
        copia[keyPath: tipo.clave] = lista
        return copia
    }

    /// Añade uno escrito a mano (2 caracteres como mínimo). Si ya hay uno con
    /// la misma clave (un chip fijo o uno tuyo), se marca ese.
    static func anadir(_ gustos: GustosFutbol, _ tipo: TipoGusto, _ texto: String) -> (GustosFutbol, String?) {
        let limpio = String(colapsar(texto).prefix(tipo.largoMaximo))
        guard limpio.count >= 2 else { return (gustos, nil) }
        let lista = gustos[keyPath: tipo.clave]
        if let presente = mismo(lista, limpio) { return (gustos, presente) }
        guard lista.count < tipo.maximo else { return (gustos, nil) }
        let nombre = mismo(tipo.sugerencias, limpio) ?? limpio
        var copia = gustos
        copia[keyPath: tipo.clave] = lista + [nombre]
        return (copia, nombre)
    }

    /// Los chips que se enseñan: los fijos y, detrás, los tuyos que no lo son.
    static func opciones(_ gustos: GustosFutbol, _ tipo: TipoGusto) -> [String] {
        let propios = gustos[keyPath: tipo.clave].filter { mismo(tipo.sugerencias, $0) == nil }
        return tipo.sugerencias + propios
    }
}

/// «¿Qué fútbol te mueve?»: ligas, equipos y nacionalidades con chips, como
/// la hoja de la web. Se abre desde la agenda (hoja) y desde Ajustes.
struct GustosView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var cerrar
    var enHoja = false
    var alGuardar: (() -> Void)?
    @State private var borrador: GustosFutbol?
    @State private var original: GustosFutbol?
    @State private var textos: [TipoGusto: String] = [:]
    @State private var guardando = false
    @State private var fallo: String?

    var body: some View {
        Group {
            if let borrador {
                formulario(borrador)
            } else if let fallo {
                ContentUnavailableView {
                    Label("No se pueden cargar tus gustos", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(fallo)
                } actions: {
                    Button("Reintentar") { Task { await cargar() } }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Tu fútbol")
        .navigationBarTitleDisplayMode(enHoja ? .inline : .large)
        .toolbar {
            if enHoja {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { cerrar() }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await guardar() }
                } label: {
                    if guardando { ProgressView() } else { Text("Guardar") }
                }
                .disabled(borrador == nil || guardando || borrador == original)
                .accessibilityIdentifier("boton-guardar-gustos")
            }
        }
        .task { await cargar() }
    }

    private func formulario(_ actual: GustosFutbol) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("¿Qué fútbol te mueve?")
                        .font(.titular(.title2, peso: .heavy))
                        .foregroundStyle(Tinta.texto)
                    Text("Elige tus competiciones, equipos y nacionalidades. Los usaremos para tu agenda «Para ti»; siempre podrás ver todos los partidos.")
                        .font(.subheadline)
                        .foregroundStyle(Tinta.texto2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(Array(TipoGusto.allCases.enumerated()), id: \.element) { indice, tipo in
                    grupo(tipo, numero: indice + 1, actual: actual)
                }
                Text("Los gustos se guardan en tu Ace Player Neo: la web y este iPhone usan los mismos.")
                    .font(.footnote)
                    .foregroundStyle(Tinta.texto3)
            }
            .padding(Medida.margen)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("formulario-gustos")
    }

    private func grupo(_ tipo: TipoGusto, numero: Int, actual: GustosFutbol) -> some View {
        let marcados = actual[keyPath: tipo.clave]
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(String(format: "%02d", numero))
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(Tinta.acentoTinta)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(Tinta.oro.opacity(0.18), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(tipo.titulo)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Tinta.texto)
                        .accessibilityAddTraits(.isHeader)
                    Text("\(tipo.explicacion) \(marcados.count) de \(tipo.maximo).")
                        .font(.footnote)
                        .foregroundStyle(Tinta.texto2)
                }
            }
            DisposicionFlujo(espacio: 8, interlineado: 8) {
                ForEach(GustosEditables.opciones(actual, tipo), id: \.self) { opcion in
                    let marcado = GustosEditables.mismo(marcados, opcion) != nil
                    ChipSeleccionable(
                        tipo == .nacionalidades ? "\(GustosEditables.bandera(opcion)) \(opcion)" : opcion,
                        marcado: marcado
                    ) {
                        withAnimation(Muelle.rapido) {
                            borrador = GustosEditables.alternar(actual, tipo, opcion)
                        }
                    }
                    .accessibilityIdentifier("gusto-\(tipo.rawValue)-\(opcion)")
                }
            }
            HStack(spacing: 10) {
                TextField(
                    tipo.marcador,
                    text: Binding(get: { textos[tipo] ?? "" }, set: { textos[tipo] = $0 })
                )
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit { anadir(tipo) }
                .padding(.horizontal, 14)
                .frame(minHeight: Medida.toque)
                .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous)
                        .strokeBorder(Tinta.linea, lineWidth: 1))
                Button {
                    anadir(tipo)
                } label: {
                    Label("Añadir", systemImage: "plus")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 32)
                }
                .buttonStyle(.bordered)
                .disabled((textos[tipo] ?? "").trimmingCharacters(in: .whitespaces).count < 2)
            }
        }
    }

    private func anadir(_ tipo: TipoGusto) {
        guard let actual = borrador else { return }
        let (nuevo, anadido) = GustosEditables.anadir(actual, tipo, textos[tipo] ?? "")
        if anadido != nil {
            withAnimation(Muelle.rapido) { borrador = nuevo }
            textos[tipo] = ""
        } else if actual[keyPath: tipo.clave].count >= tipo.maximo {
            app.avisos.mostrar("Como mucho \(tipo.maximo) en «\(tipo.titulo)»", tono: .error)
        }
    }

    private func cargar() async {
        if borrador != nil { return }
        await app.cargarPreferencias()
        if app.preferencias == nil {
            fallo = "No se han podido leer tus gustos del servidor."
            return
        }
        let gustos = GustosEditables.desde(app.preferencias)
        original = gustos
        borrador = gustos
        fallo = nil
    }

    private func guardar() async {
        guard let borrador else { return }
        guardando = true
        defer { guardando = false }
        if await app.guardarGustos(borrador, completar: true) {
            original = borrador
            app.avisos.mostrar(
                ParaTi.tieneGustos(borrador) ? "Guardado: tu agenda «Para ti» ya es tuya" : "Gustos borrados", tono: .ok)
            alGuardar?()
            if enHoja { cerrar() }
        }
    }
}
