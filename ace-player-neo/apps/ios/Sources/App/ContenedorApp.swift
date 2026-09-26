import Foundation

/// Raíz de composición (b-arquitectura §2.3 y §2.5.7, I0): crea UNA vez los objetos de vida de proceso
/// (nunca dentro de una vista) y los cablea entre sí. Conforma `EntornoSesionFuentes`. Los módulos
/// pueden montar sus pantallas con `ContenedorApp.crear()` en un test o en `-AceNeoEscena`.
@MainActor final class ContenedorApp: EntornoSesionFuentes {
    static var actual: ContenedorApp?

    let entorno: Entorno
    let reloj: any Reloj
    let haptica: Haptica
    let estadoVentana: EstadoVentana
    let cicloVida: CicloVida
    let preferencias: PreferenciasLocales
    let sesion: SesionApp
    let datos: DatosApp
    let tiempoReal: TiempoReal
    let repartidor: RepartidorEventos
    let navegador: Navegador
    let hojas: CentroHojas
    let avisos: Avisos
    let transicion: TransicionTeatro
    let reproductor: Reproductor
    let presentacion: PresentacionReproductor
    let fuentes: SesionFuentes
    let senales: SenalPartidos
    let destapados: MarcadoresDestapados
    let relojCompartido: RelojCompartido
    let bajas: BajasPendientes
    let raiz: Raiz

    /// Entorno.actual() (real, demo o simulado), reloj de -AceNeoReloj y cableado de hooks (§2.5.7).
    static func crear() -> ContenedorApp {
        let entorno = Entorno.actual()
        var reloj: any Reloj = RelojSistema()
        if let inicio = ModoEjecucion.reloj { reloj = RelojDesplazado(inicio: inicio) }
        let contenedor = ContenedorApp(entorno: entorno, reloj: reloj, motor: motorPorDefecto())
        contenedor.cablear()
        contenedor.arrancar()
        return contenedor
    }

    /// Crea los objetos sin cablearlos (lo hace `crear()`). Los tests pueden pasar su motor de vídeo.
    /// Tipos escritos y dos ayudantes: todo en línea tardaba 453 ms en tiparse (CI 36177994191).
    init(entorno: Entorno, reloj: any Reloj, motor: any MotorVideo) {
        self.entorno = entorno
        self.reloj = reloj
        haptica = Haptica()
        estadoVentana = EstadoVentana()
        navegador = Navegador()
        hojas = CentroHojas()
        transicion = TransicionTeatro()
        destapados = MarcadoresDestapados()
        bajas = BajasPendientes()
        relojCompartido = RelojCompartido(reloj: reloj)
        let cicloVida: CicloVida = CicloVida()
        self.cicloVida = cicloVida
        let preferencias: PreferenciasLocales = PreferenciasLocales()
        self.preferencias = preferencias
        let sesion: SesionApp = SesionApp(entorno: entorno)
        self.sesion = sesion
        raiz = Raiz(faseInicial: sesion.fase)
        let datos: DatosApp = DatosApp(api: entorno.api, cache: entorno.cache)
        self.datos = datos
        let tiempoReal: TiempoReal = TiempoReal(cliente: entorno.tiempoReal, esDemo: ModoEjecucion.demo)
        self.tiempoReal = tiempoReal
        let avisos: Avisos = Avisos()
        self.avisos = avisos
        let reproductor: Reproductor = Self.crearReproductor(entorno, motor: motor, modo: preferencias.modo)
        self.reproductor = reproductor
        presentacion = PresentacionReproductor(reproductor: reproductor)
        let fuentes: SesionFuentes = SesionFuentes()
        self.fuentes = fuentes
        let senales: SenalPartidos = SenalPartidos()
        self.senales = senales
        repartidor = Self.crearRepartidor(
            datos, tiempoReal, sesion, reproductor, fuentes, senales, avisos, cicloVida)
    }

    private static func crearReproductor(_ entorno: Entorno, motor: any MotorVideo, modo: PlaybackMode)
        -> Reproductor
    {
        let servicio: ServicioReproduccionAPI = ServicioReproduccionAPI(api: entorno.api)
        let visor: String = IdentidadVisor.id()
        return Reproductor(motor: motor, servicio: servicio, visor: visor, modo: modo)
    }

    private static func crearRepartidor(
        _ datos: DatosApp, _ tiempoReal: TiempoReal, _ sesion: SesionApp, _ reproductor: Reproductor,
        _ fuentes: SesionFuentes, _ senales: SenalPartidos, _ avisos: Avisos, _ cicloVida: CicloVida
    ) -> RepartidorEventos {
        RepartidorEventos(
            datos: datos, tiempoReal: tiempoReal, sesion: sesion, reproductor: reproductor, fuentes: fuentes,
            senales: senales, avisos: avisos, cicloVida: cicloVida)
    }

    // MARK: EntornoSesionFuentes

    var api: APIClient { entorno.api }
    var visor: String { reproductor.visor }
    var tiempoRealAbierto: Bool { tiempoReal.abierto }

    // MARK: Cableado (§2.5.7)

    /// Los hooks entre objetos de proceso. Todos con `weak`: el contenedor vive lo que el proceso.
    private func cablear() {
        // 2. Acceso perdido → la raíz vuelve a Emparejar y el reproductor se para.
        sesion.alPerderAcceso = { [weak self] motivo in
            guard let self else { return }
            let reducido = ModoEjecucion.movimientoReducido
            Task { await self.raiz.volverAEmparejar(motivo: motivo, reducido: reducido) }
            self.reproductor.detener()
        }
        // 3. Eventos del SSE al repartidor; un 401 del SSE es acceso perdido.
        tiempoReal.alEvento = { [weak repartidor] evento in repartidor?.aplicar(evento) }
        tiempoReal.alPerderAcceso = { [weak sesion] in
            guard let sesion else { return }
            Task { await sesion.accesoPerdido(.noAutorizado) }
        }
        // 4. La sesión de fuentes decide la siguiente fuente; pantalla de bloqueo y mandos del sistema.
        fuentes.conectar(self)
        reproductor.alFallarFuente = { [weak fuentes] fallo in fuentes?.alFallarFuente(fallo) ?? false }
        ControlesSistema().conectar(reproductor)
        // 5. Fases de la escena (a8 §3.5). El reproductor (pausa del sistema) lo engancha M3.
        cicloVida.alCambiar.append { [weak sesion] antes, despues in
            if despues == .segundoPlano {
                sesion?.pasoASegundoPlano()
            } else if antes == .segundoPlano {
                sesion?.volvioAPrimerPlano()
            }
        }
        cicloVida.alCambiar.append { [weak tiempoReal, weak reproductor] antes, despues in
            if despues == .segundoPlano {
                tiempoReal?.pasoASegundoPlano(suena: reproductor?.quiereReproducir ?? false)
            } else if antes == .segundoPlano {
                tiempoReal?.reconectarYa()
            }
        }
        // M3: sin PiP la capa suelta el reproductor en segundo plano (sigue el audio); al volver, la recupera,
        // cierra el PiP y el reproductor comprueba la señal (latido y medio roto).
        cicloVida.alCambiar.append { [weak presentacion] antes, despues in
            if despues == .segundoPlano {
                presentacion?.pasoASegundoPlano()
            } else if antes == .segundoPlano {
                presentacion?.volvioAPrimerPlano()
            }
        }
        // 6. `datos.tiempoRealAbierto` sigue a `tiempoReal.estado`: lo hace el repartidor (M1).
    }

    /// Arranque de proceso (orden de M1/M4): repartidor y sesión.
    private func arrancar() {
        repartidor.arrancar()
        let sesion = self.sesion
        Task { await sesion.arrancar() }
    }

    /// El motor de vídeo: AVPlayer, o el simulado con la demo y en las pruebas de interfaz.
    private static func motorPorDefecto() -> any MotorVideo {
        #if DEBUG
            if ModoEjecucion.demo || ModoEjecucion.servidorSimulado { return MotorSimulado() }
        #endif
        return MotorAVPlayer()
    }
}
