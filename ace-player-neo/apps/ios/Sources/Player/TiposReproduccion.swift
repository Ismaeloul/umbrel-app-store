import Foundation

// Tipos de valor de la reproducción, puros [L] (b-arquitectura §1.5): movidos SIN CAMBIOS en la poda
// (fase 0.2) desde ServicioReproduccion.swift (CanalReproducible, ContextoPartido) y Reproductor.swift
// (OrigenReproduccion, MotivoParada, FalloFuente, IntentoReconexion) para compilarlos también en Linux.

/// Lo que se reproduce: un canal (hash AceStream o infohash) y, si viene de
/// la agenda, el partido.
public struct CanalReproducible: Sendable, Hashable, Identifiable {
    /// Hash de 40 hex o infohash.
    public var id: String
    public var titulo: String
    /// true: infohash; false: Content ID; nil: no se sabe (pegado a mano).
    public var ih: Bool?
    public var partido: ContextoPartido?
    public var listaId: String?
    /// De dónde salió (`CandidateSource` o «manual»), para el resultado de la fuente.
    public var origen: String?

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

    /// `kind` de la petición de stream.
    public var tipo: StreamKind {
        switch ih {
        case .some(true): .infohash
        case .some(false): .id
        case .none: .auto
        }
    }
}

/// El partido al que pertenece la señal (para Now Playing y el mini-reproductor).
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

/// Quién pidió reproducir: la persona o el arranque automático por fuentes verificadas.
public enum OrigenReproduccion: String, Sendable, Hashable {
    case usuario
    case automatico
}

/// Por qué no suena nada.
public enum MotivoParada: String, Sendable, Hashable {
    /// La persona lo paró.
    case usuario
    /// Otro dispositivo se quedó el mando.
    case traspaso
    /// La fuente se dio por perdida.
    case fallo
    /// El servidor ya no deja reproducir (dispositivo retirado).
    case sinAcceso
}

/// Aviso de fuente perdida (reconexiones agotadas) para quien decide la siguiente.
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
