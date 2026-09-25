import Foundation

/* Reglas del escenario por el ancho del VÍDEO (las consultas de contenedor de player.css y
   match-center.css miran el ancho del marco, no la pantalla; a4 §4.1, §5.2, §6.2, §18, §18.1) y por
   la maquetación de la ventana («móvil» < 768, a2 §2.3). Pura: se prueba con VarianteEscenarioTests. */

struct VarianteEscenario: Hashable, Sendable {
    /// Ancho del marco del vídeo, en pt.
    var anchoVideo: Double
    /// Maquetación «móvil» (ventana < 768): ⌄ en vez de la cápsula del canal y sin Detener en la fila (`ctx.compact`).
    var compacto: Bool
    /// Inmersivo (pantalla completa o teléfono en horizontal viendo el teatro).
    var inmersivo: Bool

    init(anchoVideo: Double, anchoVentana: Double, inmersivo: Bool) {
        self.anchoVideo = anchoVideo
        self.compacto = anchoVentana < 768  // a2 §2.3
        self.inmersivo = inmersivo
    }

    /// El minuto tras «Marcador» se esconde con el vídeo < 370 (match-center.css:156; a4 §6.2).
    var minutoTrasMarcador: Bool { anchoVideo >= 370 }
    /// «Ir al directo · −34 s» entero desde 420; por debajo, solo «−34 s» (a4 §5.4).
    var prefijoDirecto: Bool { anchoVideo >= 420 }
    /// Marcador ancho desde 480: palabra 15, barras de censura y escudos 24 (a4 §6.1-§6.2).
    var marcadorAncho: Bool { anchoVideo >= 480 }
    /// Panel de mensaje grande desde 481 (marca de 48, titular 22; a4 §8.1).
    var mensajeGrande: Bool { anchoVideo >= 481 }
    /// Detener en la fila de abajo: fuera de «compacto» y con el vídeo ≥ 580 (a4 §18, §18.1).
    var detenerEnFila: Bool { !compacto && anchoVideo >= 580 }
    /// ⌄ Minimizar arriba a la izquierda solo en «compacto» (a4 §5.2, §18.1).
    var minimizarVisible: Bool { compacto }
    /// La cápsula «canal que suena» sustituye a ⌄ fuera de «compacto» (a4 §18).
    var capsulaCanal: Bool { !compacto }
    /// Deslizar hacia abajo minimiza solo en «compacto» y fuera del inmersivo (a4 §5.3, §18.1).
    var deslizarAbajoMinimiza: Bool { compacto && !inmersivo }
    /// «Datos técnicos» en cristal sobre el vídeo: solo en inmersivo en el iPhone (a4 §15, §18.1).
    var datosSobreVideo: Bool { inmersivo }
    /// Cuánto sube la cápsula de estado con los controles de abajo: 64 desde 768 de ventana, 60 si no (a4 §7.1, §18.1).
    var subidaEstado: Double { compacto ? 60 : 64 }

    /// Relleno de los controles: 8 en el móvil en vertical; 12 desde 768 y en inmersivo, o la zona segura si es
    /// mayor (`max(12, safe-*)`, a4 §5.2 y §18).
    func rellenoControles(_ seguras: Margenes) -> Margenes {
        guard inmersivo || !compacto else { return Margenes(arriba: 8, izquierda: 8, abajo: 8, derecha: 8) }
        return Margenes(
            arriba: max(12, seguras.arriba), izquierda: max(12, seguras.izquierda),
            abajo: max(12, seguras.abajo), derecha: max(12, seguras.derecha))
    }

    /// Con AirPlay en la cápsula de la derecha y «Reanudar» (112,7) la fila de abajo no cabe a 375: el botón
    /// Directo pasa a solo icono antes que solaparse (b-arquitectura §0.3). Cuenta la fila del móvil: relleno 8,
    /// pausa 52, hueco 8, cápsula −30 · silencio 98,7, hueco 8 y la cápsula de la derecha (a4 §4.1).
    func directoSoloIcono(anchoDirecto: Double, airPlay: Bool) -> Bool {
        guard airPlay else { return false }
        let izquierda: Double = 174.7  // 8 + 52 + 8 + 98,7 + 8
        let derecha: Double = anchoDirecto + 88  // Directo · AirPlay (44) · ⛶ (44)
        let fila: Double = izquierda + derecha + 8
        return fila > anchoVideo
    }

    /// Anchos del botón Directo medidos en la web (a4 §4.1, §18.1): `live` 95,7 · `behind` 82 (sin prefijo) o
    /// 164,3 (con prefijo) · `resume` 112,7 · `off` 95,7.
    func anchoDirecto(_ modo: ModoDirecto) -> Double {
        switch modo {
        case .off, .live: 95.7
        case .behind: prefijoDirecto ? 164.3 : 82
        case .resume: 112.7
        }
    }
}
