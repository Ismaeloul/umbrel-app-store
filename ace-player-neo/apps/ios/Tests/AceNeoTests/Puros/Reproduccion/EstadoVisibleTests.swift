import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Lo que se ve del reproductor: los casos de apps/web/src/player/status.test.ts (statusFor, liveButton,
   stageMessage) y los de «Datos técnicos» (formatSpeed, nerdRows), portados uno a uno. */

private func sonando(
    fase: FaseReproductor = .reproduciendo, conexion: FaseConexion = .activa, directo: DirectoVisible? = nil,
    mensaje: String? = nil, intento: IntentoReconexion? = nil, demo: Bool = false
) -> FotoReproductor {
    FotoReproductor(
        fase: fase, conexion: conexion, hayCanal: true, arranco: true, lead: "Fuente 1 verificada.", espera: nil,
        reposo: nil, mensaje: mensaje, intento: intento,
        directo: directo ?? DirectoVisible(disponible: true, enDirecto: true, porDetrasS: 1, retrasoS: 6), demo: demo)
}

struct LineaDeEstadoTests {
    @Test func enDirectoFraseHumanaYRetrasoALaDerecha() {
        #expect(
            EstadoVisible.linea(sonando())
                == ContenidoLinea(texto: "Fuente 1 verificada. Vas en directo.", senal: .ok, dato: "6 s de retraso"))
    }

    @Test func porDetrasLoDiceConLosSegundos() {
        let linea = EstadoVisible.linea(
            sonando(directo: DirectoVisible(disponible: true, enDirecto: false, porDetrasS: 36, retrasoS: 42)))
        #expect(linea?.texto == "Vas por detrás del directo.")
        #expect(linea?.dato == "−36 s")
    }

    @Test func rellenandoMedidorFlojo() {
        #expect(EstadoVisible.linea(sonando(fase: .buffer))?.senal == .weak)
        #expect(EstadoVisible.linea(sonando(fase: .buffer))?.texto == "Fuente 1 verificada. La señal va justa: rellenando el colchón.")
    }

    @Test func reconectandoYError() {
        let reconectando = EstadoVisible.linea(
            sonando(
                fase: .reconectando, mensaje: "La señal se ha cortado: reconectando (1/3)…",
                intento: IntentoReconexion(n: 1, max: 3)))
        #expect(
            reconectando
                == ContenidoLinea(texto: "La señal se ha cortado: reconectando (1/3)…", tono: .warn, senal: .checking))
        let error = EstadoVisible.linea(sonando(fase: .error, mensaje: "Sin pares."))
        #expect(error?.texto == "Sin pares." && error?.senal == .fail && error?.tono == .err)
    }

    @Test func conectandoConElIntento() {
        let linea = EstadoVisible.linea(
            sonando(fase: .cargando, conexion: .pidiendo, intento: IntentoReconexion(n: 2, max: 3)))
        #expect(linea?.texto == "Conectando con AceStream…" && linea?.dato == "intento 2 de 3")
    }

    @Test func enReposoSoloHablaSiHayAlgoQueDecir() {
        #expect(EstadoVisible.linea(FotoReproductor()) == nil)
        var esperando = FotoReproductor()
        esperando.espera = "Comprobando 5 fuentes…"
        #expect(EstadoVisible.linea(esperando) == ContenidoLinea(texto: "Comprobando 5 fuentes…", senal: .checking))
        var detenido = FotoReproductor()
        detenido.reposo = .detenido
        detenido.mensaje = MotivoReposo.detenido.mensaje
        #expect(EstadoVisible.linea(detenido)?.icono == .stop)
    }

    @Test func enPausaYEnDemo() {
        let pausa = EstadoVisible.linea(
            sonando(fase: .pausado, directo: DirectoVisible(disponible: true, enDirecto: false, porDetrasS: 12, retrasoS: 20)))
        #expect(pausa?.texto == "En pausa. Pulsa Directo para volver al directo." && pausa?.dato == "−12 s")
        #expect(EstadoVisible.linea(sonando(demo: true))?.dato == "demo")
        #expect(EstadoVisible.linea(sonando(fase: .buscando))?.texto == "Saltando…")
    }
}

struct BotonDirectoTests {
    @Test func rellenoDirectoEnElBorde() {
        let boton = EstadoVisible.botonDirecto(sonando())
        #expect(boton.modo == .live && boton.texto == "Directo" && boton.etiqueta == "Ya en directo")
    }

    @Test func contornoIrAlDirectoPorDetras() {
        let boton = EstadoVisible.botonDirecto(
            sonando(directo: DirectoVisible(disponible: true, enDirecto: false, porDetrasS: 34, retrasoS: 40)))
        #expect(boton.modo == .behind)
        #expect(boton.prefijo + boton.texto == "Ir al directo · −34 s")
        #expect(boton.etiqueta == "Ir al directo (vas 34 segundos por detrás)")
    }

    @Test func reanudarEnPausaEnElBorde() {
        #expect(EstadoVisible.botonDirecto(sonando(fase: .pausado)).texto == "Reanudar")
        #expect(EstadoVisible.botonDirecto(sonando(fase: .pausado)).etiqueta == "Reanudar en directo")
    }

    @Test func sinCanalOSinImagenApagado() {
        #expect(EstadoVisible.botonDirecto(FotoReproductor()).modo == .off)
        #expect(EstadoVisible.botonDirecto(sonando(fase: .cargando, conexion: .conectando)).modo == .off)
        #expect(
            EstadoVisible.botonDirecto(
                sonando(directo: DirectoVisible(disponible: true, enDirecto: false, porDetrasS: 5, retrasoS: 9), demo: true)
            ).modo == .live, "En demo no se va por detrás")
    }
}

struct PanelDelVideoTests {
    @Test func reposoConectandoReconectandoYError() {
        #expect(EstadoVisible.mensajeEscenario(FotoReproductor())?.titulo == "Sin señal")
        #expect(EstadoVisible.mensajeEscenario(FotoReproductor())?.texto == MotivoReposo.inicio.mensaje)
        var conectando = FotoReproductor(fase: .cargando, conexion: .pidiendo, hayCanal: true)
        conectando.mensaje = "Conectando con AceStream…"
        #expect(
            EstadoVisible.mensajeEscenario(conectando)
                == MensajeEscenario(titulo: "Conectando", texto: "Conectando con AceStream…", tono: .ocupado))
        #expect(
            EstadoVisible.mensajeEscenario(sonando(fase: .reconectando, conexion: .reconectando))?.titulo == "Reconectando")
        let error = EstadoVisible.mensajeEscenario(sonando(fase: .error, conexion: .error, mensaje: "x"))
        #expect(error?.titulo == "No se pudo abrir" && error?.tono == .error)
        var otro = FotoReproductor()
        otro.reposo = .traspasado
        otro.mensaje = MotivoReposo.traspasado.mensaje
        #expect(EstadoVisible.mensajeEscenario(otro)?.titulo == "En otro dispositivo")
        var buscando = FotoReproductor()
        buscando.espera = "Buscando fuentes para el partido…"
        #expect(EstadoVisible.mensajeEscenario(buscando)?.titulo == "Buscando señal")
    }

    @Test func reanudarTrasUnaPausaNoTapaElVideo() {
        #expect(EstadoVisible.mensajeEscenario(sonando(fase: .cargando, conexion: .activa)) == nil)
        #expect(EstadoVisible.mensajeEscenario(sonando()) == nil)
        // Con imagen antes (o con intento), el titular es «Reconectando».
        #expect(EstadoVisible.mensajeEscenario(sonando(fase: .cargando, conexion: .conectando))?.titulo == "Reconectando")
    }

    @Test func mensajesDeReposoDeLaWeb() {
        #expect(MotivoReposo.de(nil, hayCanal: false) == .inicio)
        #expect(MotivoReposo.de(nil, hayCanal: true) == nil)
        #expect(MotivoReposo.de(.usuario, hayCanal: false) == .detenido)
        #expect(MotivoReposo.de(.sinAcceso, hayCanal: true) == .fallo)
        #expect(MotivoReposo.sinMotor.mensaje == "El motor AceStream no responde. Se reanudará solo cuando vuelva.")
    }
}

struct DatosTecnicosTests {
    @Test func velocidadesComoLaWeb() {
        #expect(EstadoVisible.velocidad(214) == "214 KB/s")
        #expect(EstadoVisible.velocidad(1966) == "1,92 MB/s")
        #expect(EstadoVisible.velocidad(nil) == "—")
        #expect(EstadoVisible.segundos(6) == "6 s")
        #expect(EstadoVisible.segundos(2.54) == "2,5 s")
    }

    @Test func filasDelPanel() {
        let estadisticas = StreamStatsData(
            sessionId: "s", viewerIds: [], status: "dl", peers: 48, speedDown: 1966, speedUp: 214, downloaded: nil, at: "")
        let filas = EstadoVisible.filasDatosTecnicos(
            EstadoVisible.DatosTecnicos(
                motor: "en línea", demo: false, hayMotorVideo: true, protocolo: .hlsFmp4, estadisticas: estadisticas,
                colchonS: 7.4, retrasoS: 9, primeraImagenMs: 2400, codec: nil, sesion: "s_1"))
        var porNombre: [String: String] = [:]
        for (nombre, valor) in filas { porNombre[nombre] = valor }
        #expect(porNombre["Motor"] == "en línea")
        #expect(porNombre["Reproductor"] == "HLS del sistema")
        #expect(porNombre["Entrega"] == "remux fMP4 para iPhone")
        #expect(porNombre["Pares"] == "48")
        #expect(porNombre["Bajada"] == "1,92 MB/s")
        #expect(porNombre["Subida"] == "214 KB/s")
        #expect(porNombre["Colchón"] == "7,4 s")
        #expect(porNombre["Primera imagen"] == "2,4 s")
        #expect(porNombre["Códec"] == "—")
        #expect(filas.map(\.0).first == "Motor" && filas.map(\.0).last == "Sesión")
    }
}
