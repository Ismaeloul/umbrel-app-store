import Foundation

/* Lo que pintan el panel de fuentes y sus carteles (features/sources/useSources.ts y la presentación de
   model.ts de la web): cada fuente con su número estable, su estado efectivo, su anillo y palabra, su frase,
   su tipo y su proveedor, y los textos del progreso del comprobador y de las plegadas. Puro.

   Extensible: un tipo de fuente nuevo (p. ej. IPTV) solo necesita su fila en `tipos` (su `origen`) y llega
   al cartel con el mismo dibujo; el panel no cambia. Un origen desconocido se lee como la web
   («AceStream» si es infohash, «Fuente» si no). */

/// Una fuente lista para pintar (`SourceRow` de useSources.ts).
struct FilaCartel: Hashable, Sendable, Identifiable {
    var entrada: EntradaFuente
    /// Posición en la lista completa: no cambia al plegar (regla 1).
    var numero: Int
    var efectivo: Efectivo
    var senal: EstadoSenal
    var palabra: String
    var detalle: String
    var tipo: String
    /// El proveedor en una palabra: tras la flecha, si no la lista, si no el tipo.
    var corto: String
    var etiqueta: String
    var lista: String
    /// La elegida (esté o no sonando).
    var activa: Bool
    /// Suena o se conecta ahora mismo.
    var enPantalla: Bool
    var descripcion: String
    var id: String { entrada.id }

    /// «· 1080p · M3U»: la calidad y el tipo (este, solo si no coincide con el nombre).
    var extras: String {
        let tipoAparte: String? = tipo != corto ? tipo : nil
        return [PresentacionFuentes.calidad(entrada.sonda), tipoAparte].compactMap { $0 }.joined(separator: " · ")
    }
    /// El nombre de la tesela: el título sin el proveedor o el canal con el que casó.
    var nombreCanal: String {
        let parte = PresentacionFuentes.parteCanal(entrada.titulo)
        if !parte.isEmpty { return parte }
        return entrada.canal.isEmpty ? entrada.titulo : entrada.canal
    }
}

enum PresentacionFuentes {
    /// `TYPE_LABEL` de model.ts. Una fila por origen.
    static let tipos: [String: String] = [
        "saved": "Guardada", "m3u": "M3U", "favorites": "Favorito", "history": "Reciente",
        "acestream": "AceStream", "manual": "Externa",
    ]

    static func tipo(origen: String, ih: Bool?) -> String {
        tipos[origen] ?? (ih == true ? "AceStream" : "Fuente")
    }

    /// Flechas que separan canal y proveedor (`providerOf`, model.ts).
    private static let flechas = ["==>", "-->", "->", "=>", "→", "⇒", "➜", "➝", "⟶", "⟹"]

    private static func corte(_ titulo: String) -> Range<String.Index>? {
        flechas.compactMap { titulo.range(of: $0) }.min { $0.lowerBound < $1.lowerBound }
    }

    /// «M+ Liga de Campeones --> Elcano» → «Elcano».
    static func proveedor(_ titulo: String) -> String {
        guard let rango = corte(titulo) else { return "" }
        return titulo[rango.upperBound...].trimmingCharacters(in: .whitespaces)
    }

    /// «M+ Liga de Campeones --> Elcano» → «M+ Liga de Campeones».
    static func parteCanal(_ titulo: String) -> String {
        guard let rango = corte(titulo) else { return titulo.trimmingCharacters(in: .whitespaces) }
        return titulo[..<rango.lowerBound].trimmingCharacters(in: .whitespaces)
    }

    /// Nombre de la lista sin «Directorio (de) » (`listNameOf`).
    static func nombreLista(_ listaId: String?, listas: [WebSourceSummary]) -> String {
        guard let listaId, let nombre = listas.first(where: { $0.id == listaId })?.name else { return "" }
        let limpio = nombre.replacingOccurrences(
            of: #"^directorio(\s+de)?\s+"#, with: "", options: [.regularExpression, .caseInsensitive])
        return limpio.trimmingCharacters(in: .whitespaces)
    }

    /// «1080p», «720p», «SD» y «HEVC» con lo que midió el comprobador (`qualityLabel`): la regla de M3.
    static func calidad(_ sonda: SondaFuente?) -> String? { ReglasFuentes.calidad(sonda) }

    /// Las filas de la sesión (`useSourcesView`).
    static func filas(
        _ entradas: [EntradaFuente], activa: String?, pantalla: EnPantalla, ahora: Date,
        listas: [WebSourceSummary], hayComprobador: Bool
    ) -> [FilaCartel] {
        entradas.enumerated().map { indice, entrada in
            fila(entrada, numero: indice + 1, activa: activa, pantalla: pantalla, ahora: ahora, listas: listas,
                 hayComprobador: hayComprobador)
        }
    }

    static func fila(
        _ entrada: EntradaFuente, numero: Int, activa: String?, pantalla: EnPantalla, ahora: Date,
        listas: [WebSourceSummary], hayComprobador: Bool
    ) -> FilaCartel {
        let efectivo = ReglasFuentes.efectivo(entrada, pantalla: pantalla, ahora: ahora)
        let senal = ReglasFuentes.senal(efectivo, entrada)
        let tipo = tipo(origen: entrada.origen, ih: entrada.ih)
        let lista = nombreLista(entrada.listaId, listas: listas)
        let quien = proveedor(entrada.titulo)
        let detalle = quien.isEmpty ? lista : quien
        let etiqueta = detalle.isEmpty ? tipo : "\(tipo) · \(detalle)"
        var fila = FilaCartel(
            entrada: entrada, numero: numero, efectivo: efectivo, senal: senal.estado, palabra: senal.palabra,
            detalle: ReglasFuentes.detalle(efectivo, entrada), tipo: tipo, corto: detalle.isEmpty ? tipo : detalle,
            etiqueta: etiqueta, lista: lista, activa: entrada.id == activa, enPantalla: entrada.id == pantalla.id,
            descripcion: "")
        fila.descripcion = describir(fila, proveedor: quien, hayComprobador: hayComprobador)
        return fila
    }

    /// Nombre largo del cartel para VoiceOver (`describeSource`, model.ts).
    static func describir(_ fila: FilaCartel, proveedor: String, hayComprobador: Bool) -> String {
        let entrada = fila.entrada
        let pares = Int(entrada.sonda?.pares ?? 0)
        let porcentaje = ReglasFuentes.porcentaje(entrada.disponibilidad)
        var partes: [String] = [entrada.titulo, fila.etiqueta]
        if !fila.lista.isEmpty && fila.lista != proveedor { partes.append("Lista \(fila.lista)") }
        partes.append("Hash \(entrada.id)")
        partes.append(fila.detalle)
        if pares > 0 { partes.append("\(pares) pares en la prueba") }
        if !hayComprobador {
            partes.append(porcentaje.map { "\($0)% disponible" } ?? "Disponibilidad sin medir")
        }
        return "Fuente \(fila.numero): " + partes.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// Estado del anillo: el del medidor, salvo la reportada (dibujo propio) y la que está en pantalla (oro).
    static func anillo(_ fila: FilaCartel) -> EstadoAnillo {
        if fila.enPantalla { return .activa }
        if fila.efectivo.reportada { return .reportada }
        return .senal(fila.senal)
    }

    /// Barra del comprobador: 0 resolviendo; si no, `max(0,04, comprobadas/total)` (`scanProgress`).
    static func progreso(_ trabajo: ScanJob?, entradas: Int) -> Double {
        guard let trabajo else { return 0 }
        let total = max(trabajo.total, entradas)
        guard total > 0 else { return 0 }
        return max(0.04, min(1, Double(trabajo.checked) / Double(total)))
    }

    /// Texto del progreso (`scanProgressText`, model.ts; a4 §12.2).
    static func textoProgreso(_ trabajo: ScanJob?, filas: [FilaCartel], precalentado: PreheatPublic?) -> String {
        if filas.isEmpty && trabajo == nil { return "Preparando fuentes" }
        let total = max(trabajo?.total ?? 0, filas.count)
        let vivas = filas.filter(viva)
        let verificadas = "\(vivas.count) \(vivas.count == 1 ? "verificada" : "verificadas")"
        if let trabajo {
            switch trabajo.status {
            case .complete: return "\(verificadas) · \(total) \(total == 1 ? "comprobada" : "comprobadas")"
            case .waiting: return "\(verificadas) · fallidas en reposo"
            default: return "\(trabajo.checked)/\(total) · buscando señales vivas"
            }
        }
        if let precalentado, precalentado.status != .failed {
            let n = precalentado.candidateCount > 0 ? precalentado.candidateCount : filas.count
            return "\(n) fuentes precalentadas"
        }
        return "\(filas.count) fuentes disponibles"
    }

    /// Verificada o floja y no reportada.
    static func viva(_ fila: FilaCartel) -> Bool {
        guard !fila.efectivo.reportada, let estado = fila.efectivo.estado else { return false }
        return estado == .working || estado == .weak
    }

    /// La fuente que el comprobador está probando ahora (no la de pantalla), para « · la 3 se está probando ahora».
    static func probandoAhora(_ visibles: [FilaCartel], trabajo: ScanJob?) -> Int? {
        guard let trabajo, trabajo.status != .complete else { return nil }
        return visibles.first { $0.efectivo.estado == .checking && $0.efectivo.motivo != "player_check" }?.numero
    }

    /// «Ver 3 más sin señal» / «Ver 3 más (1 sin señal, 2 en cola)» / «Ver 3 más en cola» / «Ocultar…».
    static func textoPlegadas(_ plegadas: [FilaCartel], abiertas: Bool) -> String {
        if abiertas { return "Ocultar las que no dan señal" }
        let sinSenal = plegadas.filter { $0.senal == .fail }.count
        let n = plegadas.count
        if sinSenal == n { return "Ver \(n) más sin señal" }
        if sinSenal > 0 { return "Ver \(n) más (\(sinSenal) sin señal, \(n - sinSenal) en cola)" }
        return "Ver \(n) más en cola"
    }

    /// El menú «Fuente n» del cartel (`rowMenu`, SourcePoster.tsx; a4 §12.6). Abrirlo no vibra; ninguna opción vibra.
    static func opcionesCartel(_ fila: FilaCartel, enPartido: Bool) -> [OpcionMenu] {
        var opciones: [OpcionMenu] = [
            OpcionMenu(
                id: "ver", titulo: fila.enPantalla ? "Ya está en pantalla" : "Ver esta fuente", icono: .play,
                deshabilitada: fila.enPantalla),
            OpcionMenu(id: "copiar-hash", titulo: "Copiar hash", icono: .hash),
            OpcionMenu(id: "abrir", titulo: "Abrir en la app de AceStream", icono: .externo),
        ]
        let aprender = enPartido && fila.activa && fila.entrada.aprendida != .correct
        if aprender {
            opciones.append(OpcionMenu(id: "correcto", titulo: "Es el canal correcto", icono: .learn, separadaAntes: true))
        }
        opciones.append(
            OpcionMenu(id: "reportar", titulo: "Reportar…", icono: .flag, peligro: true, separadaAntes: !aprender))
        return opciones
    }
}
