import Foundation

// Tipos de valor de la reproducción, puros [L] (b-arquitectura §1.5): movidos en la poda (fase 0.2) desde
// ServicioReproduccion.swift (CanalReproducible, ContextoPartido) y Reproductor.swift (OrigenReproduccion,
// MotivoParada, FalloFuente, IntentoReconexion) para compilarlos también en Linux. M3 (fase 1) les añade lo
// que la web lleva en `PlayChannel` (subtítulo, lead, proveedor) y los orígenes y reposos de la web.

/// Lo que se reproduce (`PlayChannel` de apps/web/src/player/api.ts): un canal (identificador opaco: hoy un
/// hash AceStream o un infohash) y, si viene de la agenda, el partido.
public struct CanalReproducible: Sendable, Hashable, Identifiable {
    /// Hash de 40 hex, infohash u otro identificador de fuente que entienda el servidor.
    public var id: String
    /// Nombre del canal: se enseña, va al historial y a la pantalla de bloqueo.
    public var titulo: String
    /// true: infohash; false: Content ID; nil: no se sabe (pegado a mano).
    public var ih: Bool?
    public var partido: ContextoPartido?
    public var listaId: String?
    /// De dónde salió (`CandidateSource` o «manual»). «manual» no entra en Recientes (B-187).
    public var origen: String?
    /// Segunda línea: «Fuente 1, Elcano» o «Fuente 2 de 3». NUNCA el marcador (regla 29).
    var subtitulo: String?
    /// Frase de la fuente para la línea de estado: «Fuente 1 verificada.».
    var lead: String?
    /// Proveedor corto (`source` del resultado que se manda al backend, ≤ 60).
    var fuente: String?

    public init(
        id: String, titulo: String, ih: Bool? = nil, partido: ContextoPartido? = nil, listaId: String? = nil,
        origen: String? = nil
    ) {
        self.id = id
        self.titulo = titulo
        self.ih = ih
        self.partido = partido
        self.listaId = listaId
        self.origen = origen
    }

    /// `kind` de la petición de stream (`kindFromIh`).
    public var tipo: StreamKind {
        switch ih {
        case .some(true): .infohash
        case .some(false): .id
        case .none: .auto
        }
    }

    /// Se apunta en Recientes (un hash pegado a mano no, B-187).
    var apuntar: Bool { origen != "manual" }
}

/// El partido al que pertenece la señal.
public struct ContextoPartido: Sendable, Hashable {
    public var id: String
    /// «Local – Visitante».
    public var titulo: String
    public var competicion: String
    /// Canal del partido con el que casó la fuente.
    public var canal: String

    public init(id: String, titulo: String, competicion: String, canal: String) {
        self.id = id
        self.titulo = titulo
        self.competicion = competicion
        self.canal = canal
    }
}

/// Quién pidió reproducir (`PlayOrigin`): la persona, el arranque automático, el zapping o la biblioteca.
public enum OrigenReproduccion: String, Sendable, Hashable {
    case usuario
    /// 1 reconexión antes de dar la fuente por fallida si aún no había arrancado.
    case automatico
    case zapping
    case biblioteca
}

/// Por qué no suena nada.
public enum MotivoParada: String, Sendable, Hashable {
    /// La persona lo paró (`detenido`).
    case usuario
    /// Otro dispositivo se quedó el mando (`traspasado`).
    case traspaso
    /// La fuente se dio por perdida o un fallo de sistema (`fallo`).
    case fallo
    /// El servidor ya no deja reproducir (dispositivo retirado; reposo `fallo`).
    case sinAcceso
    /// El motor AceStream no responde: se reanuda solo cuando vuelva (`sin-motor`).
    case sinMotor
}

/// Aviso de fuente perdida (reconexiones agotadas) para quien decide la siguiente (`SourceFailure`).
public struct FalloFuente: Sendable, Hashable {
    public var canal: CanalReproducible
    public var origen: OrigenReproduccion
    /// `fallo` si nunca dio imagen; `cayo` si llegó a verse.
    public var resultado: OutcomeResult
    public var segundos: Int
    public var motivo: String
}

/// Reconexión en curso: n de máx.
public struct IntentoReconexion: Sendable, Hashable {
    public var n: Int
    public var max: Int
}
