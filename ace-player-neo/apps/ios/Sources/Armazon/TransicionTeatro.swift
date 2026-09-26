import Observation
import SwiftUI
import UIKit

/* Transición tarjeta → teatro (b-arquitectura §2.4.5 y §3.5, I0→M4; decisión 3 de Isma; a1 §7.5, a2 §2.4 y §11).
   Las piezas publican su marco (coordenadas de la ventana) con `.piezaVuelo`; `CapaPartido`, `CapaPestanas` y
   `CapaVuelo` solo leen lo que este objeto deja preparado:

   - Ida: el teatro se monta invisible un fotograma (publica su fila de equipos), la capa escala uniformemente
     desde la tarjeta (radio 14 → 0; héroe 24; mini 18) con el muelle estándar, el contenido de la tarjeta se funde
     (`1 − min(1, 2p)`) y los escudos vuelan de la tarjeta a la fila de equipos; la pestaña de debajo se funde en
     340 ms. Sin origen (enlace, Buscar, galería) entra como una vista «adelante» de la web: fundido y +16.
   - Vuelta (la de la web): el teatro se funde, la pestaña entra desde −16 y los escudos vuelven a la tarjeta si
     sigue en pantalla. Si algo suena, en vez de fundirse el vídeo se encoge y vuela al mini mientras la página se
     funde (`alMini`), y el mini aparece justo donde aterriza.
   - Arrastrar el vídeo hacia abajo (Isma, 26-sep: como YouTube): lo mismo pero con el dedo (`arrastrarAlMini`);
     al soltar pasado el umbral termina de volar con el muelle y, si no, vuelve a su sitio.
   - Borde izquierdo: la capa sigue al dedo 1:1 y la pestaña de debajo entra de −16 a 0 (`arrastrarBorde`).
   - Movimiento reducido: fundidos de 120 ms, sin zoom ni vuelos.

   Los plazos se esperan con `Task.sleep` y cada paso lleva un turno: si llega otro cambio a mitad, el viejo no
   toca nada al acabar. */

enum PiezaVuelo: Hashable, Sendable { case tarjeta, escudos, filaEquipos, escenario }

struct ClaveMarco: Hashable, Sendable {
    var pieza: PiezaVuelo
    var partido: String
}

/// Lo que viaja: una foto de la pantalla (los escudos). El vídeo no viaja por aquí: se escala el propio escenario
/// (`alMini`, `EscenarioAlMini`), así que la `AVPlayerLayer` no cambia de hueco a mitad de vuelo.
enum ContenidoVuelo {
    case foto(UIView)
}

/// Una pieza que viaja por encima de todo entre dos marcos de la ventana.
struct VueloPieza: Identifiable {
    let id: Int
    let contenido: ContenidoVuelo
    let desde: CGRect
    let hasta: CGRect
    /// En la ida la foto se queda entera hasta la mitad y luego deja paso a la pieza de verdad.
    let fundirAlFinal: Bool
}

@MainActor @Observable final class TransicionTeatro {
    @ObservationIgnored private(set) var marcos: [ClaveMarco: CGRect] = [:]  // coordenadas de la ventana
    private(set) var progreso: Double = 1  // 0 = en el origen, 1 = teatro colocado
    private(set) var ida = true
    private(set) var activa = false

    /// Lo que pinta la capa del teatro (va un paso por detrás de `Navegador.capa`: sigue viéndose mientras sale).
    private(set) var mostrado: Destino?
    /// Marco y radio del origen del zoom (nil: entra como una vista de la web, sin zoom).
    private(set) var origen: CGRect?
    private(set) var radioOrigen: Double = 14
    /// Foto del contenido de la tarjeta que se funde sobre la capa que crece.
    private(set) var fotoOrigen: UIView?
    private(set) var opacidadFoto: Double = 1
    private(set) var opacidadTeatro: Double = 1
    private(set) var entradaTeatro: Double = 0
    /// El borde izquierdo: desplazamiento de la capa (1:1 con el dedo).
    private(set) var arrastreBorde: Double = 0
    /// La pestaña de debajo (a2 §2.4 y §11).
    private(set) var opacidadDebajo: Double = 1
    private(set) var entradaDebajo: Double = 0
    private(set) var vuelos: [VueloPieza] = []
    /// Piezas que no se pintan mientras vuela su foto.
    private(set) var ocultas: Set<ClaveMarco> = []
    /// El vídeo camino del mini: 0 = en el teatro, 1 = en el sitio del vídeo del mini (`EscenarioAlMini`).
    private(set) var alMini: Double = 0
    /// El mini aparece sin su entrada (`player-sube`): el vídeo acaba de aterrizar en su sitio.
    private(set) var miniSinEntrada = false

    /// La ventana (la pone `CapaPartido`): el marco del mini y el ancho para el borde.
    @ObservationIgnored var maquetacion: Maquetacion = .referencia
    /// Marco del escenario al empezar a ir al mini (coordenadas de la ventana; mientras vuela no se vuelve a medir).
    @ObservationIgnored private(set) var desdeAlMini: CGRect?
    @ObservationIgnored private var turno = 0
    @ObservationIgnored private var siguienteVuelo = 0
    @ObservationIgnored private var saliendoPorBorde = false
    @ObservationIgnored private var saliendoAlMini = false

    func publicar(_ marco: CGRect, para clave: ClaveMarco) { marcos[clave] = marco }

    func olvidar(_ clave: ClaveMarco) { marcos[clave] = nil }

    /// Ida (§3.5): zoom de la capa desde el origen + vuelo de escudos, muelle estándar.
    func abrir(_ destino: Destino, desde origen: OrigenApertura, reducido: Bool) async {
        let mio = empezar(ida: true)
        mostrado = destino
        arrastreBorde = 0
        opacidadTeatro = 0  // montado e invisible: publica su fila de equipos
        entradaTeatro = 0
        try? await Task.sleep(for: .milliseconds(17))
        guard mio == turno else { return }
        if reducido {
            await fundirEntrada(mio, duracion: 0.12)
            return
        }
        guard let marco = marcoOrigen(origen) else {
            await entrarComoVista(mio)
            return
        }
        prepararZoom(marco, origen: origen, destino: destino)
        try? await Task.sleep(for: .milliseconds(17))  // el primer fotograma, en el origen
        guard mio == turno else { return }
        withAnimation(Movimiento.estandar(false)) { progreso = 1 }
        withAnimation(Movimiento.vista(false)) { opacidadDebajo = 0 }
        // `1 − min(1, 2p)`: el muelle estándar pasa de p = 0,5 hacia los 100 ms (a1 §7.1, muestra 6 de 32 cada
        // 16,8 ms): la foto de la tarjeta se va en ese tramo.
        withAnimation(.linear(duration: 0.1)) { opacidadFoto = 0 }
        try? await Task.sleep(for: .milliseconds(TransicionTeatro.muelleMs))
        terminar(mio)
    }

    /// Vuelta de la web: el teatro se funde, la pestaña entra desde −16, los escudos vuelven y, si sigue sonando,
    /// el vídeo se encoge y vuela al mini (la página se funde a su alrededor).
    func cerrar(haciaMini: Bool, reducido: Bool) async {
        let porBorde = saliendoPorBorde
        let porDedo = saliendoAlMini
        let mio = empezar(ida: false)
        if porBorde || porDedo {  // la capa ya ha salido con el dedo: solo queda esperar al muelle
            try? await Task.sleep(for: .milliseconds(TransicionTeatro.muelleMs))
            guard mio == turno else { return }
            quitarCapa(mio, miniSinEntrada: porDedo)
            return
        }
        let duracion: Double = reducido ? 0.12 : 0.34
        let volar: Bool = haciaMini && !reducido && prepararAlMini()
        if !reducido { prepararVuelta() }
        opacidadDebajo = 0
        entradaDebajo = GeometriaVuelo.entradaVista(.atras, reducido: reducido)  // a2 §11: la pestaña entra desde −16
        try? await Task.sleep(for: .milliseconds(17))
        guard mio == turno else { return }
        withAnimation(.easeOut(duration: duracion)) {  // a2 §11: fundido de vista 340 ms (reducido 120)
            if !volar { opacidadTeatro = 0 }
            opacidadDebajo = 1
            entradaDebajo = 0
        }
        if volar || !vuelos.isEmpty {
            withAnimation(Movimiento.estandar(false)) {
                progreso = 1
                if volar { alMini = 1 }
            }
        }
        let espera: Int = vuelos.isEmpty && !volar ? Int(duracion * 1000) : TransicionTeatro.muelleMs
        try? await Task.sleep(for: .milliseconds(espera))
        guard mio == turno else { return }
        quitarCapa(mio, miniSinEntrada: volar)
    }

    /// El teatro sin transición (arranque con `-AceNeoVista`, o de un partido a otro).
    func mostrarYa(_ destino: Destino) {
        turno += 1
        mostrado = destino
        limpiar()
        opacidadDebajo = 0
    }

    // MARK: Borde izquierdo (a2 §2.4)

    /// Durante el arrastre: la capa a `dx` (nunca a la izquierda de 0) y la pestaña de debajo de −16 a 0.
    func arrastrarBorde(_ dx: Double) {
        turno += 1
        let x = GeometriaVuelo.arrastreBorde(dx)
        arrastreBorde = x
        opacidadDebajo = 1
        entradaDebajo = GeometriaVuelo.entradaPestanaConBorde(dx: x, ancho: maquetacion.ancho)
    }

    /// Al soltar: true si vuelve (la capa termina de salir y quien llama hace `navegador.atras()`).
    func soltarBorde(dx: Double, vx: Double, reducido: Bool) -> Bool {
        let ancho = maquetacion.ancho
        let vuelve = GeometriaVuelo.vuelveConElBorde(dx: dx, vx: vx, ancho: ancho)
        let velocidad: Double = ancho > 0 ? vx / ancho : 0
        if vuelve {
            saliendoPorBorde = true
            let curva: Animation = reducido ? .easeOut(duration: 0.12) : Movimiento.estandar(false)
            withAnimation(curva) {
                arrastreBorde = ancho
                entradaDebajo = 0
                if reducido { opacidadTeatro = 0 }
            }
        } else {
            let mio = empezar(ida: true)
            let curva: Animation = reducido ? .easeOut(duration: 0.12) : Movimiento.soltar(velocidad: velocidad)
            withAnimation(curva) {
                arrastreBorde = 0
                entradaDebajo = GeometriaVuelo.entradaPestanaConBorde(dx: 0, ancho: ancho)
            }
            Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(TransicionTeatro.muelleMs))
                guard let self, mio == self.turno else { return }
                self.opacidadDebajo = 0
                self.activa = false
            }
        }
        return vuelve
    }

    // MARK: Arrastrar el vídeo al mini (decisión 3; Isma 26-sep)

    /// Mientras se arrastra el vídeo hacia abajo: el vídeo baja con el dedo y se encoge hacia el mini, la página se
    /// funde y deja ver la pestaña de debajo. `escenario`: el marco del vídeo en la ventana al empezar. false si no
    /// hace nada porque hay otra transición en marcha (y entonces tampoco vibra).
    @discardableResult func arrastrarAlMini(_ dy: Double, escenario: CGRect) -> Bool {
        guard !activa else { return false }
        if alMini == 0 || desdeAlMini == nil { desdeAlMini = escenario }
        guard let desde = desdeAlMini else { return false }
        let hasta: Marco = maquetacion.marcoVideoMini()
        alMini = GeometriaVuelo.progresoAlMini(dy: dy, desde: TransicionTeatro.marco(desde), hasta: hasta)
        opacidadDebajo = 1
        entradaDebajo = 0
        return true
    }

    /// Al soltar pasado el umbral: termina de volar al mini con el muelle y quien llama minimiza
    /// (`navegador.atras()`); `cerrar` solo espera a que aterrice. Con movimiento reducido, la vuelta de siempre.
    /// Salida de emergencia: si nadie cierra en `rescateMs` (minimizar no navegó: nada sonando, u otra navegación
    /// ganó la carrera), el vídeo vuelve a su sitio en vez de quedarse encogido.
    func soltarAlMini(reducido: Bool) {
        guard !reducido, desdeAlMini != nil else {
            withAnimation(.easeOut(duration: 0.12)) { alMini = 0 }
            return
        }
        saliendoAlMini = true
        withAnimation(Movimiento.estandar(false)) { alMini = 1 }
        let mio = turno
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(TransicionTeatro.rescateMs))
            guard let self, mio == self.turno, self.saliendoAlMini else { return }
            self.saliendoAlMini = false
            self.devolverAlTeatro(reducido: false)
        }
    }

    /// Lo que espera `soltarAlMini` a que llegue `cerrar` antes de devolver el vídeo a su sitio.
    static let rescateMs = 650

    /// Al soltar sin llegar al umbral: el vídeo vuelve a su sitio con el muelle.
    func devolverAlTeatro(reducido: Bool) {
        let mio = turno
        withAnimation(reducido ? .easeOut(duration: 0.12) : Movimiento.estandar(false)) { alMini = 0 }
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(TransicionTeatro.muelleMs))
            guard let self, mio == self.turno, self.alMini == 0, !self.activa else { return }
            self.opacidadDebajo = 0
            self.desdeAlMini = nil
        }
    }

    /// Escala y desplazamiento del escenario camino del mini (los lee `EscenarioAlMini`).
    var transformacionAlMini: TransformacionVuelo {
        guard alMini != 0, let desde = desdeAlMini else { return .identidad }
        let hasta: Marco = maquetacion.marcoVideoMini()
        return GeometriaVuelo.alMini(desde: TransicionTeatro.marco(desde), hasta: hasta, progreso: alMini)
    }

    /// La vuelta de ⌄ o de «atrás» con algo sonando: el marco del escenario de lo que se ve (partido o canal).
    private func prepararAlMini() -> Bool {
        var clave: String?
        switch mostrado {
        case .partido(let id): clave = id
        case .canal(let hash): clave = hash
        default: clave = nil
        }
        guard let clave, let marco = marcos[ClaveMarco(pieza: .escenario, partido: clave)], marco.width > 1 else {
            return false
        }
        desdeAlMini = marco
        return true
    }

    static func marco(_ r: CGRect) -> Marco {
        Marco(x: Double(r.minX), y: Double(r.minY), ancho: Double(r.width), alto: Double(r.height))
    }

    // MARK: Pasos

    /// Asentamiento del muelle estándar (a1 §7.1: 520 ms).
    static let muelleMs = 520

    private func empezar(ida: Bool) -> Int {
        turno += 1
        self.ida = ida
        activa = true
        miniSinEntrada = false
        return turno
    }

    private func marcoOrigen(_ origen: OrigenApertura) -> CGRect? {
        switch origen {
        case .tarjeta(let id), .heroe(let id): marcos[ClaveMarco(pieza: .tarjeta, partido: id)]
        case .mini: TransicionTeatro.cg(maquetacion.marcoMini())
        case .ninguno: nil
        }
    }

    private func prepararZoom(_ marco: CGRect, origen: OrigenApertura, destino: Destino) {
        var esHeroe = false
        var esMini = false
        switch origen {
        case .heroe: esHeroe = true
        case .mini: esMini = true
        default: break
        }
        self.origen = marco
        radioOrigen = GeometriaVuelo.radioOrigen(heroe: esHeroe, mini: esMini)
        fotoOrigen = Instantanea.tomar(marco)
        opacidadFoto = 1
        if case .partido(let id) = destino { prepararEscudosIda(id) }
        progreso = 0
        opacidadTeatro = 1
    }

    /// Los escudos de la tarjeta vuelan a la fila de equipos del teatro (la de verdad se ve al llegar).
    private func prepararEscudosIda(_ id: String) {
        let clave = ClaveMarco(pieza: .escudos, partido: id)
        guard let desde = marcos[clave], let hasta = marcos[ClaveMarco(pieza: .filaEquipos, partido: id)],
            let foto = Instantanea.tomar(desde)
        else { return }
        vuelos = [nuevoVuelo(.foto(foto), desde: desde, hasta: hasta, fundir: true)]
        ocultas = [clave]
    }

    /// Vuelta: la fila de equipos vuelve a los escudos de la tarjeta (si sigue en pantalla).
    private func prepararVuelta() {
        guard case .partido(let id) = mostrado else { return }
        let destino = ClaveMarco(pieza: .escudos, partido: id)
        guard let desde = marcos[ClaveMarco(pieza: .filaEquipos, partido: id)], let hasta = marcos[destino],
            let foto = Instantanea.tomar(desde)
        else { return }
        vuelos = [nuevoVuelo(.foto(foto), desde: desde, hasta: hasta, fundir: false)]
        ocultas = [destino]
        progreso = 0
    }

    private func nuevoVuelo(_ contenido: ContenidoVuelo, desde: CGRect, hasta: CGRect, fundir: Bool) -> VueloPieza {
        siguienteVuelo += 1
        return VueloPieza(id: siguienteVuelo, contenido: contenido, desde: desde, hasta: hasta, fundirAlFinal: fundir)
    }

    /// Sin origen: la entrada «adelante» de la web (fundido y +16, 340 ms), con la pestaña fundiéndose.
    private func entrarComoVista(_ mio: Int) async {
        entradaTeatro = 16
        try? await Task.sleep(for: .milliseconds(17))
        guard mio == turno else { return }
        withAnimation(Movimiento.vista(false)) {
            opacidadTeatro = 1
            entradaTeatro = 0
            opacidadDebajo = 0
        }
        try? await Task.sleep(for: .milliseconds(340))
        terminar(mio)
    }

    private func fundirEntrada(_ mio: Int, duracion: Double) async {
        withAnimation(.easeOut(duration: duracion)) {
            opacidadTeatro = 1
            opacidadDebajo = 0
        }
        try? await Task.sleep(for: .milliseconds(Int(duracion * 1000)))
        terminar(mio)
    }

    private func terminar(_ mio: Int) {
        guard mio == turno else { return }
        limpiar()
        activa = false
    }

    private func quitarCapa(_ mio: Int, miniSinEntrada sinEntrada: Bool = false) {
        guard mio == turno else { return }
        mostrado = nil
        limpiar()
        opacidadDebajo = 1
        entradaDebajo = 0
        miniSinEntrada = sinEntrada
        activa = false
        guard sinEntrada else { return }
        Task { [weak self] in  // solo para esta aparición: «Deshacer» u otra vuelta traen la entrada de siempre
            try? await Task.sleep(for: .milliseconds(100))
            guard let self, mio == self.turno else { return }
            self.miniSinEntrada = false
        }
    }

    private func limpiar() {
        progreso = 1
        origen = nil
        fotoOrigen = nil
        opacidadFoto = 1
        vuelos = []
        ocultas = []
        opacidadTeatro = 1
        entradaTeatro = 0
        arrastreBorde = 0
        saliendoPorBorde = false
        alMini = 0
        desdeAlMini = nil
        saliendoAlMini = false
    }

    static func cg(_ m: Marco) -> CGRect { CGRect(x: m.x, y: m.y, width: m.ancho, height: m.alto) }
}
