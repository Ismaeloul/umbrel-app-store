import Foundation
import Testing

@testable import AceNeo

/* Gestos del teatro y del mini (lib/gestures.ts › classifySwipe, MiniPlayer.tsx, `stepSource`) y presentación de
   las fuentes y de «Otras fuentes» (features/sources/model.ts: TYPE_LABEL, qualityLabel, scanProgressText,
   rowMenu, librarySiblings, entryFromItem). */

struct GestosTeatroTests {
    @Test func clasificarComoLaWeb() {
        #expect(GestosTeatro.clasificar(dx: 0, dy: 60, vx: 0, vy: 0) == .abajo)
        #expect(GestosTeatro.clasificar(dx: 0, dy: 50, vx: 0, vy: 0) == .ninguna)
        #expect(GestosTeatro.clasificar(dx: 0, dy: 30, vx: 0, vy: 500) == .abajo)  // rápido con ≥ 24
        #expect(GestosTeatro.clasificar(dx: 0, dy: 20, vx: 0, vy: 900) == .ninguna)
        #expect(GestosTeatro.clasificar(dx: -70, dy: 10, vx: 0, vy: 0) == .izquierda)
        #expect(GestosTeatro.clasificar(dx: 70, dy: 60, vx: 0, vy: 0) == .ninguna)  // sin eje dominante 1,4×
        #expect(GestosTeatro.clasificar(dx: 0, dy: -80, vx: 0, vy: 0) == .arriba)
    }

    @Test func textoQueSigueAlDedo() {
        #expect(GestosTeatro.desplazamientoTexto(90) == 30)
        #expect(GestosTeatro.desplazamientoTexto(-300) == -60)
    }

    @Test func pasoEnBucle() {
        let ids = ["a", "b", "c"]
        #expect(GestosTeatro.paso(ids, activa: "b", delta: 1) == "c")
        #expect(GestosTeatro.paso(ids, activa: "c", delta: 1) == "a")
        #expect(GestosTeatro.paso(ids, activa: "a", delta: -1) == "c")
        #expect(GestosTeatro.paso(ids, activa: "z", delta: 1) == "a")
        #expect(GestosTeatro.paso(ids, activa: nil, delta: -1) == "c")
        #expect(GestosTeatro.paso([], activa: nil, delta: 1) == nil)
    }

    @Test func mini() {
        let d = GestosTeatro.desplazamientoMini(dx: 160, dy: 40)
        #expect(d.x == 160 && d.y == 10 && d.opacidad == 0.5)
        #expect(GestosTeatro.desplazamientoMini(dx: 400, dy: 0).opacidad == 0.35)
        #expect(GestosTeatro.cruzaDescarte(dx: 72, dy: 10))
        #expect(!GestosTeatro.cruzaDescarte(dx: 71, dy: 0))
        #expect(GestosTeatro.soltarMini(dx: 0, dy: -80, vx: 0, vy: 0) == .abrir)
        #expect(GestosTeatro.soltarMini(dx: 90, dy: 0, vx: 0, vy: 0) == .descartarDerecha)
        #expect(GestosTeatro.soltarMini(dx: -90, dy: 0, vx: 0, vy: 0) == .descartarIzquierda)
        #expect(GestosTeatro.soltarMini(dx: 0, dy: 90, vx: 0, vy: 0) == .volver)
        #expect(GestosTeatro.soltarMini(dx: 60, dy: 0, vx: 0, vy: 0) == .volver)
    }
}

private func item(_ id: String, _ titulo: String, tipo: ItemType, alias: String? = nil) -> Item {
    Item(id: id, title: titulo, alias: alias, type: tipo, category: "", date: "", fromWebSync: false, ih: false)
}

private func biblioteca(web: [Item] = [], favoritos: [Item] = [], recientes: [Item] = []) -> LibraryView {
    LibraryView(
        web: web, webSyncedAt: nil,
        webSources: [WebSourceSummary(id: "l1", name: "Directorio de Isma", url: "", type: .m3u, count: 0)],
        activeWebSourceId: "l1", favorites: favoritos, history: recientes)
}

struct PresentacionFuentesTests {
    @Test func tiposYProveedor() {
        #expect(PresentacionFuentes.tipo(origen: "m3u", ih: false) == "M3U")
        #expect(PresentacionFuentes.tipo(origen: "manual", ih: nil) == "Externa")
        #expect(PresentacionFuentes.tipo(origen: "iptv", ih: false) == "Fuente")  // un tipo nuevo no rompe nada
        #expect(PresentacionFuentes.tipo(origen: "otro", ih: true) == "AceStream")
        #expect(PresentacionFuentes.proveedor("M+ Liga de Campeones --> Elcano") == "Elcano")
        #expect(PresentacionFuentes.proveedor("DAZN → Faro") == "Faro")
        #expect(PresentacionFuentes.parteCanal("M+ Liga de Campeones --> Elcano") == "M+ Liga de Campeones")
        #expect(PresentacionFuentes.nombreLista("l1", listas: biblioteca().webSources) == "Isma")
    }

    @Test func calidadComoLaWeb() {
        #expect(PresentacionFuentes.calidad(nil) == nil)
        #expect(PresentacionFuentes.calidad(SondaFuente(estado: .working, kbps: 4000)) == "1080p")
        #expect(PresentacionFuentes.calidad(SondaFuente(estado: .working, kbps: 1700)) == "720p")
        #expect(PresentacionFuentes.calidad(SondaFuente(estado: .working, kbps: 900)) == "SD")
        #expect(PresentacionFuentes.calidad(SondaFuente(estado: .working, codec: "hevc", kbps: 5000)) == "1080p · HEVC")
        #expect(PresentacionFuentes.calidad(SondaFuente(estado: .working)) == nil)
    }

    @Test func filasYTextos() {
        let entradas = [
            EntradaFuente(id: "h1", titulo: "DAZN --> Elcano", ih: false, origen: "m3u", canal: "DAZN",
                          sonda: SondaFuente(estado: .working)),
            EntradaFuente(id: "h2", titulo: "DAZN --> Faro", ih: false, origen: "m3u", canal: "DAZN",
                          sonda: SondaFuente(estado: .failed)),
        ]
        let pantalla = EnPantalla(id: "h1", sonando: true, conectando: false)
        let filas = PresentacionFuentes.filas(
            entradas, activa: "h1", pantalla: pantalla, ahora: Date(timeIntervalSince1970: 0), listas: [],
            hayComprobador: true)
        #expect(filas.map(\.numero) == [1, 2])
        #expect(filas[0].enPantalla && filas[0].activa && filas[0].corto == "Elcano" && filas[0].palabra == "Verificada")
        #expect(filas[0].detalle == "reproduciendo ahora")
        #expect(filas[1].palabra == "Sin señal")
        #expect(filas[0].descripcion.hasPrefix("Fuente 1: DAZN --> Elcano · M3U · Elcano · Hash h1"))
        #expect(PresentacionFuentes.textoProgreso(nil, filas: [], precalentado: nil) == "Preparando fuentes")
        #expect(PresentacionFuentes.textoProgreso(nil, filas: filas, precalentado: nil) == "2 fuentes disponibles")
        #expect(PresentacionFuentes.textoPlegadas([filas[1]], abiertas: false) == "Ver 1 más sin señal")
        #expect(PresentacionFuentes.textoPlegadas([filas[1]], abiertas: true) == "Ocultar las que no dan señal")
    }

    @Test func menuDelCartel() {
        let entrada = EntradaFuente(id: "h1", titulo: "DAZN", ih: false, origen: "m3u", canal: "DAZN")
        let fila = PresentacionFuentes.fila(
            entrada, numero: 1, activa: "h1", pantalla: EnPantalla(id: "h1", sonando: true, conectando: false),
            ahora: Date(timeIntervalSince1970: 0), listas: [], hayComprobador: false)
        let partido = PresentacionFuentes.opcionesCartel(fila, enPartido: true)
        #expect(partido.map(\.titulo) == ["Ya está en pantalla", "Copiar hash", "Abrir en la app de AceStream", "Es el canal correcto", "Reportar…"])
        #expect(partido[0].deshabilitada && partido[3].separadaAntes && partido[4].peligro && !partido[4].separadaAntes)
        let canal = PresentacionFuentes.opcionesCartel(fila, enPartido: false)
        #expect(canal.map(\.titulo) == ["Ya está en pantalla", "Copiar hash", "Abrir en la app de AceStream", "Reportar…"])
        #expect(canal[3].separadaAntes)
    }
}

struct OtrasFuentesTests {
    @Test func hermanasDeLaBiblioteca() {
        let dazn1 = item("a", "DAZN 1", tipo: .fav)
        let dazn1HD = item("b", "DAZN 1 HD", tipo: .web)
        let movistar = item("c", "Movistar Liga de Campeones", tipo: .web)
        let lib = biblioteca(web: [dazn1HD, movistar], favoritos: [dazn1])
        let hermanas = OtrasFuentes.hermanas(lib, hash: "a")
        #expect(hermanas.map(\.id).contains("a") && hermanas.map(\.id).contains("b") && !hermanas.map(\.id).contains("c"))
        #expect(OtrasFuentes.cuenta(hermanas) == hermanas.count)
        #expect(OtrasFuentes.hermanas(lib, hash: "zzz").isEmpty)
        #expect(OtrasFuentes.cuenta([dazn1]) == 0)
    }

    @Test func origenYEntrada() {
        let fav = item("a", "DAZN 1", tipo: .fav)
        let web = item("b", "DAZN 1 HD", tipo: .web)
        let lib = biblioteca(web: [web], favoritos: [fav])
        #expect(OtrasFuentes.origen(nil, biblioteca: lib) == "Fuera de tu biblioteca")
        #expect(OtrasFuentes.origen(fav, biblioteca: lib) == "En tus favoritos")
        #expect(OtrasFuentes.origen(web, biblioteca: lib) == "De tu lista Directorio de Isma")
        #expect(OtrasFuentes.origen(item("r", "X", tipo: .recent), biblioteca: lib) == "En tus recientes")
        let entrada = OtrasFuentes.entrada(web, listaActiva: "l1")
        #expect(entrada.origen == "m3u" && entrada.listaId == "l1" && entrada.canal == "DAZN 1 HD")
        #expect(OtrasFuentes.entrada(fav, listaActiva: "l1").origen == "favorites")
        #expect(OtrasFuentes.titulo(nil, reproductor: nil, hash: "0123456789abcdef") == "Canal 01234567")
    }
}
