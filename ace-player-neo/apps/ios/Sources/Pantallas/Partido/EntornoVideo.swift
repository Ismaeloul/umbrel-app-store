import AVFoundation
import SwiftUI
import UIKit

/* Lo que comparten el escenario, sus controles, el menú del vídeo y el mini: los objetos de proceso del
   entorno y las acciones del reproductor de la web (player/index.tsx › `actions`, con su háptica de
   lib/haptics.ts y sus avisos). Un `DynamicProperty`: cada vista lo declara y SwiftUI rellena el entorno. */

@MainActor
struct EntornoVideo: DynamicProperty {
    @Environment(Reproductor.self) var reproductor
    @Environment(PresentacionReproductor.self) var presentacion
    @Environment(SesionFuentes.self) var fuentes
    @Environment(DatosApp.self) var datos
    @Environment(Navegador.self) var navegador
    @Environment(Avisos.self) var avisos
    @Environment(Haptica.self) var haptica
    @Environment(GestorPiP.self) var pip
    @Environment(\.modoDemo) var demo
    @Environment(\.servidores) var servidores

    /// La foto del reproductor que leen las reglas puras (EstadoEscenario).
    var foto: FotoReproductor {
        let canal = reproductor.canal
        return FotoReproductor(
            titulo: canal?.titulo, hash: canal?.id, fase: reproductor.fase, conexion: reproductor.conexion,
            mensaje: reproductor.mensaje, intento: reproductor.intento, directo: reproductor.directo,
            arranco: reproductor.arranco, motivoParada: reproductor.motivoParada,
            quiereReproducir: reproductor.quiereReproducir, demo: demo, espera: fuentes.textoEspera,
            lead: lead(canal))
    }

    /// «Fuente n verificada.» / «Fuente n, señal floja.» / «Fuente n.» (solo en partidos; a4 §20.9).
    private func lead(_ canal: CanalReproducible?) -> String? {
        guard let canal, canal.partido != nil, let i = fuentes.entradas.firstIndex(where: { $0.id == canal.id }) else {
            return nil
        }
        let n = i + 1
        switch fuentes.entradas[i].sonda?.estado {
        case .some(.working): return "Fuente \(n) verificada."
        case .some(.weak): return "Fuente \(n), señal floja."
        default: return "Fuente \(n)."
        }
    }

    /// Subtítulo de lo que suena (a4 §20.9): partido «Fuente {n}, {proveedor corto}»; canal con hermanas
    /// «Fuente {n} de {total}»; si no, ninguno. Nunca el marcador.
    var subtitulo: String? {
        guard let canal = reproductor.canal, let i = fuentes.entradas.firstIndex(where: { $0.id == canal.id }) else {
            return nil
        }
        let entrada = fuentes.entradas[i]
        if canal.partido != nil {
            let listas = datos.biblioteca.datos?.webSources ?? []
            let quien = PresentacionFuentes.proveedor(entrada.titulo)
            let lista = PresentacionFuentes.nombreLista(entrada.listaId, listas: listas)
            let corto = !quien.isEmpty ? quien : (!lista.isEmpty ? lista : PresentacionFuentes.tipo(origen: entrada.origen, ih: entrada.ih))
            return "Fuente \(i + 1), \(corto)"
        }
        return fuentes.entradas.count > 1 ? "Fuente \(i + 1) de \(fuentes.entradas.count)" : nil
    }

    /// Lo que hay en pantalla para la regla «la que se ve manda» (`onScreenOf`, model.ts).
    var enPantalla: EnPantalla {
        let fase = reproductor.fase
        guard fase != .idle, fase != .error, let id = reproductor.canal?.id else { return .nada }
        let fasesSonando: [FaseReproductor] = [.reproduciendo, .pausado, .buffer, .buscando]
        let fasesConectando: [FaseReproductor] = [.cargando, .reconectando, .buffer]
        let sonando: Bool = reproductor.arranco && fasesSonando.contains(fase)
        let conectando: Bool = !sonando && fasesConectando.contains(fase)
        return EnPantalla(id: id, sonando: sonando, conectando: conectando)
    }

    var esFavorito: Bool {
        guard let hash = reproductor.canal?.id else { return false }
        return datos.biblioteca.datos?.favorites.contains { $0.id == hash } ?? false
    }

    // MARK: Fuentes

    /// Las que se ven, en orden: las de la sesión de fuentes; en un canal suelto con la sesión aún vacía, sus
    /// hermanas de la biblioteca («Otras fuentes», §0.0 punto 1).
    var idsFuentesVisibles: [String] {
        if !fuentes.entradas.isEmpty { return fuentes.visibles.map(\.id) }
        guard case .canal(let hash) = navegador.capa else { return [] }
        let hermanas = OtrasFuentes.hermanas(datos.biblioteca.datos, hash: hash)
        return hermanas.count > 1 ? hermanas.map(\.id) : []
    }

    /// ‹ › de «Emitiendo» y deslizar el vídeo a los lados: la siguiente o anterior en bucle (háptica rígida).
    /// Con la sesión llena manda la regla de la sesión (`stepSource`, M3); solo las hermanas de un canal con la
    /// sesión vacía se recorren aquí.
    func pasoFuente(_ delta: Int) {
        if !fuentes.entradas.isEmpty {
            guard fuentes.visibles.count > 1 else { return }
            haptica.disparar(.rigida)
            fuentes.paso(delta)
            return
        }
        let ids = idsFuentesVisibles
        let activa = fuentes.activa ?? reproductor.canal?.id
        guard ids.count > 1, let destino = GestosTeatro.paso(ids, activa: activa, delta: delta) else { return }
        haptica.disparar(.rigida)
        elegirFuente(destino)
    }

    /// Elegir una fuente a mano (`selectSource`): la sesión de fuentes; en un canal suelto con la sesión aún
    /// vacía, la hermana suena como canal propio (nunca salta sola).
    func elegirFuente(_ hash: String) {
        if !fuentes.entradas.isEmpty {
            fuentes.elegir(hash)
            return
        }
        guard case .canal = navegador.capa, let item = OtrasFuentes.item(datos.biblioteca.datos, hash: hash) else { return }
        let titulo = item.title.isEmpty ? "Canal \(hash.prefix(8))" : item.title
        reproductor.reproducir(CanalReproducible(id: hash, titulo: titulo, ih: item.ih))
    }

    /// «Reintentar» y «Reproducir aquí» del panel del vídeo (`actions.retry`): vuelve a pedir lo que sonaba.
    func reintentar() {
        if reproductor.canal != nil {
            reproductor.reanudar()
        } else {
            reproductor.deshacerDetencion()
        }
    }

    // MARK: Acciones (player/index.tsx)

    func alternar() {
        haptica.disparar(.ligera)
        reproductor.alternar()
    }

    func detener() {
        haptica.disparar(.rigida)
        reproductor.detener()
    }

    /// «Ir al directo» (`goLive`, a4 §5.4): mide antes, salta solo si está a más de 1,25 s del borde útil y decide
    /// el aviso después de ver qué ha pasado. Sin conexión activa no hace nada (tampoco el reproductor).
    func irAlDirecto() {
        guard let hash = reproductor.canal?.id else { return }
        let reproductor = self.reproductor
        let avisos = self.avisos
        if demo {
            reproductor.reanudar()
            Self.avisar(ReglasSalto.demoDirecto, avisos: avisos)
            return
        }
        guard reproductor.conexion == .activa else { return }
        let antes: MedidaDirecto? = Self.medidaDirecto(reproductor)
        let sonaba: Bool = reproductor.fase == .reproduciendo
        if ReglasSalto.enBorde(antes) {
            if !sonaba { reproductor.reanudar() }
            Self.avisar(ReglasSalto.avisoEnBorde(sonaba: sonaba), avisos: avisos)
            return
        }
        guard let antes else { return }
        Task {
            await reproductor.irAlDirecto()
            guard reproductor.canal?.id == hash else { return }  // otra fuente entretanto: sin aviso
            let despues: MedidaDirecto? = Self.medidaDirecto(reproductor)
            Self.avisar(ReglasSalto.avisoTrasSaltar(antes: antes, despues: despues), avisos: avisos)
        }
    }

    /// −30 s (`back`, a4 §5.4): calcula antes lo que de verdad puede retroceder y solo avisa «Retrocedido n s» si
    /// el cabezal ha vuelto atrás.
    func retroceder() {
        guard let hash = reproductor.canal?.id else { return }
        let reproductor = self.reproductor
        let avisos = self.avisos
        if demo {
            Self.avisar(ReglasSalto.demoRetroceso, avisos: avisos)
            return
        }
        let ventana: VentanaDirecto? = reproductor.conexion == .activa ? reproductor.motor.ventana : nil
        let antes: Double = reproductor.motor.tiempoActual
        switch ReglasSalto.planRetroceso(ventana: ventana, actual: antes) {
        case .avisar(let aviso):
            Self.avisar(aviso, avisos: avisos)
        case .saltar(let real):
            Task {
                await reproductor.retroceder()
                guard reproductor.canal?.id == hash else { return }
                let despues: Double = reproductor.motor.tiempoActual
                guard ReglasSalto.retrocedio(antes: antes, despues: despues, real: real) else { return }
                Self.avisar(ReglasSalto.avisoRetrocedido(real), avisos: avisos)
            }
        }
    }

    private static func medidaDirecto(_ reproductor: Reproductor) -> MedidaDirecto? {
        let ventana: VentanaDirecto? = reproductor.motor.ventana
        return MedidaDirecto.medir(ventana: ventana, actual: reproductor.motor.tiempoActual, modo: reproductor.modo)
    }

    private static func avisar(_ aviso: AvisoSalto, avisos: Avisos) {
        avisos.avisar(aviso.texto, clase: .senal, tono: aviso.tono, icono: aviso.icono)
    }

    /// Silencio: un solo estado para las dos filas de controles (vertical e inmersivo), aplicado al AVPlayer de
    /// verdad (en la demo no hay).
    func alternarSilencio() {
        haptica.disparar(.ligera)
        SilencioVideo.compartido.alternar(reproductor.motor.avPlayer)
    }

    var silenciadoAhora: Bool { SilencioVideo.compartido.silenciado }

    /// ⛶ = inmersivo en horizontal con nuestros controles (decisión 3; a4 §23.2). Háptica media.
    func alternarPantallaCompleta() {
        haptica.disparar(.media)
        presentacion.alternarPantallaCompleta()
    }

    func alternarPiP() {
        if demo {
            avisos.avisar("PiP necesita un vídeo real (en demo no hay señal)", tono: .info)
            return
        }
        guard pip.posible || pip.activo else {
            avisos.avisar("PiP no disponible", tono: .warn)
            return
        }
        pip.alternar()
    }

    func alternarDatosTecnicos() {
        if presentacion.datosTecnicosAbiertos {
            presentacion.cerrarDatosTecnicos()
        } else {
            presentacion.abrirDatosTecnicos()
        }
    }

    /// ⌄ y deslizar hacia abajo: vuelve atrás y el vídeo pasa al mini (háptica ligera; a4 §5.2).
    func minimizar() {
        haptica.disparar(.ligera)
        if presentacion.pantallaCompletaForzada { presentacion.alternarPantallaCompleta() }
        navegador.atras()
    }

    func abrirDonde() { navegador.ir(.ajustes(.donde)) }

    /// ☆ del vídeo: guarda al momento (sin hoja) o lo quita (a4 §5.2).
    func alternarFavorito() {
        guard let canal = reproductor.canal else { return }
        let guardado = esFavorito
        let cambio: LibraryMutation =
            guardado
            ? .delete(collection: .favorites, id: canal.id)
            : .favoriteUpsert(ItemInput(id: canal.id, title: canal.titulo, ih: canal.ih == true))
        let datos = self.datos
        let avisos = self.avisos
        let haptica = self.haptica
        Task {
            do {
                try await datos.mutarBiblioteca(cambio)
                if !guardado { haptica.disparar(.exito) }
                let texto = guardado ? "«\(canal.titulo)» quitado de favoritos" : "«\(canal.titulo)» guardado en favoritos"
                avisos.avisar(texto, tono: guardado ? .warn : .ok, icono: guardado ? .star : .starF)
            } catch {
                avisos.avisar(guardado ? "No se pudo quitar el favorito" : "No se pudo guardar el favorito", tono: .err)
            }
        }
    }

    /// Canal anterior o siguiente de la lista de zapping (háptica rígida, aviso y teatro del canal; a4 §21).
    func zapping(_ paso: Int) {
        let lista = ListaZappingTeatro.de(datos.biblioteca.datos)
        guard let destino = ListaZappingTeatro.destino(lista, actual: reproductor.canal?.id, paso: paso) else { return }
        haptica.disparar(.rigida)
        avisos.avisar("Zapping: \(destino.title)", clase: .senal, icono: .tv)
        reproductor.reproducir(CanalReproducible(id: destino.id, titulo: destino.title, ih: destino.ih))
        navegador.ir(.canal(hash: destino.id))
    }

    var puedeZapear: Bool {
        let lista = ListaZappingTeatro.de(datos.biblioteca.datos)
        return lista.count > 1 || (lista.count == 1 && lista.first?.id != reproductor.canal?.id)
    }

    // MARK: Copiar y abrir fuera

    func copiar(_ texto: String, bien: String, mal: String, icono: NombreIcono = .copy) {
        Self.copiar(texto, bien: bien, mal: mal, icono: icono, avisos: avisos)
    }

    static func copiar(_ texto: String, bien: String, mal: String, icono: NombreIcono, avisos: Avisos) {
        UIPasteboard.general.string = texto
        let ok = UIPasteboard.general.string == texto
        avisos.avisar(ok ? bien : mal, tono: ok ? .ok : .err, icono: icono)
    }

    func abrirEnAceStream(_ hash: String) {
        guard let url = URL(string: "acestream://\(hash)") else { return }
        UIApplication.shared.open(url)
    }

    /// «Copiar URL del stream (VLC)»: `<origen>/ace/getstream?id=…` (o `infohash=`), player/clipboard.ts.
    func copiarURLStream(_ hash: String, infohash: Bool) {
        let servidores = self.servidores
        let avisos = self.avisos
        Task {
            let base: URL? = await servidores?.conocido()?.url
            let texto = Self.urlStream(base: base, hash: hash, infohash: infohash)
            Self.copiar(texto, bien: "URL del stream copiada: pégala en VLC", mal: "No se pudo copiar", icono: .copy, avisos: avisos)
        }
    }

    static func urlStream(base: URL?, hash: String, infohash: Bool) -> String {
        let parametro = infohash ? "infohash" : "id"
        var origen = ""
        if let base, let esquema = base.scheme, let host = base.host() {
            let puerto: String = base.port.map { ":\($0)" } ?? ""
            origen = "\(esquema)://\(host)\(puerto)"
        }
        return "\(origen)/ace/getstream?\(parametro)=\(hash)"
    }
}

/// El silencio del vídeo (la web lee `state.muted` del reproductor, PlayerSurface.tsx). `Reproductor` no tiene
/// silencio y el AVPlayer (uno solo, el del motor) no se puede observar: lo que pintan los botones sale de aquí,
/// compartido por todas las filas de controles montadas, y se aplica al AVPlayer.
@MainActor @Observable final class SilencioVideo {
    static let compartido = SilencioVideo()
    private(set) var silenciado = false

    func alternar(_ avPlayer: AVPlayer?) {
        silenciado.toggle()
        avPlayer?.isMuted = silenciado
    }
}

/// Lista de zapping (player/zapping.ts): favoritos y después el directorio activo agrupado por categorías en el
/// orden en que llegan, sin repetidos y sin los recientes. Si el actual no está, el siguiente es el primero.
/// (Cuando M5 publique `Zapping`, este se sustituye por él.)
enum ListaZappingTeatro {
    static func de(_ biblioteca: LibraryView?) -> [Item] {
        guard let biblioteca else { return [] }
        var orden: [String] = []
        var grupos: [String: [Item]] = [:]
        for item in biblioteca.web {
            let categoria = item.category.isEmpty ? "General" : item.category
            if grupos[categoria] == nil { orden.append(categoria) }
            grupos[categoria, default: []].append(item)
        }
        let plana = biblioteca.favorites + orden.flatMap { grupos[$0] ?? [] }
        var vistos = Set<String>()
        return plana.filter { vistos.insert($0.id).inserted }
    }

    static func destino(_ lista: [Item], actual: String?, paso: Int) -> Item? {
        guard !lista.isEmpty else { return nil }
        let total: Int = lista.count
        var siguiente: Int = 0
        if let actual, let indice = lista.firstIndex(where: { $0.id == actual }) {
            let bruto: Int = (indice + paso) % total
            siguiente = (bruto + total) % total
        }
        let item: Item = lista[siguiente]
        return item.id == actual ? nil : item
    }
}
