import Foundation

/* Reglas puras del selector de fuentes: apps/web/src/features/sources/model.ts tal cual (mismos umbrales,
   mismo orden de comprobaciones, mismos textos), sin red ni temporizadores. La sesión (SesionFuentes) las
   usa para decidir y las vistas para pintar. Revalidado contra la web en la fase 1 (M3). */

enum ReglasFuentes {
    /// El veredicto del reproductor manda sobre el del comprobador (PLAYER_VERDICT_MS, model.ts).
    static let vigenciaVeredicto: TimeInterval = 3 * 60
    /// Cuarentena local si el servidor no devuelve el reporte (LOCAL_QUARANTINE_MS).
    static let cuarentenaLocal: TimeInterval = 30 * 60
    /// Vista 60 s o más y luego cortada: floja y visible, no «sin señal» (DROPPED_AFTER_S).
    static let caidaTrasSegundos = 60
    /// Fuentes iniciales que se ven sin esperar al comprobador (SCANNER_INITIAL_SOURCES de @ace/shared).
    static let inicialesPorDefecto = 3
    /// Umbrales de bitrate (kbit/s) de «1080p» y «720p» (QUALITY_KBPS).
    static let kbpsFullHD: Double = 3800
    static let kbpsHD: Double = 1700

    // MARK: Construir y juntar entradas

    /// `dedupeEntries`: sin repetir id, conservando el orden del servidor (el cliente no reordena).
    static func sinDuplicados(_ entradas: [EntradaFuente]) -> [EntradaFuente] {
        var vistos = Set<String>()
        return entradas.filter { vistos.insert($0.id).inserted }
    }

    /// `startScan`: todas arrancan en cola y las primeras `inicial` (3 por defecto) se marcan iniciales.
    static func empezarComprobacion(_ entradas: [EntradaFuente], inicial: Int) -> [EntradaFuente] {
        let pedidas = inicial > 0 ? inicial : inicialesPorDefecto
        let iniciales = max(1, min(entradas.count, pedidas))
        return entradas.enumerated().map { indice, entrada in
            var nueva = entrada
            let reportada = entrada.reportadaHasta != nil
            if !reportada { nueva.sonda = .enCola }
            nueva.inicial = !reportada && indice < iniciales
            return nueva
        }
    }

    /// `applyScan`: copia lo que dice el comprobador a cada entrada.
    static func aplicarComprobacion(_ entradas: [EntradaFuente], candidatos: [ScanCandidate]) -> [EntradaFuente] {
        var porId: [String: ScanCandidate] = [:]
        for candidato in candidatos { porId[candidato.id] = candidato }
        return entradas.map { entrada in
            guard let candidato = porId[entrada.id] else { return entrada }
            var nueva = entrada
            nueva.sonda = SondaFuente(candidato)
            return nueva
        }
    }

    /// `applyVerdict`: un veredicto suelto (`scan.verdict` por SSE) cambia el estado sin esperar al trabajo.
    static func aplicarVeredicto(_ entradas: [EntradaFuente], _ veredicto: ScanVerdictData) -> [EntradaFuente] {
        entradas.map { entrada in
            guard entrada.id == veredicto.hash else { return entrada }
            var nueva = entrada
            var sonda = entrada.sonda ?? .enCola
            sonda.estado = estadoDe(veredicto.state)
            sonda.motivo = veredicto.reason
            if let donde = veredicto.playableOn {
                sonda.reproducibleEnWeb = donde.web
                sonda.reproducibleEnIOS = donde.ios
                // D6 de iOS, como en SondaFuente(_:).
                if donde.ios, sonda.estado != .working, veredicto.reason == "unsupported_codec" { sonda.estado = .working }
            }
            nueva.sonda = sonda
            return nueva
        }
    }

    /// `clearScan`: olvida el comprobador (se cayó o se canceló): se enseñan todas.
    static func olvidarComprobacion(_ entradas: [EntradaFuente]) -> [EntradaFuente] {
        entradas.map { entrada in
            var nueva = entrada
            nueva.sonda = nil
            nueva.inicial = false
            return nueva
        }
    }

    static func estadoDe(_ veredicto: VerdictState) -> ScanCandidateState {
        switch veredicto {
        case .working: .working
        case .weak: .weak
        case .failed: .failed
        case .desconocido: .queued
        }
    }

    // MARK: Estado efectivo

    static func reportada(_ entrada: EntradaFuente, ahora: Date) -> Bool {
        (entrada.reportadaHasta ?? .distantPast) > ahora
    }

    /// `effectiveOf`: reporte en cuarentena › reproductor en pantalla › veredicto del reproductor (< 3 min) ›
    /// comprobador › nada.
    static func efectivo(_ entrada: EntradaFuente, pantalla: EnPantalla, ahora: Date) -> Efectivo {
        if reportada(entrada, ahora: ahora) { return Efectivo(estado: .failed, motivo: "reported", reportada: true) }
        if entrada.id == pantalla.id && pantalla.sonando {
            return Efectivo(estado: .working, motivo: "player", reportada: false)
        }
        // Regla 20: la que se conecta en pantalla es «comprobando» aunque el comprobador la diera por caída.
        if entrada.id == pantalla.id && pantalla.conectando {
            return Efectivo(estado: .checking, motivo: "player_check", reportada: false)
        }
        if let veredicto = entrada.veredicto, ahora.timeIntervalSince(veredicto.fecha) < vigenciaVeredicto {
            return Efectivo(estado: estadoDe(veredicto.estado), motivo: veredicto.motivo, reportada: false)
        }
        if let sonda = entrada.sonda { return Efectivo(estado: sonda.estado, motivo: sonda.motivo, reportada: false) }
        return Efectivo(estado: nil, motivo: "", reportada: false)
    }

    /// `effectiveMap`.
    static func efectivos(_ entradas: [EntradaFuente], pantalla: EnPantalla, ahora: Date) -> [String: Efectivo] {
        var salida: [String: Efectivo] = [:]
        for entrada in entradas { salida[entrada.id] = efectivo(entrada, pantalla: pantalla, ahora: ahora) }
        return salida
    }

    /// `availabilityPercent`: 0…1 o porcentaje → 0…100 entero.
    static func porcentaje(_ valor: Double?) -> Int? {
        guard let valor, valor.isFinite else { return nil }
        let p = valor >= 0 && valor <= 1 ? valor * 100 : valor
        return Int(max(0, min(100, p)).rounded(.toNearestOrAwayFromZero))
    }

    /// `signalOf`: medidor + palabra de la fuente; sin comprobador, la disponibilidad de la resolución.
    static func senal(_ efectivo: Efectivo, _ entrada: EntradaFuente) -> (estado: EstadoSenal, palabra: String) {
        if efectivo.reportada { return (.fail, "Reportada") }
        if let estado = efectivo.estado {
            switch estado {
            case .working: return (.ok, "Verificada")
            case .weak: return (.weak, "Floja")
            case .checking: return (.checking, "Comprobando")
            case .queued, .desconocido: return (.pending, "Pendiente")
            case .failed: return (.fail, "Sin señal")
            }
        }
        guard let p = porcentaje(entrada.disponibilidad) else { return (.pending, "Sin comprobar") }
        let medidor: EstadoSenal = p >= 60 ? .ok : (p > 0 ? .weak : .fail)
        return (medidor, "\(p)% disponible")
    }

    static let motivosReporte: [MotivoReporte] = [
        MotivoReporte(motivo: .notStarting, texto: "No arranca"),
        MotivoReporte(motivo: .stuttering, texto: "Se corta"),
        MotivoReporte(motivo: .wrongChannel, texto: "Canal incorrecto"),
        MotivoReporte(motivo: .badQuality, texto: "Mala calidad"),
        MotivoReporte(motivo: .audio, texto: "Problema de audio"),
    ]

    /// `reportReasonLabel`.
    static func etiqueta(_ motivo: SourceReportReason) -> String {
        motivosReporte.first { $0.motivo == motivo }?.texto ?? "No arranca"
    }

    private static let frases: [String: String] = [
        "player": "reproduciendo ahora",
        "player_check": "comprobando en pantalla",
        "unsupported_codec": "vídeo no compatible",
        "no_video": "sin pista de vídeo",
        "unverified_media": "señal detectada · vídeo sin confirmar",
        "player_failed": "no arrancó en el reproductor",
        "player_dropped": "se cortó en el reproductor",
        "player_ok": "funcionó en el reproductor",
        "intermittent": "intermitente: falló la última prueba",
        "starved": "llega menos señal de la que el canal necesita",
        "retry": "reintentando",
        "delayed_retry": "reintentando",
    ]

    private static func fraseDeEstado(_ estado: ScanCandidateState) -> String {
        switch estado {
        case .working: "verificada"
        case .weak: "señal sin confirmar"
        case .checking: "probándose en el segundo motor"
        case .queued, .desconocido: "en cola"
        case .failed: "sin señal"
        }
    }

    /// `detailOf`: frase humana de la fuente; una fallida que se volverá a probar dice a qué hora (B7).
    static func detalle(_ efectivo: Efectivo, _ entrada: EntradaFuente) -> String {
        if efectivo.reportada, let motivo = entrada.motivoReporte {
            return "apartada por tu reporte (\(etiqueta(motivo).lowercased()))"
        }
        guard let estado = efectivo.estado else {
            return porcentaje(entrada.disponibilidad).map { "\($0)% disponible" } ?? "disponibilidad sin medir"
        }
        let frase = frases[efectivo.motivo] ?? fraseDeEstado(estado)
        let reintento =
            estado == .failed && efectivo.motivo != "player_failed" ? horaMadrid(entrada.sonda?.reintentoEn) : nil
        return reintento.map { "\(frase); reintento a las \($0)" } ?? frase
    }

    /// `madridHour` (agenda/domain.ts): «HH:MM» en Madrid de una fecha ISO, o nil.
    static func horaMadrid(_ iso: String?) -> String? {
        guard let iso, !iso.isEmpty, let fecha = FechaISO.parse(iso) else { return nil }
        var calendario = Calendar(identifier: .gregorian)
        calendario.timeZone = TimeZone(identifier: "Europe/Madrid") ?? TimeZone(secondsFromGMT: 3600) ?? .current
        let partes = calendario.dateComponents([.hour, .minute], from: fecha)
        return String(format: "%02d:%02d", partes.hour ?? 0, partes.minute ?? 0)
    }

    // MARK: Presentación

    private static let tipos: [String: String] = [
        "saved": "Guardada", "m3u": "M3U", "favorites": "Favorito", "history": "Reciente", "acestream": "AceStream",
        "manual": "Externa",
    ]

    /// `--> -> ==> => → ⇒ ➜ ➝ ⟶ ⟹` (providerOf / channelPartOf).
    private static let flechas = ["-->", "->", "==>", "=>", "→", "⇒", "➜", "➝", "⟶", "⟹"]

    /// La primera flecha del título (la más a la izquierda) y lo que ocupa.
    private static func primeraFlecha(_ titulo: String) -> Range<String.Index>? {
        var mejor: Range<String.Index>?
        for flecha in flechas {
            guard let rango = titulo.range(of: flecha) else { continue }
            if let actual = mejor, actual.lowerBound <= rango.lowerBound { continue }
            mejor = rango
        }
        return mejor
    }

    /// `providerOf`: «M+ Liga de Campeones --> Elcano» → «Elcano».
    static func proveedor(_ titulo: String) -> String {
        guard let rango = primeraFlecha(titulo) else { return "" }
        return titulo[rango.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `channelPartOf`: «M+ Liga de Campeones --> Elcano» → «M+ Liga de Campeones».
    static func parteCanal(_ titulo: String) -> String {
        guard let rango = primeraFlecha(titulo) else { return titulo.trimmingCharacters(in: .whitespacesAndNewlines) }
        return titulo[..<rango.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `channelNameOf`: el título sin el proveedor o el canal con el que casó.
    static func nombreCanal(_ entrada: EntradaFuente) -> String {
        let parte = parteCanal(entrada.titulo)
        if !parte.isEmpty { return parte }
        return entrada.canal.isEmpty ? entrada.titulo : entrada.canal
    }

    /// `listNameOf`: nombre de la lista sin «Directorio (de)».
    static func nombreLista(_ listaId: String?, listas: [WebSourceSummary]) -> String {
        guard let listaId, !listaId.isEmpty else { return "" }
        let nombre = listas.first { $0.id == listaId }?.name ?? ""
        let sinPrefijo = nombre.replacingOccurrences(
            of: #"^directorio(?:\s+de)?\s+"#, with: "", options: [.regularExpression, .caseInsensitive])
        return sinPrefijo.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `presentationOf`.
    static func presentacion(_ entrada: EntradaFuente, listas: [WebSourceSummary]) -> PresentacionFuente {
        let tipo = tipos[entrada.origen] ?? (entrada.ih == true ? "AceStream" : "Fuente")
        let lista = nombreLista(entrada.listaId, listas: listas)
        let quien = proveedor(entrada.titulo)
        let detalle = quien.isEmpty ? lista : quien
        return PresentacionFuente(
            tipo: tipo, lista: lista, proveedor: quien, etiqueta: detalle.isEmpty ? tipo : "\(tipo) · \(detalle)",
            corto: quien.isEmpty ? (lista.isEmpty ? tipo : lista) : quien)
    }

    /// Kbit/s → «6,2» (`mbit`: `toLocaleString('es-ES')` con un decimal y el redondeo de ICU, M2). Con
    /// `String(format:)` 950 salía «0,9» y la web dice «1,0» (vectores-fuentes.json).
    static func mbit(_ kbps: Double) -> String { NumerosES.mbit(kbps: kbps) }

    /// `swarmMbit`: Mbit/s del enjambre en la prueba; nil si no se midió.
    static func mbitEnjambre(_ entrada: EntradaFuente) -> String? {
        guard let intake = entrada.sonda?.intakeKbps, intake > 0 else { return nil }
        return mbit(intake)
    }

    /// `qualityLabel`: «1080p», «720p» o «SD» por el bitrate medido (o el del canal) y «HEVC» si el códec no es
    /// H.264; nil sin nada medido.
    static func calidad(_ sonda: SondaFuente?) -> String? {
        guard let sonda else { return nil }
        let kbps = (sonda.rateKbps ?? 0) > 0 ? (sonda.rateKbps ?? 0) : sonda.streamKbps
        let hevc =
            sonda.codec.range(of: #"hevc|h\.?265|hvc1|hev1"#, options: [.regularExpression, .caseInsensitive]) != nil
        let definicion: String? = kbps >= kbpsFullHD ? "1080p" : (kbps >= kbpsHD ? "720p" : (kbps > 0 ? "SD" : nil))
        guard definicion != nil || hevc else { return nil }
        return [definicion, hevc ? "HEVC" : nil].compactMap { $0 }.joined(separator: " · ")
    }

    /// `describeSource`: nombre largo para VoiceOver.
    static func describir(
        _ entrada: EntradaFuente, numero: Int, efectivo: Efectivo, presentacion: PresentacionFuente, conComprobador: Bool
    ) -> String {
        let intake = entrada.sonda?.intakeKbps ?? 0
        let stream = entrada.sonda?.streamKbps ?? 0
        let pares = entrada.sonda?.pares ?? 0
        var partes = [entrada.titulo, presentacion.etiqueta]
        if !presentacion.lista.isEmpty && presentacion.lista != presentacion.proveedor {
            partes.append("Lista \(presentacion.lista)")
        }
        partes.append("Hash \(entrada.id)")
        partes.append(detalle(efectivo, entrada))
        if pares > 0 { partes.append("\(Int(pares)) pares en la prueba") }
        if intake > 0 {
            partes.append("\(mbit(intake)) Mbit/s del enjambre" + (stream > 0 ? " para un canal de \(mbit(stream))" : ""))
        }
        if !conComprobador {
            partes.append(porcentaje(entrada.disponibilidad).map { "\($0)% disponible" } ?? "Disponibilidad sin medir")
        }
        return "Fuente \(numero): " + partes.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// `useSourcesView`: cada fuente con su número, estado, medidor, frase y descripción.
    static func filas(
        _ entradas: [EntradaFuente], pantalla: EnPantalla, ahora: Date, activa: String?, listas: [WebSourceSummary],
        conComprobador: Bool
    ) -> [FilaFuente] {
        entradas.enumerated().map { indice, entrada in
            let efectivo = efectivo(entrada, pantalla: pantalla, ahora: ahora)
            let presentacion = presentacion(entrada, listas: listas)
            let senal = senal(efectivo, entrada)
            return FilaFuente(
                entrada: entrada, numero: indice + 1, efectivo: efectivo, senal: senal.estado, palabra: senal.palabra,
                detalle: detalle(efectivo, entrada), presentacion: presentacion, activa: entrada.id == activa,
                enPantalla: entrada.id == pantalla.id,
                descripcion: describir(
                    entrada, numero: indice + 1, efectivo: efectivo, presentacion: presentacion,
                    conComprobador: conComprobador))
        }
    }

    // MARK: Qué se ve y qué arranca solo

    /// `isShownWhileScanning` (regla 22): la activa, las vivas y las iniciales sin probar.
    static func visibleMientrasComprueba(_ entrada: EntradaFuente, efectivo: Efectivo, activa: String?) -> Bool {
        if entrada.id == activa { return true }
        if efectivo.viva { return true }
        let sinProbar = efectivo.estado == .queued || efectivo.estado == .checking || efectivo.estado == nil
        return entrada.inicial && (entrada.sonda?.intentos ?? 0) == 0 && sinProbar
    }

    /// `scanFinished`: sin comprobador, o `complete`/`waiting`. Entonces una floja también vale para arrancar.
    static func comprobadorTerminado(_ comprobador: EstadoComprobador?) -> Bool {
        guard let comprobador else { return true }
        return comprobador.estado == .complete || comprobador.estado == .waiting
    }

    /// `pickAutoSource`: la primera verificada no reportada ni probada ya; terminado, la primera floja.
    static func elegirAutomatica(
        _ entradas: [EntradaFuente], efectivos: [String: Efectivo], terminado: Bool
    ) -> EntradaFuente? {
        let candidatas = entradas.filter { !$0.probadaAuto && efectivos[$0.id]?.reportada != true }
        if let verificada = candidatas.first(where: { efectivos[$0.id]?.estado == .working }) { return verificada }
        return terminado ? candidatas.first { efectivos[$0.id]?.estado == .weak } : nil
    }

    /// `pickInitialSwitch`: si la inicial sale fallida en el comprobador y no se está viendo, la primera otra viva.
    static func elegirSaltoInicial(
        _ entradas: [EntradaFuente], activa: String?, pantalla: EnPantalla, ahora: Date
    ) -> EntradaFuente? {
        guard let actual = entradas.first(where: { $0.id == activa }), !reportada(actual, ahora: ahora),
            actual.sonda?.estado == .failed
        else { return nil }
        if pantalla.id == actual.id && pantalla.sonando { return nil }
        return entradas.first { entrada in
            entrada.id != actual.id && !reportada(entrada, ahora: ahora)
                && (entrada.sonda?.estado == .working || entrada.sonda?.estado == .weak)
        }
    }

    /// `failureVerdict`: qué veredicto deja el reproductor al agotar una fuente (regla 21).
    static func veredictoFallo(_ resultado: OutcomeResult, segundos: Int) -> (VerdictState, String) {
        if resultado == .cayo && segundos >= caidaTrasSegundos { return (.weak, "player_dropped") }
        return (.failed, "player_failed")
    }

    // MARK: Progreso del comprobador

    /// `scanProgress`: 0…1, nunca en blanco del todo (4 % como mínimo).
    static func progreso(_ comprobador: EstadoComprobador?, entradas: Int) -> Double {
        let total = max(comprobador?.total ?? 0, entradas)
        guard let comprobador, total > 0 else { return 0 }
        return max(0.04, min(1, Double(comprobador.comprobadas) / Double(total)))
    }

    /// `scanProgressText`.
    static func textoProgreso(
        _ comprobador: EstadoComprobador?, entradas: [EntradaFuente], efectivos: [String: Efectivo],
        precalentado: PreheatPublic?
    ) -> String {
        if entradas.isEmpty && comprobador == nil { return "Preparando fuentes" }
        let total = max(comprobador?.total ?? 0, entradas.count)
        let jugables = entradas.filter { efectivos[$0.id]?.viva == true }.count
        let verificadas = "\(jugables) \(jugables == 1 ? "verificada" : "verificadas")"
        if comprobador?.estado == .complete {
            return "\(verificadas) · \(total) \(total == 1 ? "comprobada" : "comprobadas")"
        }
        if comprobador?.estado == .waiting { return "\(verificadas) · fallidas en reposo" }
        if let comprobador { return "\(comprobador.comprobadas)/\(total) · buscando señales vivas" }
        if let precalentado, precalentado.status != .failed {
            let n = precalentado.candidateCount > 0 ? precalentado.candidateCount : entradas.count
            return "\(n) fuentes precalentadas"
        }
        return "\(entradas.count) fuentes disponibles"
    }

    // MARK: Reportes

    /// `reportFollowUp`: si vive y el motivo era «No arranca», vuelve; con otro motivo se queda apartada.
    static func seguimientoReporte(_ motivo: SourceReportReason, estado: ScanCandidateState?) -> SeguimientoReporte {
        let viva = estado == .working || estado == .weak
        guard viva else {
            return SeguimientoReporte(
                sigueApartada: true, texto: "El segundo motor confirma que esta fuente no entrega señal", tono: .err)
        }
        if motivo != .notStarting {
            return SeguimientoReporte(
                sigueApartada: true, texto: "La señal está viva, pero queda apartada por tu reporte", tono: .ok)
        }
        return SeguimientoReporte(
            sigueApartada: false, texto: "El segundo motor confirma que la fuente vuelve a funcionar", tono: .ok)
    }

    // MARK: Biblioteca: hermanas del mismo canal (regla 23)

    /// `librarySiblings`: lista + favoritos + recientes sin repetir, del MISMO canal (puntuación ≥ 92).
    static func hermanas(_ biblioteca: LibraryView?, id: String) -> [Item] {
        guard let biblioteca else { return [] }
        var vistos = Set<String>()
        var todos: [Item] = []
        for item in biblioteca.web + biblioteca.favorites + biblioteca.history
        where !item.id.isEmpty && vistos.insert(item.id).inserted {
            todos.append(item)
        }
        guard let actual = todos.first(where: { $0.id == id }) else { return [] }
        let nombre = nombreDe(actual)
        if Canales.clave(nombre).isEmpty { return [actual] }
        return todos.filter { item in
            item.id == id || Canales.puntuacion(nombre, nombreDe(item)) >= Canales.puntuacionExacta
        }
    }

    private static func nombreDe(_ item: Item) -> String {
        if let alias = item.alias, !alias.isEmpty { return alias }
        return item.title
    }

    // MARK: Resolución («Encontrar canal»)

    /// `resolutionSourceLabel`.
    static func etiquetaOrigenResolucion(_ origen: String) -> String {
        let etiquetas = [
            "saved": "Asociación guardada", "m3u": "Directorio M3U", "favorites": "Favoritos", "history": "Recientes",
            "acestream": "Buscador AceStream",
        ]
        return etiquetas[origen] ?? "Fuente disponible"
    }

    /// `checkedLabel`.
    static func etiquetaRevisado(_ valor: String) -> String {
        let etiquetas = [
            "saved": "Vínculos", "favorites": "Favoritos", "history": "Recientes", "m3u": "M3U", "library": "Biblioteca",
            "acestream": "AceStream", "ai-programming": "IA", "ai": "IA",
        ]
        return etiquetas[valor] ?? valor
    }

    /// `INVALID_HASH_TEXT`.
    static let textoHashNoValido = "Introduce un Content ID o enlace AceStream válido de 40 caracteres."

    // MARK: Hash

    /// `normalizeHash` (packages/shared/src/domain/hash.ts): `acestream://<40 hex>`, una URL con `?id=` o
    /// `?content_id=` de 40 hex, o cualquier texto con 40 hex seguidos → el hash en minúsculas; nil si no hay.
    static func normalizarHash(_ texto: String) -> String? {
        let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        if let rango = limpio.range(of: #"acestream://[a-fA-F0-9]{40}"#, options: .regularExpression) {
            return String(limpio[rango].suffix(40)).lowercased()
        }
        if let componentes = URLComponents(string: limpio), componentes.scheme != nil {
            let items = componentes.queryItems ?? []
            let valor = items.first { $0.name == "id" }?.value ?? items.first { $0.name == "content_id" }?.value
            if let valor, esHash(valor) { return valor.lowercased() }
        }
        guard let rango = limpio.range(of: #"[a-fA-F0-9]{40}"#, options: .regularExpression) else { return nil }
        return String(limpio[rango]).lowercased()
    }

    /// `HASH_RE`: 40 hexadecimales en cualquier caja.
    static func esHash(_ texto: String) -> Bool {
        let escalares: String.UnicodeScalarView = texto.unicodeScalars
        return escalares.count == 40 && escalares.allSatisfy { esHexASCII($0, mayusculas: true) }
    }

    /// `[a-f0-9]` (o `[a-fA-F0-9]`) de las expresiones de la web: solo ASCII (`isHexDigit` acepta «０»).
    static func esHexASCII(_ escalar: Unicode.Scalar, mayusculas: Bool) -> Bool {
        let valor: UInt32 = escalar.value
        if valor >= 0x30 && valor <= 0x39 { return true }
        if valor >= 0x61 && valor <= 0x66 { return true }
        return mayusculas && valor >= 0x41 && valor <= 0x46
    }

    /// Un Content ID o enlace `acestream://` de 40 hex EXACTOS → el hash (lo usa la búsqueda de M5). Para pegar
    /// se usa `normalizarHash`, que es la regla de la web.
    static func hashValido(_ texto: String) -> String? {
        var limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpio.lowercased().hasPrefix("acestream://") { limpio = String(limpio.dropFirst("acestream://".count)) }
        if let interrogacion = limpio.firstIndex(of: "?") { limpio = String(limpio[..<interrogacion]) }
        guard esHash(limpio) else { return nil }
        return limpio.lowercased()
    }
}
