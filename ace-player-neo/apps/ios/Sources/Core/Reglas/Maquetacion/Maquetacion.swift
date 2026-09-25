import Foundation

/* Maquetación del armazón (b-arquitectura §2.1.2, contrato I0→M4). Todas las fórmulas de a2 §2.3, §3.2,
   §7, §8.2, §15, §16 y a4 §19.1 en un tipo puro, probado con seis tamaños (MaquetacionTests). En pt, con
   la ventana entera y sus zonas seguras. Cambiar una firma es un cambio de contrato (§5.1). */

struct Margenes: Hashable, Sendable {
    var arriba = 0.0, izquierda = 0.0, abajo = 0.0, derecha = 0.0
}

struct Marco: Hashable, Sendable {
    var x: Double, y: Double, ancho: Double, alto: Double
}

enum TipoPantalla: Sendable { case movil, tableta }  // ancho < 768 · ≥ 768 (a2 §2.3)

/// Todas las fórmulas del armazón (a2 §2.3, §8, §15, §16, §27.1). Puro; se prueba con seis tamaños.
struct Maquetacion: Hashable, Sendable {
    var ancho: Double  // la ventana entera, en pt
    var alto: Double
    var seguras: Margenes

    static let referencia = Maquetacion(ancho: 390, alto: 844, seguras: Margenes(arriba: 47, abajo: 34))

    var tipo: TipoPantalla { ancho >= 768 ? .tableta : .movil }  // lib/media.ts
    var horizontal: Bool { ancho > alto }
    var bajo: Bool { alto <= 540 }  // lib/media.ts
    var telefonoHorizontal: Bool { horizontal && bajo }  // `phoneLandscape`
    var estrecho380: Bool { ancho <= 380 }
    var altoHeroe: Double { min(500, max(360, 0.6 * alto)) }  // a3 §4.7: clamp(360, 60svh, 500) con el alto de la ventana entera

    /// `immersive = pantalla completa pedida || (teatro && phoneLandscape)` (a2 §2.3).
    func inmersivo(teatroVisible: Bool, forzado: Bool) -> Bool { forzado || (teatroVisible && telefonoHorizontal) }
    func barraInferior(teatroVisible: Bool, inmersivo: Bool, emparejando: Bool) -> Bool {
        tipo == .movil && !teatroVisible && !inmersivo && !emparejando
    }
    func barraSuperior(inmersivo: Bool, emparejando: Bool) -> Bool { tipo == .tableta && !inmersivo && !emparejando }

    /// a2 §3.2 y §4.1: 12 de cada lado (+ zonas), abajo safeB + 10, alto 64.
    var marcoBarraInferior: Marco {
        Marco(x: seguras.izquierda + 12, y: alto - seguras.abajo - 10 - 64,
              ancho: ancho - seguras.izquierda - seguras.derecha - 24, alto: 64)
    }
    var celdaBarra: Double { (marcoBarraInferior.ancho - 14) / 4 }  // a2 §4.1: (ancho − 2 de borde − 12 de relleno) / 4
    var altoBarraSuperior: Double { 64 + seguras.arriba }  // a2 §16.1

    /// Móvil: banda a 12 del borde y 82 + safeB del fondo, alto 74. Tableta: tarjeta abajo a la izquierda, ≤ 440.
    func marcoMini() -> Marco {
        let alto = Maquetacion.altoMini
        switch tipo {
        case .movil:  // a2 §7: abajo safeB + 10 + 64 + 8
            let ancho = self.ancho - seguras.izquierda - seguras.derecha - 24
            return Marco(x: seguras.izquierda + 12, y: self.alto - seguras.abajo - 82 - alto, ancho: ancho, alto: alto)
        case .tableta:  // a2 §16.3, a4 §19.1: izquierda safeL + 16, abajo safeB + 16, ancho min(440, ancho − 32)
            let ancho = min(440, self.ancho - 32)
            return Marco(x: seguras.izquierda + 16, y: self.alto - seguras.abajo - 16 - alto, ancho: ancho, alto: alto)
        }
    }

    /// Vídeo del mini: 10 dentro del marco, 96×54 (a4 §19.1: relleno 9 + borde 1).
    func marcoVideoMini() -> Marco {
        let mini = marcoMini()
        return Marco(x: mini.x + 10, y: mini.y + 10, ancho: 96, alto: 54)
    }

    /// Borde inferior de la pila de toasts: móvil safeB + 12 / + 94 (barra) / + 178 (barra y mini);
    /// tableta + 104 con mini si ancho ≤ 919, si no + 20.
    func bordeInferiorToasts(barra: Bool, mini: Bool) -> Double {
        switch tipo {
        case .movil:  // a2 §8.2 (toastBottom 0 / 82 / 166, + 12)
            guard barra else { return seguras.abajo + 12 }
            return seguras.abajo + (mini ? 178 : 94)
        case .tableta:  // a2 §16.3 (72 + 32 entre 768 y 919 con mini)
            return seguras.abajo + (mini && ancho <= 919 ? 104 : 20)
        }
    }

    /// Móvil: min(420, ancho − 24 − zonas), centrados (a2 §8.2, §16.6.1). Tableta: min(420, ancho − 40)
    /// a la derecha (a2 §16.3).
    var anchoToasts: Double {
        switch tipo {
        case .movil: min(420, ancho - seguras.izquierda - seguras.derecha - 24)
        case .tableta: min(420, ancho - 40)
        }
    }
    var toastsALaDerecha: Bool { tipo == .tableta }
    func altoVelo(mini: Bool) -> Double { seguras.abajo + (mini ? 180 : 100) }  // a2 §3.2, §5

    /// Teatro: safeB + 28; móvil: + 102 / + 182 (con mini); tableta: + 32 / + 120.
    func rellenoInferiorContenido(mini: Bool, teatro: Bool) -> Double {
        if teatro { return seguras.abajo + 28 }  // a2 §3.2
        switch tipo {
        case .movil: return seguras.abajo + (mini ? 182 : 102)  // a2 §3.2
        case .tableta: return seguras.abajo + (mini ? 120 : 32)  // a2 §16.2 (72 + 48)
        }
    }

    /// Móvil: safeT + 20; tableta: 64 + safeT + (agenda && bajo ? 12 : 24).
    func rellenoSuperiorCabecera(agenda: Bool) -> Double {
        switch tipo {
        case .movil: return seguras.arriba + 20  // a2 §3.2
        case .tableta: return 64 + seguras.arriba + (agenda && bajo ? 12 : 24)  // a2 §16.2
        }
    }

    /// Los lados suman sus zonas también en horizontal (§0.4: la web no suma safeL ≥ 768; aquí sí).
    var rellenoIzquierdo: Double { 16 + seguras.izquierda }
    var rellenoDerecho: Double { 16 + seguras.derecha }

    /// Alto del mini: 9 + 54 + 9 de relleno y 2 de borde (a2 §3.1, a4 §19.1).
    private static let altoMini = 74.0
}
