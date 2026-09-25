import Foundation

/* La tabla única de a1 §8.1 como datos (b-arquitectura §1.4, M2): qué sensación da cada sitio de la app.
   Las pantallas llaman `haptica.disparar(SitioHaptico.x.tipo!)` (o `SitiosHapticos.disparar`) en vez de
   escribir el tipo a mano, así la tabla y el código no se separan. Correcciones de b-arquitectura §0.3:
   la pulsación larga que abre un menú contextual NO lanza nada propio (el `.contextMenu` del sistema ya
   vibra), y tocar la pestaña activa sube arriba sin háptica. */

/// De dónde sale cada fila: calcada de la web, añadida en nativo (lo pedía el mapa) o ninguna.
enum OrigenHaptico: String, Sendable { case web, anadido, ninguno }

enum SitioHaptico: String, CaseIterable, Sendable {
    // Armazón
    case barraCambiarDestino
    case hojaCerrarArrastrando
    case hojaCerrarConBoton
    // Agenda
    case agendaAbrirPartido
    case agendaCambiarDia
    case agendaParaTiTodos
    case agendaDestaparMarcador
    case agendaMenuPartido
    // Canales
    case canalesTocarCartel
    case canalesDestaparMarcador
    case canalesTocarFila
    case canalesMenuFila
    case canalesPestanas
    case canalesFavoritoGuardado
    // Escenario
    case escenarioPestanas
    case escenarioGol
    case escenarioDestaparMarcador
    // Fuentes
    case fuenteElegir
    case fuenteMenuCartel
    case fuenteAnteriorSiguiente
    case fuenteCambioAutomatico
    case fuenteFallaManual
    case fuenteHashPegado
    case fuenteReportada
    // Reproductor
    case reproductorPausa
    case reproductorSilencio
    case reproductorDetener
    case reproductorZapping
    case reproductorPantallaCompleta
    case reproductorFavoritoGuardado
    case reproductorMinimizar
    case reproductorMenuVideo
    // Mini
    case miniAbrirDeslizando
    case miniAbrirTocando
    case miniUmbralDescartar
    // Pegar, buscar, gustos
    case pegarContentIDValido
    case buscarReproducirEnlace
    case gustosChip
    case gustosGuardar
    // Ajustes
    case ajustesIndice
    case ajustesModoReproduccion
    case ajustesUnCanalCadaVez
    case ajustesTema
    case ajustesReducirTransparencia
    case dispositivosOtroEmparejado
    case dispositivosMenuFila
    // Emparejar (solo app)
    case emparejarHecho
    case emparejarCodigoInvalido
    // Galería y menús
    case galeriaPulsacionLarga
    case menuMasOpciones

    /// La sensación de ese sitio, o `nil` si no vibra (o vibra el sistema).
    var tipo: TipoHaptico? { SitiosHapticos.fila(self).tipo }

    /// Calcada de la web, añadida en nativo o ninguna.
    var origen: OrigenHaptico { SitiosHapticos.fila(self).origen }
}

/// Una fila de la tabla: la sensación (o ninguna), de dónde sale y la referencia de la web.
struct FilaHaptica: Sendable {
    var tipo: TipoHaptico?
    var origen: OrigenHaptico
    var donde: String
}

enum SitiosHapticos {
    /// a1 §8.1 (con las correcciones de b-arquitectura §0.3). Un `switch` y no un diccionario: tipa al instante.
    static func fila(_ sitio: SitioHaptico) -> FilaHaptica {
        let datos: (TipoHaptico?, OrigenHaptico, String)
        switch sitio {
        case .barraCambiarDestino: datos = (.seleccion, .anadido, "app/Nav.tsx no lanza; lo pide el mapa")
        case .hojaCerrarArrastrando: datos = (.media, .anadido, "ui/Sheet.tsx no lanza; lo pide el mapa")
        case .hojaCerrarConBoton: datos = (nil, .ninguno, "la acción ya lleva la suya")
        case .agendaAbrirPartido: datos = (.ligera, .web, "features/agenda/index.tsx:215")
        case .agendaCambiarDia: datos = (.seleccion, .web, "agenda/index.tsx:228")
        case .agendaParaTiTodos: datos = (.seleccion, .web, "agenda/index.tsx:249")
        case .agendaDestaparMarcador: datos = (.ligera, .web, "agenda/MatchRow.tsx:173 y :191")
        case .agendaMenuPartido: datos = (nil, .ninguno, "MatchRow.tsx:259; en nativo vibra el menú del sistema (§0.3)")
        case .canalesTocarCartel: datos = (.ligera, .web, "library/ChannelPoster.tsx:61")
        case .canalesDestaparMarcador: datos = (.ligera, .web, "library/ChannelPoster.tsx:157")
        case .canalesTocarFila: datos = (.ligera, .anadido, "misma acción que el cartel")
        case .canalesMenuFila: datos = (nil, .ninguno, "ChannelRow.tsx:195; en nativo vibra el menú del sistema (§0.3)")
        case .canalesPestanas: datos = (.seleccion, .web, "library/LibraryView.tsx:120")
        case .canalesFavoritoGuardado: datos = (.exito, .web, "library/useChannelActions.tsx:199")
        case .escenarioPestanas: datos = (.seleccion, .web, "match-center/TheaterTabs.tsx:113")
        case .escenarioGol: datos = (.exito, .web, "match-center/Scoreboard.tsx:153")
        case .escenarioDestaparMarcador: datos = (.ligera, .web, "Scoreboard.tsx:165 y :272")
        case .fuenteElegir: datos = (.rigida, .web, "sources/SourcePoster.tsx:128")
        case .fuenteMenuCartel: datos = (nil, .ninguno, "SourcePoster.tsx:101; en nativo vibra el menú del sistema (§0.3)")
        case .fuenteAnteriorSiguiente: datos = (.rigida, .web, "sources/SourcesPanel.tsx:44")
        case .fuenteCambioAutomatico: datos = (.aviso, .web, "sources/session.ts:785 y :937")
        case .fuenteFallaManual: datos = (.error, .web, "sources/session.ts:954")
        case .fuenteHashPegado: datos = (.exito, .web, "sources/session.ts:1031")
        case .fuenteReportada: datos = (.exito, .web, "sources/session.ts:1173")
        case .reproductorPausa: datos = (.ligera, .web, "player/index.tsx:278")
        case .reproductorSilencio: datos = (.ligera, .web, "player/index.tsx:301")
        case .reproductorDetener: datos = (.rigida, .web, "player/index.tsx:283")
        case .reproductorZapping: datos = (.rigida, .web, "player/index.tsx:260")
        case .reproductorPantallaCompleta: datos = (.media, .web, "player/index.tsx:272 y :317")
        case .reproductorFavoritoGuardado: datos = (.exito, .web, "player/index.tsx:354")
        case .reproductorMinimizar: datos = (.ligera, .web, "player/index.tsx:373")
        case .reproductorMenuVideo: datos = (nil, .ninguno, "PlayerSurface.tsx:188; en nativo vibra el menú del sistema (§0.3)")
        case .miniAbrirDeslizando: datos = (.ligera, .web, "player/MiniPlayer.tsx:170")
        case .miniAbrirTocando: datos = (nil, .ninguno, "no lanza")
        case .miniUmbralDescartar: datos = (.fuerte, .web, "player/MiniPlayer.tsx:117, una vez por cruce")
        case .pegarContentIDValido: datos = (.exito, .web, "paste-hash/PasteHashSheet.tsx:80")
        case .buscarReproducirEnlace: datos = (.exito, .web, "search/SearchView.tsx:178")
        case .gustosChip: datos = (.seleccion, .web, "preferences/PreferencesSheet.tsx:119 y :110")
        case .gustosGuardar: datos = (.exito, .web, "PreferencesSheet.tsx:238")
        case .ajustesIndice: datos = (.seleccion, .web, "settings/SettingsView.tsx:689")
        case .ajustesModoReproduccion: datos = (.seleccion, .web, "SettingsView.tsx:251")
        case .ajustesUnCanalCadaVez: datos = (.seleccion, .web, "SettingsView.tsx:272")
        case .ajustesTema: datos = (.seleccion, .web, "SettingsView.tsx:312")
        case .ajustesReducirTransparencia: datos = (.seleccion, .web, "SettingsView.tsx:332")
        case .dispositivosOtroEmparejado: datos = (.exito, .web, "devices/PairingPanel.tsx:56")
        case .dispositivosMenuFila: datos = (nil, .ninguno, "DevicesSection.tsx:69; en nativo vibra el menú del sistema (§0.3)")
        case .emparejarHecho: datos = (.exito, .anadido, "solo app: QR leído y emparejado")
        case .emparejarCodigoInvalido: datos = (.error, .anadido, "solo app: código inválido o QR ajeno")
        case .galeriaPulsacionLarga: datos = (nil, .ninguno, "menú contextual: vibra el del sistema (§0.3)")
        case .menuMasOpciones: datos = (nil, .ninguno, "abrir o elegir en «Más opciones» no vibra")
        }
        return FilaHaptica(tipo: datos.0, origen: datos.1, donde: datos.2)
    }
}
