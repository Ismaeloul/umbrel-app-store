import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Texto, números y fechas en español con los vectores sacados de la web en Node (ICU) con TZ=Europe/Madrid
   (riesgo 19 de b-arquitectura: «sept.» frente a «sep»). */

struct TextoTests {
    private let v = VectoresComunes.lote

    @Test func plegarUnidadesYFrase() {
        for caso in v.texto {
            #expect(Texto.plegar(caso.texto) == caso.plegado, "foldText(\(caso.texto))")
            #expect(Texto.unidadesJuntas(caso.texto) == caso.unidadesJuntas, "keepUnitsTogether(\(caso.texto))")
            #expect(Texto.frase(caso.texto) == caso.frase, "sentence(\(caso.texto))")
        }
    }

    @Test func pluralYListas() {
        for caso in v.plural { #expect(Texto.plural(caso.cuenta, "partido", "partidos") == caso.texto) }
        for caso in v.listas { #expect(Texto.lista(caso.partes) == caso.texto, "ListFormat(\(caso.partes))") }
    }
}

struct NumerosTests {
    private let v = VectoresComunes.lote.numeros

    @Test func decimalesComoToLocaleString() {
        for caso in v.decimal {
            #expect(
                NumerosES.decimal(caso.valor, maximo: caso.maximo, minimo: caso.minimo) == caso.texto,
                "\(caso.valor).toLocaleString(es-ES, \(caso.minimo)…\(caso.maximo))")
        }
    }

    @Test func segundosVelocidadYCifras() {
        for caso in v.segundos { #expect(NumerosES.segundos(ms: caso.ms) == caso.texto, "seconds(\(caso.ms))") }
        for caso in v.velocidad { #expect(NumerosES.velocidad(kbs: caso.kbs) == caso.texto, "formatSpeed(\(String(describing: caso.kbs)))") }
        for caso in v.cifras {
            let trozos = NumerosES.partirCifras(caso.texto).map { VectoresComunes.Numeros.Trozo(digit: $0.cifra, text: $0.texto) }
            #expect(trozos.map(\.digit) == caso.trozos.map(\.digit), "splitDigits(\(caso.texto))")
            #expect(trozos.map(\.text) == caso.trozos.map(\.text), "splitDigits(\(caso.texto))")
        }
    }

    @Test func mbitConUnDecimal() {
        #expect(NumerosES.mbit(kbps: 4800) == "4,8")
        #expect(NumerosES.mbit(kbps: 2000) == "2,0")
        #expect(NumerosES.segundosDato(nil) == "—" && NumerosES.segundosDato(14) == "14 s")
    }
}

struct FechasTests {
    private let v = VectoresComunes.lote.fechas

    @Test func diasComoDayLabel() {
        for caso in v.dias {
            #expect(FechasES.diaMesCorto(caso.dia) == caso.etiqueta.secondary, "dayLabel(\(caso.dia)).secondary")
            #expect(FechasES.fechaLarga(caso.dia) == caso.etiqueta.long, "dayLabel(\(caso.dia)).long")
            #expect(FechasES.mediodia(caso.dia).map { String(FechasES.partes($0, zona: FechasES.utc).dia) } == caso.etiqueta.number)
            if !["Hoy", "Mañana", "Ayer"].contains(caso.etiqueta.primary) {
                let corto = FechasES.diaSemanaCorto(caso.dia).map { Texto.frase($0) }
                #expect(corto == caso.etiqueta.primary, "dayLabel(\(caso.dia)).primary")
            }
            #expect(FechasES.sumarDias(caso.dia, 1) == caso.mas1)
            #expect(FechasES.sumarDias(caso.dia, -30) == caso.menos30)
        }
    }

    @Test func instantesEnMadrid() throws {
        let ahora = try #require(FechaISO.parse(v.ahora))
        let zona = FechasES.madrid
        for caso in v.instantes {
            let cuando = FechasES.cuando(caso.iso, ahora: ahora, zona: zona)
            #expect(cuando == Cuando(hora: caso.cuando.time, relativo: caso.cuando.relative), "formatWhen(\(caso.iso))")
            let fecha = FechaISO.parse(caso.iso)
            #expect(fecha.map { FechasES.hora($0, zona: zona) } == caso.horaMadrid, "madridHour(\(caso.iso))")
            #expect(fecha.map { FechasES.fechaCorta($0, zona: zona) } == caso.fechaCorta, "shortDate(\(caso.iso))")
            let emparejado = fecha.map { "Emparejado el \(FechasES.fechaConAno($0, zona: zona))" } ?? "Emparejado"
            #expect(emparejado == caso.emparejado, "pairedText(\(caso.iso))")
            #expect((fecha.map { FechasES.fechaYHora($0, zona: zona) } ?? "sin sincronizar") == caso.fechaYHora)
            #expect((fecha.map { FechasES.hora($0, zona: zona) } ?? "") == caso.horaAbierta)
        }
    }
}
