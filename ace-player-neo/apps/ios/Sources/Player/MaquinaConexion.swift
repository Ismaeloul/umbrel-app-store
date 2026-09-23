import Foundation

/* Máquina de estados explícita de UNA reproducción: la de la web
   (apps/web/src/player/machine.ts) portada tal cual.

   Hay dos capas y no se pisan:
   1. La CONEXIÓN (esta tabla): pedir la URL al backend, enganchar AVPlayer,
      esperar el primer fotograma, reconectar o fallar.
   2. El MEDIO (`FaseMedio`): una vez hay imagen, qué está haciendo AVPlayer
      y qué quiere quien mira (reproducir o pausa).

   `FaseReproductor.derivar` junta las dos en la fase que pinta la interfaz:

     idle → cargando → reproduciendo ⇄ pausado / buffer / buscando
                          ↓ fallo
                     reconectando → cargando … o → error

   Una transición que no está en la tabla se ignora: así una respuesta tardía
   de una conexión vieja nunca devuelve la máquina a un estado anterior. */

/// Estado de la conexión de una reproducción.
public enum FaseConexion: String, Sendable, Hashable, CaseIterable {
    /// Nada: sin canal, detenido o traspasado a otro dispositivo.
    case idle
    /// Pidiendo la URL a /native/api/v1/channels/:id/stream (el backend abre la sesión).
    case pidiendo
    /// URL concedida; AVPlayer se engancha y espera la primera información.
    case conectando
    /// Señal encontrada: llenando el colchón inicial (en iOS lo hace AVPlayer).
    case precarga
    /// Listo para reproducir; esperando el PRIMER FOTOGRAMA real.
    case arrancando
    /// Ya hubo imagen: manda el medio.
    case activa
    /// Esperando (con espera exponencial) para volver a conectar.
    case reconectando
    /// Reconexiones agotadas o un fallo que no se arregla reintentando.
    case error
}

/// Lo que le puede pasar a la conexión.
public enum EventoConexion: String, Sendable, Hashable, CaseIterable {
    case solicitar
    case concedida
    case motorListo
    case colchonListo
    case primerFotograma
    /// Cambio de URL sin cortar (el motor se reinició, el remux se rehízo…).
    case reenganche
    case fallo
    case reintentar
    case agotado
    case detener
    case traspaso
}

public enum MaquinaConexion {
    private static let siempre: [EventoConexion: FaseConexion] = [
        .solicitar: .pidiendo, .detener: .idle, .traspaso: .idle,
    ]

    private static let intentando: [EventoConexion: FaseConexion] = siempre.merging([
        .fallo: .reconectando, .agotado: .error, .reenganche: .conectando,
    ]) { _, nuevo in nuevo }

    /// La tabla completa (la misma que `TRANSITIONS` de la web).
    public static let transiciones: [FaseConexion: [EventoConexion: FaseConexion]] = [
        .idle: [.solicitar: .pidiendo, .detener: .idle],
        // Sin URL concedida aún no hay nada que reenganchar.
        .pidiendo: siempre.merging([.concedida: .conectando, .fallo: .reconectando, .agotado: .error]) { _, n in n },
        // HLS nativo no tiene colchón propio que esperar: el remux ya lo esperó.
        .conectando: intentando.merging([.motorListo: .precarga, .colchonListo: .arrancando]) { _, n in n },
        .precarga: intentando.merging([.colchonListo: .arrancando]) { _, n in n },
        .arrancando: intentando.merging([.primerFotograma: .activa]) { _, n in n },
        .activa: intentando,
        .reconectando: siempre.merging([.reintentar: .pidiendo, .agotado: .error]) { _, n in n },
        .error: siempre,
    ]

    /// Estado siguiente, o `nil` si la transición no existe (y se ignora).
    public static func siguiente(_ fase: FaseConexion, _ evento: EventoConexion) -> FaseConexion? {
        transiciones[fase]?[evento]
    }
}

/// Qué hace el medio (AVPlayer) una vez hay conexión.
public enum FaseMedio: String, Sendable, Hashable {
    case idle
    case arrancando
    case reproduciendo
    case pausado
    case buffer
    case buscando
}

/// Fase pública de la reproducción: la que pinta la interfaz.
public enum FaseReproductor: String, Sendable, Hashable {
    case idle
    case cargando
    case buffer
    case reproduciendo
    case pausado
    case buscando
    case reconectando
    case error

    public static func derivar(_ conexion: FaseConexion, _ medio: FaseMedio) -> FaseReproductor {
        switch conexion {
        case .idle: return .idle
        case .pidiendo, .conectando, .precarga, .arrancando: return .cargando
        case .reconectando: return .reconectando
        case .error: return .error
        case .activa:
            switch medio {
            case .idle: return .idle
            case .arrancando: return .cargando
            case .reproduciendo: return .reproduciendo
            case .pausado: return .pausado
            case .buffer: return .buffer
            case .buscando: return .buscando
            }
        }
    }

    /// Texto corto para VoiceOver y la línea de estado.
    public var etiqueta: String {
        switch self {
        case .idle: "Detenido"
        case .cargando: "Conectando"
        case .buffer: "Cargando"
        case .reproduciendo: "Reproduciendo"
        case .pausado: "En pausa"
        case .buscando: "Saltando"
        case .reconectando: "Reconectando"
        case .error: "Sin señal"
        }
    }
}

extension FaseConexion {
    /// Hay algo sonando o intentando sonar.
    public var enMarcha: Bool { self != .idle && self != .error }
}
