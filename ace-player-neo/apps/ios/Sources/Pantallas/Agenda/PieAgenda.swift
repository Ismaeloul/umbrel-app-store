import SwiftUI

/* Pie de la agenda (M5; a3 §14): «Datos de muestra · horario peninsular» o «Datos: {atribución}» a la
   izquierda y la frescura a la derecha; «Consultando horarios y canales…» mientras carga y «Los canales y el
   reproductor siguen disponibles.» con error. También el resumen para VoiceOver. */

enum TextosPieAgenda {
    static let cargando = "Consultando horarios y canales…"
    static let error = "Los canales y el reproductor siguen disponibles."

    /// La fuente: «Datos de muestra» (demo) o «Datos: {atribución | agenda externa}».
    static func fuente(_ agenda: FootballSchedule) -> String {
        if agenda.demo { return "Datos de muestra" }
        return "Datos: \(agenda.attribution.isEmpty ? "agenda externa" : agenda.attribution)"
    }

    /// La primera que aplique: copia, parcial, limitada, «Actualizado a las HH:MM» o «Actualizado».
    static func frescura(_ agenda: FootballSchedule, actualizada: Date?) -> String {
        if agenda.stale == true { return "Última copia disponible" }
        if agenda.partial { return "Cobertura parcial" }
        if agenda.limited { return "Cobertura gratuita limitada" }
        if let actualizada { return "Actualizado a las \(FechasAgenda.hora(actualizada))" }
        return "Actualizado"
    }

    /// El resumen educado para VoiceOver (a3 §14).
    static func resumen(cargando: Bool, error: Bool, foto: FotoAgenda) -> String {
        if cargando { return "Cargando partidos" }
        if error { return "Error: la fuente de partidos no respondió" }
        guard let dia = foto.dia else { return "" }
        let larga = ReglasAgenda.etiquetaDia(dia, hoy: foto.hoy).larga
        var texto = "\(larga): \(FormatoAgenda.partidos(foto.visibles.count))"
        if foto.enDirecto > 0 { texto += ", \(foto.enDirecto) en directo" }
        if foto.modo == .paraTi { texto += ", solo los tuyos" }
        return texto
    }
}

struct PieAgenda: View {
    let agenda: FootballSchedule?
    let cargando: Bool
    let error: Bool
    let actualizada: Date?

    private var estilo: EstiloTexto { EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45) }

    var body: some View {
        Group {
            if cargando {
                Text(TextosPieAgenda.cargando).estilo(estilo)
            } else if let agenda {
                // `flex-wrap` + `space-between`: la frescura a la derecha si cabe; si no, debajo.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        fuente(agenda)
                        Spacer(minLength: 0)
                        frescura(agenda)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        fuente(agenda)
                        frescura(agenda)
                    }
                }
            } else if error {
                Text(TextosPieAgenda.error).estilo(estilo)
            }
        }
        .foregroundStyle(Palco.text3)
        .padding(.top, 4)
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func frescura(_ agenda: FootballSchedule) -> some View {
        Text(TextosPieAgenda.frescura(agenda, actualizada: actualizada)).estilo(estilo).fixedSize()
    }

    private func fuente(_ agenda: FootballSchedule) -> some View {
        HStack(spacing: 0) {
            Text(TextosPieAgenda.fuente(agenda))
                .estilo(EstiloTexto(tamano: 12, peso: 650, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
            Text(" · horario peninsular").estilo(estilo)
        }
    }
}
