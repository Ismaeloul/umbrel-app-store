#if DEBUG
    import Foundation

    /* Marcadores de la demo (a7 §13.8), port de `demoScores` y `gameMinute` de agenda/demo-data.ts y del
       manejador de `scores` de agenda/demo.ts: se recalculan con el reloj en cada petición (los goles caen
       en su minuto); 45 + 15 de descanso + 45. */

    enum MarcadoresDemo {
        /// `gameMinute`: minuto de juego a partir del tiempo pasado.
        static func minutoDeJuego(_ transcurrido: Double) -> (minuto: Int, descanso: Bool, terminado: Bool) {
            if transcurrido <= 45 { return (max(1, Int(transcurrido.rounded(.up))), false, false) }
            if transcurrido <= 60 { return (45, true, false) }
            if transcurrido <= 108 { return (min(90, Int((transcurrido - 15).rounded(.up))), false, false) }
            return (90, false, true)
        }

        /// `demoScores(now)`.
        static func marcadores(ancla: Double, ahora: Date) -> JSON {
            let ms = ahora.timeIntervalSince1970 * 1000
            var campos: [JSON.Campo] = []
            for item in AgendaDemo.colocar(ancla: ancla) {
                guard let goles = item.muestra.goles else { continue }
                let transcurrido = (ms - item.inicio) / AgendaDemo.minuto
                if transcurrido < -15 { continue }
                if transcurrido < 0 {
                    let previo = JSON.obj([
                        "home": 0, "away": 0, "state": "pre", "clock": "", "detail": "", "confidence": .numero(0.9),
                    ])
                    campos.append(JSON.Campo(clave: item.muestra.id, valor: previo))
                    continue
                }
                let juego = minutoDeJuego(transcurrido)
                let cuenta = { (lista: [Int]) -> Int in lista.filter { $0 <= juego.minuto }.count }
                let detalle = juego.terminado ? "FT" : (juego.descanso ? "HT" : (juego.minuto > 45 ? "2ª parte" : "1ª parte"))
                let reloj = juego.terminado ? "" : "\(juego.minuto)'"
                var marcador = JSON.objeto([])
                marcador["home"] = .num(cuenta(goles.local))
                marcador["away"] = .num(cuenta(goles.visitante))
                marcador["state"] = .texto(juego.terminado ? "post" : "in")
                marcador["clock"] = .texto(reloj)
                marcador["detail"] = .texto(detalle)
                marcador["confidence"] = .numero(0.92)
                campos.append(JSON.Campo(clave: item.muestra.id, valor: marcador))
            }
            return .objeto(campos)
        }

        /// La respuesta de `GET scores` de la demo (agenda/demo.ts).
        static func respuesta(ancla: Double, ahora: Date) -> JSON {
            .obj([
                "available": .bool(true), "generatedAt": .texto(AgendaDemo.iso(AgendaDemo.ms(ahora))), "source": "espn",
                "attribution": "Datos de muestra", "leagues": 3, "scores": marcadores(ancla: ancla, ahora: ahora),
            ])
        }
    }

    extension JSON: ExpressibleByIntegerLiteral {
        init(integerLiteral value: Int) { self = .numero(Double(value)) }
    }
#endif
