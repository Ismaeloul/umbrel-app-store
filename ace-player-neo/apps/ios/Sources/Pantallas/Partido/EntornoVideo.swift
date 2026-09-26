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
    var foto: FotoEscenario {
        // Campo a campo: el init con trece argumentos pasaba de los 200 ms de tipar (CI 36220129061).
        let canal: CanalReproducible? = reproductor.canal
        var foto: FotoEscenario = FotoEscenario()
        foto.titulo = canal?.titulo
        foto.hash = canal?.id
        foto.fase = reproductor.fase
        foto.conexion = reproductor.conexion
        foto.mensaje = reproductor.mensaje
        foto.intento = reproductor.intento
        foto.directo = reproductor.directo
        foto.arranco = reproductor.arranco
        foto.motivoParada = reproductor.motivoParada
        foto.quiereReproducir = reproductor.quiereReproducir
        foto.demo = demo
        foto.espera = fuentes.textoEspera
        // «Fuente n verificada.» · «Fuente n, señal floja.» · «Fuente n.»: la pone la sesión al reproducir
        // (`leadFor` → `channel.lead`, lo que lee statusFor en la web).
        foto.lead = canal?.lead
        return foto
    }

    /// Subtítulo de lo que suena (a4 §20.9; `channel.subtitle` de la web): lo pone la sesión de fuentes al
    /// reproducir («Fuente {n}, {proveedor corto}» o «Fuente {n} de {total}»). Nunca el marcador.
    var subtitulo: String? { reproductor.canal?.subtitulo }

    /// Lo que hay en pantalla para la regla «la que se ve manda» (`onScreenOf`, model.ts; M3).
    var enPantalla: EnPantalla { reproductor.enPantalla }

    var esFavorito: Bool {
        guard let hash = reproductor.canal?.id else { return false }
        return datos.biblioteca.datos?.favorites.contains { $0.id == hash } ?? false
    }

    // MARK: Fuentes

    /// Las que se ven, en orden: las de la sesión de fuentes (en un canal suelto, sus hermanas de la biblioteca:
    /// «Otras fuentes», §0.0 punto 1, que la sesión ya tiene al entrar).
    var idsFuentesVisibles: [String] { fuentes.visibles.map(\.id) }

    /// ‹ › de «Emitiendo» y deslizar el vídeo a los lados: la siguiente o anterior en bucle (háptica rígida;
    /// `stepSource` de la sesión, M3).
    func pasoFuente(_ delta: Int) {
        guard fuentes.visibles.count > 1 else { return }
        haptica.disparar(.rigida)
        fuentes.paso(delta)
    }

    /// Elegir una fuente a mano (`selectSource` de la sesión): desde aquí nunca salta sola.
    func elegirFuente(_ hash: String) { fuentes.elegir(hash) }

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

    /// «Ir al directo» (`goLive`, a4 §5.4): el reproductor (M3) mide, salta y avisa con los textos de runtime.ts.
    func irAlDirecto() {
        let reproductor = self.reproductor
        Task { await reproductor.irAlDirecto() }
    }

    /// −30 s (`back`, a4 §5.4): también mide y avisa el reproductor (M3), una sola vez.
    func retroceder() {
        let reproductor = self.reproductor
        Task { await reproductor.retroceder() }
    }

    /// Silencio: el estado es del reproductor (M3, como `state.muted` de la web en PlayerSurface.tsx), así que las
    /// dos filas de controles (vertical e inmersivo) pintan lo mismo; el motor lo aplica al AVPlayer.
    func alternarSilencio() {
        haptica.disparar(.ligera)
        reproductor.silenciar(!reproductor.silenciado)
    }

    var silenciadoAhora: Bool { reproductor.silenciado }

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

    /// Canal anterior o siguiente de la lista de zapping (a4 §21; `zap` de player/index.tsx): el reproductor (M3)
    /// recorre `zappingList` (M5) con su háptica rígida y su aviso, y lleva al teatro del canal.
    func zapping(_ paso: Int) { reproductor.cambiarCanal(paso) }

    var puedeZapear: Bool { reproductor.puedeZapear }

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
