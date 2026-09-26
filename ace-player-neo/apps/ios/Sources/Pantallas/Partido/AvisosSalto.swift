import Foundation

/* «Directo» y «−30 s» deciden su aviso DESPUÉS de medir, como la web (player/runtime.ts › goLive y back): los
   segundos que de verdad retrocede, el borde del directo con su colchón y qué pasa si el salto no se hace.
   Reglas puras; EntornoVideo mide antes y después y pinta lo que salga de aquí. */

/// Dónde está el cabezal respecto al borde útil del directo (`measureLive`): el objetivo con el colchón del modo
/// y los segundos que se pueden recuperar.
struct MedidaDirecto: Sendable, Equatable {
    var objetivo: Double
    var detras: Double

    static func medir(ventana: VentanaDirecto?, actual: Double, modo: PlaybackMode) -> MedidaDirecto? {
        guard let ventana else { return nil }
        let seguridad = Directo.colchonSeguridad(modo: modo, duracionVentana: ventana.duracion)
        guard let objetivo = Directo.objetivo(ventana: ventana, seguridad: seguridad) else { return nil }
        let cabezal: Double = actual.isFinite ? actual : ventana.inicio
        return MedidaDirecto(objetivo: objetivo, detras: max(0, objetivo - cabezal))
    }
}

/// Un aviso de la cápsula de estado (`kind: 'signal'`).
struct AvisoSalto: Sendable, Equatable {
    var texto: String
    var tono: TonoAviso
    var icono: NombreIcono?
}

enum ReglasSalto {
    // MARK: Directo (goLive)

    static let demoDirecto = AvisoSalto(
        texto: "Ya estás en el directo (en demo no hay retardo)", tono: .info, icono: .directo)

    /// Sin ventana o a menos de 1,25 s del borde útil no se salta: solo se reanuda (`requestPlay`).
    static func enBorde(_ antes: MedidaDirecto?) -> Bool {
        guard let antes else { return true }
        return antes.detras <= UmbralesReproductor.toleranciaDirectoS
    }

    /// En el borde: «Ya estabas en el directo» si sonaba; si estaba parado, «Directo reanudado».
    static func avisoEnBorde(sonaba: Bool) -> AvisoSalto {
        sonaba
            ? AvisoSalto(texto: "Ya estabas en el directo", tono: .info, icono: .directo)
            : AvisoSalto(texto: "Directo reanudado", tono: .ok, icono: .directo)
    }

    /// El salto ha llegado si ha quedado pegado al borde (margen de pintar «en directo») o ha recuperado de verdad
    /// terreno (más que la tolerancia del botón).
    static func llego(antes: MedidaDirecto, despues: MedidaDirecto?) -> Bool {
        guard let despues else { return false }
        return despues.detras <= UmbralesReproductor.mostrarDirectoS
            || despues.detras < antes.detras - UmbralesReproductor.toleranciaDirectoS
    }

    /// Detrás del directo: «De vuelta al directo» si llegó; si no, «La señal no deja saltar más adelante».
    static func avisoTrasSaltar(antes: MedidaDirecto, despues: MedidaDirecto?) -> AvisoSalto {
        llego(antes: antes, despues: despues)
            ? AvisoSalto(texto: "De vuelta al directo", tono: .ok, icono: .directo)
            : AvisoSalto(texto: "La señal no deja saltar más adelante", tono: .warn, icono: .aviso)
    }

    // MARK: −30 s (back)

    static let demoRetroceso = AvisoSalto(
        texto: "En la demo no hay imagen guardada que repetir", tono: .info, icono: nil)
    static let sinImagen = AvisoSalto(
        texto: "Todavía no hay imagen guardada para retroceder", tono: .warn, icono: .aviso)
    static let noHayMas = AvisoSalto(texto: "No hay más imagen guardada hacia atrás", tono: .warn, icono: .aviso)

    enum PlanRetroceso: Sendable, Equatable {
        case avisar(AvisoSalto)
        case saltar(real: Double)
    }

    /// Lo que va a hacer −30 antes de pedirlo: el destino es el de `Reproductor.retroceder` (30 s atrás sin
    /// salirse de la ventana, con medio segundo de margen) y `real`, lo que de verdad retrocede.
    static func planRetroceso(ventana: VentanaDirecto?, actual: Double) -> PlanRetroceso {
        guard let ventana else { return .avisar(sinImagen) }
        let ahora: Double = actual.isFinite ? actual : ventana.fin
        let destino: Double = max(ventana.inicio + 0.5, ahora - UmbralesReproductor.retrocesoS)
        let real: Double = ahora - destino
        if real < 1 { return .avisar(noHayMas) }
        return .saltar(real: real)
    }

    /// El salto se ha hecho si el cabezal ha vuelto atrás al menos la mitad de lo pedido.
    static func retrocedio(antes: Double, despues: Double, real: Double) -> Bool {
        despues.isFinite && despues < antes - real / 2
    }

    /// «Retrocedido {n} s · pulsa DIRECTO para volver» con los segundos redondeados (`Math.round`).
    static func avisoRetrocedido(_ real: Double) -> AvisoSalto {
        let segundos = Int((real + 0.5).rounded(.down))
        return AvisoSalto(texto: "Retrocedido \(segundos) s · pulsa DIRECTO para volver", tono: .info, icono: .back)
    }
}
