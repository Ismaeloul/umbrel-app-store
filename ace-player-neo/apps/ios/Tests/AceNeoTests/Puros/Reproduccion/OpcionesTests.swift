import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Los menús del reproductor (a4 §5.6-§5.7, `allMenuItems` de player/index.tsx) y del cartel de fuente (`rowMenu`
   de features/sources/SourcePoster.tsx): rótulos, iconos, orden, separadores, peligro, ✓ y háptica. */

private let hash = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"

private func contexto(
    quiere: Bool = true, retroceder: Bool = true, zapeo: Bool = false, datos: Bool = false, pip: Bool = true,
    hash: String = hash
) -> ContextoOpcionesReproductor {
    ContextoOpcionesReproductor(
        hayCanal: true, quiereReproducir: quiere, puedeRetroceder: retroceder, puedeZapear: zapeo,
        datosTecnicosAbiertos: datos, puedePantallaCompleta: true, puedePiP: pip, hash: hash)
}

struct OpcionesReproductorTests {
    @Test func catorceOpcionesConZappingEnSuOrden() {
        let menu = OpcionesReproductor.menu(contexto(zapeo: true))
        #expect(
            menu.map(\.titulo) == [
                "Pausar", "Retroceder 30 s", "Ir al directo", "Detener", "Canal anterior", "Canal siguiente",
                "Datos técnicos", "Dónde se está reproduciendo", "Pantalla completa", "Imagen dentro de imagen",
                "Abrir en la app de AceStream", "Copiar URL del stream (VLC)", "Copiar enlace acestream://",
                "Copiar hash",
            ])
        #expect(menu.map(\.icono) == [
            .pause, .back, .directo, .stop, .chevL, .chevR, .nerd, .tv, .full, .pip, .externo, .link, .copy, .hash,
        ])
        // Separadores: «Canal anterior» y «Abrir en la app de AceStream».
        #expect(menu.filter(\.separadaAntes).map(\.id) == ["anterior", "abrir"])
        #expect(menu.filter(\.peligro).map(\.id) == ["detener"])
    }

    @Test func sinZappingDoceYElSeparadorVaEnDatosTecnicos() {
        let menu = OpcionesReproductor.menu(contexto())
        #expect(menu.count == 12)
        #expect(menu.filter(\.separadaAntes).map(\.id) == ["nerd", "abrir"])
    }

    @Test func rotulosYEstadosQueCambian() {
        #expect(OpcionesReproductor.menu(contexto(quiere: false)).first?.titulo == "Reproducir")
        #expect(OpcionesReproductor.menu(contexto(quiere: false)).first?.icono == .play)
        #expect(OpcionesReproductor.menu(contexto(retroceder: false))[1].deshabilitada)
        #expect(OpcionesReproductor.menu(contexto(datos: true)).first { $0.id == "nerd" }?.marcada == true)
        #expect(!OpcionesReproductor.menu(contexto(pip: false)).contains { $0.id == "pip" })
        // «Copiar hash» solo con 40 hex en minúsculas (un identificador de otro tipo no se copia como hash).
        #expect(OpcionesReproductor.menu(contexto(hash: "iptv:canal-1")).last?.deshabilitada == true)
        #expect(OpcionesReproductor.menu(contexto()).last?.deshabilitada == false)
        let sinCanal = ContextoOpcionesReproductor(
            hayCanal: false, quiereReproducir: false, puedeRetroceder: false, puedeZapear: false,
            datosTecnicosAbiertos: false, puedePantallaCompleta: true, puedePiP: true, hash: "")
        #expect(OpcionesReproductor.menu(sinCanal).isEmpty)
    }

    @Test func hapticaDeCadaOpcion() {
        var haptica: [String: TipoHaptico] = [:]
        for opcion in OpcionesReproductor.menu(contexto(zapeo: true)) { haptica[opcion.id] = opcion.haptica }
        #expect(haptica == ["pausa": .ligera, "detener": .rigida, "anterior": .rigida, "siguiente": .rigida, "completa": .media])
    }

    @Test func enlacesAbrirEn() {
        #expect(OpcionesReproductor.enlaceAceStream(hash) == "acestream://\(hash)")
        #expect(
            OpcionesReproductor.urlExterna(hash, tipo: .auto, origen: "http://umbrel.local:8765")
                == "http://umbrel.local:8765/ace/getstream?id=\(hash)")
        #expect(OpcionesReproductor.urlExterna(hash, tipo: .infohash, origen: "") == "/ace/getstream?infohash=\(hash)")
    }
}

struct OpcionesFuenteTests {
    private func fila(enPantalla: Bool, activa: Bool, aprendida: LearnedVerdict? = nil) -> FilaFuente {
        var entrada = EntradaFuente(id: hash, titulo: "M+ --> Elcano", ih: false, origen: "m3u", canal: "M+")
        entrada.aprendida = aprendida
        let presentacion = PresentacionFuente(tipo: "M3U", lista: "", proveedor: "Elcano", etiqueta: "M3U · Elcano", corto: "Elcano")
        return FilaFuente(
            entrada: entrada, numero: 1, efectivo: Efectivo(estado: .working, motivo: "", reportada: false), senal: .ok,
            palabra: "Verificada", detalle: "verificada", presentacion: presentacion, activa: activa,
            enPantalla: enPantalla, descripcion: "")
    }

    @Test func enElPartidoLaActivaPuedeAprenderse() {
        let menu = OpcionesFuente.menu(fila(enPantalla: true, activa: true), enPartido: true)
        #expect(
            menu.map(\.titulo) == [
                "Ya está en pantalla", "Copiar hash", "Abrir en la app de AceStream", "Es el canal correcto", "Reportar…",
            ])
        #expect(menu[0].deshabilitada)
        #expect(menu.filter(\.separadaAntes).map(\.id) == ["correcto"])
        #expect(menu.last?.peligro == true && menu.last?.icono == .flag)
        #expect(menu.allSatisfy { $0.haptica == nil }, "Ninguna opción del cartel vibra")
        // Las acciones de VoiceOver: las habilitadas, sin «Ya está en pantalla».
        #expect(OpcionesFuente.accionesAccesibles(fila(enPantalla: true, activa: true), enPartido: true).first?.id == "copiar-hash")
    }

    @Test func otraFuenteOEnUnCanal() {
        let menu = OpcionesFuente.menu(fila(enPantalla: false, activa: false), enPartido: true)
        #expect(menu.map(\.titulo) == ["Ver esta fuente", "Copiar hash", "Abrir en la app de AceStream", "Reportar…"])
        #expect(menu.filter(\.separadaAntes).map(\.id) == ["reportar"])
        #expect(!OpcionesFuente.menu(fila(enPantalla: true, activa: true), enPartido: false).contains { $0.id == "correcto" })
        #expect(
            !OpcionesFuente.menu(fila(enPantalla: true, activa: true, aprendida: .correct), enPartido: true)
                .contains { $0.id == "correcto" })
    }
}
