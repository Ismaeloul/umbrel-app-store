import Foundation

/* Catálogo de textos del reproductor y de la sesión de fuentes, literales de la web (a7 §9, §12.3-§12.4):
   apps/web/src/player/runtime.ts, player/status.ts, player/index.tsx y features/sources/session.ts. Ni uno
   inventado. TextosTests compara cada uno con Vectores/textos-web.json, que saca scripts/generar-textos.mjs del
   TypeScript real (las plantillas llevan «{}» donde la web interpola). */

enum TextosReproductor {
    // MARK: Conexión (runtime.ts)

    static let conectando = "Conectando con AceStream…"
    static let reconectandoConAceStream = "Reconectando con AceStream…"
    static let senalEncontrada = "Señal encontrada: cargando los primeros segundos…"

    // Motivos de reconexión (`fail(reason)`).
    static let sinSenalSuficiente = "Sin señal suficiente: reintentando"
    static let imagenParada = "La imagen se ha quedado parada: reconectando"
    static let senalCortada = "La señal se ha cortado: reconectando"
    static let sesionCaducada = "La sesión había caducado: reconectando"
    static let noSePudoAbrir = "No se pudo abrir el canal: reconectando"
    static let reconectandoAlVolver = "Reconectando al volver a la app"
    static let demoNoResponde = "La señal de muestra no responde; buscando una alternativa"

    /// «<motivo> (n/máx)…».
    static func reconexion(_ motivo: String, n: Int, max: Int) -> String { "\(motivo) (\(n)/\(max))…" }

    static let probandoSiguiente = "Esta fuente no responde: probando la siguiente…"
    static let senalRecuperada = "Señal recuperada"
    static let senalIrregular = "Señal irregular: recuperando la imagen…"
    static let traspaso = "La reproducción ha pasado a otro dispositivo"
    static let sinAcceso = "Este dispositivo ya no tiene acceso al reproductor."
    static let otroSeUne = "Otro dispositivo se ha unido: pasando a HLS…"
    static let vuelvesSolo = "Vuelves a estar solo: recuperando la señal directa…"
    static let remuxReiniciado = "La conversión para iPhone se ha reiniciado: reenganchando…"
    static let motorReiniciado = "El motor se ha reiniciado: reenganchando la señal…"
    static let noSePudoGuardarHistorial = "No se pudo guardar el historial"

    /// «Motor de vuelta: reconectando «<título>»…».
    static func motorDeVuelta(_ titulo: String) -> String { "Motor de vuelta: reconectando «\(titulo)»…" }

    // MARK: Directo y −30 s (runtime.ts)

    static let directoEnDemo = "Ya estás en el directo (en demo no hay retardo)"
    static let yaEnDirecto = "Ya estabas en el directo"
    static let directoReanudado = "Directo reanudado"
    static let deVueltaAlDirecto = "De vuelta al directo"
    static let noDejaSaltar = "La señal no deja saltar más adelante"
    static let atrasEnDemo = "En la demo no hay imagen guardada que repetir"
    static let atrasSinVentana = "Todavía no hay imagen guardada para retroceder"
    static let atrasAlPrincipio = "No hay más imagen guardada hacia atrás"

    /// «Retrocedido <n> s · pulsa DIRECTO para volver».
    static func retrocedido(_ segundos: Int) -> String { "Retrocedido \(segundos) s · pulsa DIRECTO para volver" }

    // MARK: Acciones del reproductor (index.tsx y api.ts)

    /// «Zapping: <título>».
    static func zapping(_ titulo: String) -> String { "Zapping: \(titulo)" }

    /// «Modo «Estable» activado» (api.ts › setPlaybackMode).
    static func modoActivado(_ etiqueta: String) -> String { "Modo «\(etiqueta)» activado" }

    // MARK: Sesión de fuentes (session.ts)

    static let canalSinAnunciar = "El canal todavía no está anunciado"
    static let buscandoFuentes = "Buscando fuentes para el partido…"
    static let comprobadorNoResponde = "El comprobador no responde; se muestran todas las fuentes"
    static let sinFuentesAhora = "Este partido no tiene fuentes ahora mismo."
    static let sigoComprobando =
        "Esta fuente no responde. Sigo comprobando las demás y arranco la primera que funcione."
    static let hashSeleccionado = "Reproduciendo el hash seleccionado"
    static let hashAnadido = "Hash externo añadido y reproduciendo"
    static let rebuscarSinCanales = "Este partido todavía no tiene canales anunciados"
    static let rebuscarSinNovedades = "No han aparecido fuentes nuevas para este partido"
    static let rebuscarPlazo = "La rebúsqueda está tardando demasiado; vuelve a intentarlo"
    static let rebuscarFallo = "No se pudo completar la rebúsqueda ahora mismo"
    static let fuenteApartada = "Fuente apartada; el segundo motor ya la está comprobando"
    static let reporteFallido = "No se pudo enviar el reporte"
    static let aprendida = "La asociación queda aprendida en el NAS"
    static let correccionFallida = "No se pudo guardar esta corrección"
    static let vinculoFallido = "El canal se reproduce, pero no pudimos recordar la asociación"
    static let canalPorConfirmar = "Canal por confirmar"

    /// «Comprobando N fuentes: arranca la primera que funcione…».
    static func comprobandoFuentes(_ total: Int) -> String {
        "Comprobando \(total) fuentes: arranca la primera que funcione…"
    }

    /// «Comprobando fuentes… n/N».
    static func comprobandoProgreso(_ comprobadas: Int, de total: Int) -> String {
        "Comprobando fuentes… \(comprobadas)/\(total)"
    }

    /// Comprobador en reposo: «…Las vuelvo a probar a las HH:MM…» o «…en unos minutos…».
    static func enReposo(_ total: Int, hora: String?) -> String {
        let cuando = hora.map { "Las vuelvo a probar a las \($0)" } ?? "Las vuelvo a probar en unos minutos"
        return "Ninguna de las \(total) fuentes da señal todavía. \(cuando) y arranco la primera que responda."
    }

    /// «Ninguna de las N fuentes da señal ahora mismo. Prueba "Rebuscar" o pega un Content ID.».
    static func ningunaDaSenal(_ total: Int) -> String {
        "Ninguna de las \(total) fuentes da señal ahora mismo. Prueba \"Rebuscar\" o pega un Content ID."
    }

    /// «Fuente N verificada: arrancando».
    static func verificadaArrancando(_ numero: Int) -> String { "Fuente \(numero) verificada: arrancando" }

    /// «Ninguna verificada del todo; probamos la fuente N, que da señal floja».
    static func probamosFloja(_ numero: Int) -> String {
        "Ninguna verificada del todo; probamos la fuente \(numero), que da señal floja"
    }

    /// «La señal inicial no responde; probamos automáticamente la fuente N».
    static func saltoInicial(_ numero: Int) -> String {
        "La señal inicial no responde; probamos automáticamente la fuente \(numero)"
    }

    /// Manual con alternativas: «Esta señal no responde. Tienes N fuente(s) más para este partido|canal: …».
    static func manualConOtras(_ otras: Int, partido: Bool) -> String {
        let fuentes = otras == 1 ? "fuente más" : "fuentes más"
        return "Esta señal no responde. Tienes \(otras) \(fuentes) para este \(partido ? "partido" : "canal"): "
            + "prueba otra en el selector."
    }

    /// Manual sin alternativas.
    static func manualSinOtras(partido: Bool) -> String {
        "Esta señal no responde y no quedan más fuentes para este \(partido ? "partido" : "canal"). "
            + "Prueba «Rebuscar» o pega un Content ID."
    }

    /// «Rebúsqueda: T señales reunidas, N sin probar antes · comprobándolas…[ · revisadas por la IA]».
    static func rebusqueda(_ total: Int, nuevas: Int, ia: Bool) -> String {
        "Rebúsqueda: \(total) señales reunidas, \(nuevas) sin probar antes · comprobándolas…\(ia ? revisadasIA : "")"
    }

    /// «Rebúsqueda terminada · …».
    static func rebusquedaTerminada(_ nuevas: Int, ia: Bool) -> String {
        let cola = ia ? revisadasIA : ""
        if nuevas == 0 { return "Rebúsqueda terminada · ninguna fuente nueva funciona\(cola)" }
        let que = nuevas == 1 ? "fuente nueva que funciona" : "fuentes nuevas que funcionan"
        return "Rebúsqueda terminada · \(nuevas) \(que)\(cola)"
    }

    static let revisadasIA = " · revisadas por la IA"

    /// «Ver la N» (acción del aviso de reporte).
    static func verLa(_ numero: Int) -> String { "Ver la \(numero)" }

    /// Aviso al elegir una fuente: «<Tipo · detalle> · <10 del hash>».
    static func eleccion(_ etiqueta: String, id: String) -> String { "\(etiqueta) · \(id.prefix(10))" }

    /// Título de una fuente pegada sin canal: «Stream <8>».
    static func stream(_ id: String) -> String { "Stream \(id.prefix(8))" }

    /// Título de un canal sin nombre: «Canal <8>».
    static func canal(_ id: String) -> String { "Canal \(id.prefix(8))" }

    // MARK: Para TextosTests

    /// Todos los textos fijos del catálogo.
    static let fijos: [String] = [
        conectando, reconectandoConAceStream, senalEncontrada, sinSenalSuficiente, imagenParada, senalCortada,
        sesionCaducada, noSePudoAbrir, reconectandoAlVolver, demoNoResponde, probandoSiguiente, senalRecuperada,
        senalIrregular, traspaso, sinAcceso, otroSeUne, vuelvesSolo, remuxReiniciado, motorReiniciado,
        noSePudoGuardarHistorial, directoEnDemo, yaEnDirecto, directoReanudado, deVueltaAlDirecto, noDejaSaltar,
        atrasEnDemo, atrasSinVentana, atrasAlPrincipio, canalSinAnunciar, buscandoFuentes, comprobadorNoResponde,
        sinFuentesAhora, sigoComprobando, hashSeleccionado, hashAnadido, rebuscarSinCanales, rebuscarSinNovedades,
        rebuscarPlazo, rebuscarFallo, fuenteApartada, reporteFallido, aprendida, correccionFallida, vinculoFallido,
        canalPorConfirmar, ReglasFuentes.textoHashNoValido, OpcionesReproductor.urlCopiada,
        OpcionesReproductor.enlaceCopiado, OpcionesReproductor.noSePudoCopiar, OpcionesReproductor.hashCopiado,
        OpcionesReproductor.hashNoCopiado, OpcionesReproductor.pipEnDemo, OpcionesReproductor.pipNoDisponible,
    ] + MotivoReposo.allCases.map(\.mensaje)
}
