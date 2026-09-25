import Foundation
import Observation

/* Estado de interfaz de la agenda (M5; a3 §5, §6.6, §6.7, §11; agenda/state.ts): el día elegido, el filtro,
   la dirección de la entrada de la lista, el bloqueo de toques tras deslizar, la tarjeta de primer uso y la
   caché de «¿está este canal en tu biblioteca?». Vive con la pestaña (el armazón la mantiene viva: el día y
   el filtro sobreviven a cambiar de vista, como en la web). Lo que decide es puro (Core/Reglas/Agenda). */

/// Hacia dónde entra la lista al cambiar de día (a3 §6.6).
enum DireccionDia: Sendable { case siguiente, anterior }

/// Desde dónde se abrió un partido (héroe o tarjeta de la fila).
struct AperturaPartido: Equatable, Sendable {
    var id: String
    var desdeHeroe: Bool
}

/// Todo lo que la agenda pinta en un momento, calculado una vez por pintado.
struct FotoAgenda {
    var hoy: String
    var reloj: RelojMadrid
    var ahora: Date
    var fechas: [String]
    var dia: String?
    var delDia: [FootballMatch]
    var modo: ModoAgenda
    var hayGustos: Bool
    var gustos: GustosFutbol
    var visibles: [FootballMatch]
    var grupos: [GrupoLiga]
    var cuentas: [String: Int]
    var paraTi: Int
    var enDirecto: Int
    var destacado: FootballMatch?
    var marcadores: [String: LiveScore]

    /// El día siguiente al elegido (para «Ver el día siguiente»).
    var diaSiguiente: String? {
        guard let dia, let i = fechas.firstIndex(of: dia), i + 1 < fechas.count else { return nil }
        return fechas[i + 1]
    }

    func vecino(_ paso: Int) -> String? {
        guard let dia, let i = fechas.firstIndex(of: dia) else { return nil }
        let j = i + paso
        return fechas.indices.contains(j) ? fechas[j] : nil
    }

    static func calcular(
        agenda: FootballSchedule?, preferencias: Preferences?, marcadores: [String: LiveScore], ahora: Date,
        diaElegido: String?, modoQuerido: ModoAgenda?
    ) -> FotoAgenda {
        let reloj = RelojMadrid(ahora)
        let dias = agenda?.days ?? []
        let fechas = dias.map(\.date)
        let dia = ReglasAgenda.resolverDia(fechas, elegido: diaElegido, hoy: reloj.fecha)
        let delDia = dias.first { $0.date == dia }?.matches ?? []
        let gustos = GustosFutbol(preferencias)
        let hayGustos = ParaTi.tieneGustos(gustos)
        let modo = ReglasAgenda.modoEfectivo(modoQuerido, gustos: gustos)
        let visibles = ReglasAgenda.visibles(delDia, modo: modo, gustos: gustos)
        var cuentas: [String: Int] = [:]
        for d in dias { cuentas[d.date] = ReglasAgenda.visibles(d.matches, modo: modo, gustos: gustos).count }
        let paraTi = hayGustos ? ReglasAgenda.visibles(delDia, modo: .paraTi, gustos: gustos).count : 0
        return FotoAgenda(
            hoy: reloj.fecha, reloj: reloj, ahora: ahora, fechas: fechas, dia: dia, delDia: delDia, modo: modo,
            hayGustos: hayGustos, gustos: gustos, visibles: visibles,
            grupos: ReglasAgenda.porCompeticion(visibles, reloj: reloj, marcadores: marcadores), cuentas: cuentas,
            paraTi: paraTi, enDirecto: ReglasAgenda.enDirecto(visibles, reloj: reloj, marcadores: marcadores),
            destacado: ReglasAgenda.destacado(visibles, reloj: reloj, marcadores: marcadores, gustos: gustos),
            marcadores: marcadores)
    }
}

@MainActor @Observable final class ModeloAgenda {
    /// Día elegido (YYYY-MM-DD) o nil: el de por defecto (hoy).
    var diaElegido: String?
    /// nil: no se ha tocado el conmutador (`footballModeTouched`).
    var modoQuerido: ModoAgenda?
    /// Dirección de la última entrada de la lista.
    private(set) var direccion: DireccionDia?
    /// Tras cambiar de día se ignoran los toques 400 ms (a3 §6.7).
    private(set) var toquesBloqueados = false
    /// «Ahora no» / descartada en esta sesión (a3 §11).
    var primerUsoDescartado = false
    /// Guardando «Ahora no» o un «Seguir».
    var guardando = false
    /// Desplazamiento de la lista mientras arrastras (con resistencia).
    var arrastre: Double = 0
    /// Petición de subir a la tira de días (+1 al cambiar de día con la tira por encima del borde).
    private(set) var subirATira = 0
    /// `opening` de la web: el partido y desde dónde se abrió; no se borra (sirve para la vuelta, a3 §4.8).
    private(set) var apertura: AperturaPartido?
    /// Marca de la última escritura de las preferencias al abrir la hoja de gustos (`modeAfterSaving`).
    @ObservationIgnored var preferenciasAlAbrirGustos: Date?
    @ObservationIgnored private var tareaBloqueo: Task<Void, Never>?
    @ObservationIgnored private var claveBiblioteca: Date?
    @ObservationIgnored private var cacheCanales: [String: Bool] = [:]
    @ObservationIgnored private var busqueda = BusquedaBiblioteca.vacia

    /// Cambia de día; devuelve false si no cambia nada. `tiraArriba`: la tira quedaba por encima del borde.
    @discardableResult
    func cambiarDia(_ fecha: String, actual: String?, fechas: [String], tiraArriba: Bool) -> Bool {
        guard fecha != actual else { return false }
        let desde = actual.flatMap { fechas.firstIndex(of: $0) } ?? 0
        let hasta = fechas.firstIndex(of: fecha) ?? 0
        direccion = hasta > desde ? .siguiente : .anterior
        diaElegido = fecha
        if tiraArriba { subirATira &+= 1 }
        return true
    }

    /// Tras un deslizamiento que cambia de día: 400 ms sin abrir tarjetas (a3 §6.7).
    func bloquearToques() {
        toquesBloqueados = true
        tareaBloqueo?.cancel()
        tareaBloqueo = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))  // a3 §6.7
            guard !Task.isCancelled else { return }
            self?.toquesBloqueados = false
        }
    }

    /// `openMatch`: sin canales, el aviso; con canales, háptica ligera, marca el origen del vuelo y navega
    /// (un paso después, para que el bloque de escudos publique su marco antes de la transición).
    func abrir(_ partido: FootballMatch, desdeHeroe: Bool, navegador: Navegador, avisos: Avisos, haptica: Haptica) {
        guard !toquesBloqueados else { return }
        guard !partido.channels.isEmpty else {
            avisos.avisar("El canal todavía no está anunciado", tono: .info)
            return
        }
        haptica.disparar(.ligera)
        apertura = AperturaPartido(id: partido.id, desdeHeroe: desdeHeroe)
        let id = partido.id
        let origen: OrigenApertura = desdeHeroe ? .heroe(partido: id) : .tarjeta(partido: id)
        Task {
            await Task.yield()
            navegador.ir(.partido(id: id), desde: origen)
        }
    }

    /// Cambiar el filtro: la lista entra de nuevo sin dirección.
    func cambiarModo(_ modo: ModoAgenda) {
        direccion = nil
        modoQuerido = modo
    }

    /// `modeAfterSaving`: guardar los gustos cuenta como tocar el conmutador.
    func modoTrasGuardar(hayGustos: Bool) {
        modoQuerido = hayGustos ? .paraTi : .todos
    }

    /// ¿Está este canal en tu biblioteca? (`useLibraryLookup`: se recalcula solo si cambia la biblioteca).
    func enBiblioteca(_ nombre: String, biblioteca: LibraryView?, version: Date?) -> Bool {
        if version != claveBiblioteca {
            claveBiblioteca = version
            busqueda = BusquedaBiblioteca(biblioteca: biblioteca)
            cacheCanales = [:]
        }
        if let hecho = cacheCanales[nombre] { return hecho }
        let hay = busqueda.tiene(nombre)
        cacheCanales[nombre] = hay
        return hay
    }

    func canales(_ partido: FootballMatch, biblioteca: LibraryView?, version: Date?) -> [InfoCanal] {
        partido.channels.map(\.name).filter { !$0.isEmpty }.map {
            InfoCanal(nombre: $0, enBiblioteca: enBiblioteca($0, biblioteca: biblioteca, version: version))
        }
    }
}
