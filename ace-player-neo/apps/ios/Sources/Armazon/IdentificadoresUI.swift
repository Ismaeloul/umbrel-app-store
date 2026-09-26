// Identificadores de interfaz (b-arquitectura §2.7, I0→M4). Compila en la app y en AceNeoUITests
// (project.yml): no puede depender de nada de la app, solo `static let` y `static func` con String.

/// Los mismos textos en la app (.accessibilityIdentifier) y en las pruebas. Solo String: nada de tipos de la app.
enum IDUI {
    // Armazón
    static let armazon = "armazon"
    static let barraPestanas = "barra-pestanas", barraSuperior = "barra-superior"
    static func pestana(_ id: String) -> String { "pestana-\(id)" }  // agenda · biblioteca · buscar · ajustes
    /// La raíz de cada pantalla (agenda · biblioteca · buscar · ajustes · emparejar · sistema).
    static func pantalla(_ id: String) -> String { "pantalla-\(id)" }
    static let mini = "mini-reproductor", miniPausa = "mini-pausa", miniDetener = "mini-detener", miniDonde = "mini-donde"
    static let toastAccion = "toast-accion", toastCerrar = "toast-cerrar", capsulaEstado = "capsula-estado"
    static let toast = "toast"  // (M4, aditivo: el marco del toast para los flujos)
    static let medidorTirones = "medidor-tirones"  // (M4, aditivo: -AceNeoMedirTirones, solo Debug)
    // Emparejar (a2 §22.9)
    static let visorCamara = "visor-camara", botonAjustesCamara = "boton-ajustes-camara"
    static let botonEscribirCodigo = "boton-escribir-codigo", campoCodigo = "campo-codigo"
    static let campoLan = "campo-lan", campoTailscale = "campo-tailscale", botonEmparejar = "boton-emparejar"
    static let errorEmparejar = "error-emparejar", avisoAcceso = "aviso-acceso"
    static let hojaOtroServidor = "hoja-otro-servidor", botonEmparejarDeNuevo = "boton-emparejar-de-nuevo"
    // Agenda
    static let heroe = "heroe", botonVerAhora = "boton-ver-ahora", tiraDias = "tira-dias"
    static func dia(_ fecha: String) -> String { "dia-\(fecha)" }  // AAAA-MM-DD
    static let filtroParaTi = "filtro-para-ti", filtroTodos = "filtro-todos"
    static func tarjetaPartido(_ id: String) -> String { "tarjeta-partido-\(id)" }
    static let botonActualizarAgenda = "boton-actualizar-agenda", tarjetaPrimerUso = "tarjeta-primer-uso"
    static let botonEditarGustos = "boton-editar-gustos", hojaGustos = "hoja-gustos"
    // Teatro
    static let teatro = "teatro", videoTeatro = "video-teatro", botonMinimizar = "boton-minimizar"
    static let capsulaMarcador = "capsula-marcador", botonFavorito = "boton-favorito", botonPip = "boton-pip"
    static let botonMasOpciones = "boton-mas-opciones", botonPausa = "boton-pausa", botonRetroceder = "boton-retroceder"
    static let botonSilencio = "boton-silencio", botonDirecto = "boton-directo"
    static let botonPantallaCompleta = "boton-pantalla-completa"
    static let cabeceraPartido = "cabecera-partido", cabeceraCanal = "cabecera-canal"
    static let pestanaFuentes = "pestana-fuentes", pestanaPartido = "pestana-partido", pestanaDatos = "pestana-datos"
    static func cartelFuente(_ n: Int) -> String { "cartel-fuente-\(n)" }
    static let barraEmitiendo = "barra-emitiendo", panelDatosTecnicos = "panel-datos-tecnicos"
    static let otrasSenales = "otras-senales"
    static let hojaReportar = "hoja-reportar", hojaEncontrarCanal = "hoja-encontrar-canal"
    static let pestanaCanal = "pestana-canal", botonReproducirCanal = "boton-reproducir-canal"  // (M6, aditivo)
    static let botonDetener = "boton-detener", panelMensajeVideo = "panel-mensaje-video"  // (M6, aditivo)
    // Canales, Buscar, Pegar
    static let buscadorBiblioteca = "buscador-biblioteca", emitiendoAhora = "emitiendo-ahora"
    static let pestanaFavoritos = "pestana-favoritos", pestanaRecientes = "pestana-recientes", pestanaListas = "pestana-listas"
    static func filaCanal(_ hash: String) -> String { "fila-canal-\(hash)" }
    static func categoria(_ nombre: String) -> String { "categoria-\(nombre)" }
    static let campoBuscar = "campo-buscar", enlaceDetectado = "enlace-detectado"
    static func resultado(_ hash: String) -> String { "resultado-\(hash)" }
    static let hojaPegar = "hoja-pegar", campoHash = "campo-hash", botonPegarPortapapeles = "boton-pegar-portapapeles"
    static let hojaGuardarFavorito = "hoja-guardar-favorito", hojaRenombrar = "hoja-renombrar"
    // Ajustes
    static let indiceAjustes = "indice-ajustes"
    static func chip(_ seccion: String) -> String { "chip-\(seccion)" }
    static func seccion(_ id: String) -> String { "seccion-\(id)" }
    static func filaDispositivo(_ id: String) -> String { "fila-dispositivo-\(id)" }
    static let filaEsteIPhone = "fila-este-iphone", botonOlvidarEsteIPhone = "boton-olvidar-este-iphone"
    static let versionApp = "version-app", visorEsteDispositivo = "visor-este-dispositivo"
    static func sesion(_ id: String) -> String { "sesion-\(id)" }
    static let hojaAyuda = "hoja-ayuda"
    // Ajustes (M7, añadidos aditivos: controles que tocan FlujoAjustesUITests)
    static let segmentadoTema = "segmentado-tema", interruptorTransparencia = "interruptor-transparencia"
    static let botonEmparejarDispositivo = "boton-emparejar-dispositivo", botonAtajos = "boton-atajos"
    static func botonRevocar(_ id: String) -> String { "boton-revocar-\(id)" }
}
