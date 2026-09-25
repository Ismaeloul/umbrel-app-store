import Foundation

// Rescatado en la poda (fase 0.2, b-arquitectura §1.11) de Features/Agenda/AgendaViewModel.swift,
// sin cambios. M5 lo revalida con vectores.

/// Fecha y minuto del día en Madrid (`madridClock` de la web).
struct RelojMadrid: Equatable {
    /// `YYYY-MM-DD`.
    var fecha: String
    /// Minutos desde la medianoche de Madrid.
    var minutos: Int

    init(fecha: String, minutos: Int) {
        self.fecha = fecha
        self.minutos = minutos
    }

    init(_ ahora: Date) {
        let c = FormatoAgenda.calendario.dateComponents([.year, .month, .day, .hour, .minute], from: ahora)
        fecha = String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
        minutos = (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }
}
