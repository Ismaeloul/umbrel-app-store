import Foundation

/* Políticas de caché de las consultas (b-arquitectura §2.5.1, I0→M1), las de TanStack en la web con
   nombre (a7 §4.1-§4.2): frescura con y sin tiempo real, reintentos y qué pasa al volver a la app. */

enum AlVolverActiva: Sendable { case siempre, soloSinTiempoReal, nunca }

struct PoliticaConsulta: Sendable {
    var frescuraConTiempoReal: Duration? = nil  // nil = no caduca (el SSE avisa)
    var frescuraSinTiempoReal: Duration = .seconds(30)
    var reintentos = 2  // a 1 s y 2 s, solo si el error es reintentable
    var alVolverActiva: AlVolverActiva = .soloSinTiempoReal
    var siempreAlMontar = false

    static let porDefecto = PoliticaConsulta()
    static let agenda = PoliticaConsulta(
        frescuraConTiempoReal: .seconds(600), frescuraSinTiempoReal: .seconds(600), alVolverActiva: .siempre)
    static let marcadores = PoliticaConsulta(
        frescuraConTiempoReal: .seconds(5), frescuraSinTiempoReal: .seconds(5), alVolverActiva: .nunca)
    static let alMontar = PoliticaConsulta(siempreAlMontar: true)
    static let busqueda = PoliticaConsulta(
        frescuraConTiempoReal: .seconds(60), frescuraSinTiempoReal: .seconds(60), reintentos: 0)
}
