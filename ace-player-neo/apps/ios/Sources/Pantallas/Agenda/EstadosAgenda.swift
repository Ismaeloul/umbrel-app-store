import SwiftUI

/* Estados de la agenda (M5; a3 §10): cargando (barra de 180 × 20 y tres tarjetas 16:10), error sin datos,
   «Nada de los tuyos este día» y «Sin partidos anunciados», con sus textos y botones literales. */

/// «Cargando partidos»: una barra de 180 × 20 (radio 10) y una fila de 3 tarjetas de 240 (16:10, radio 14).
struct CargandoPartidos: View {
    @Environment(\.maquetacion) private var maquetacion

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Esqueleto(ancho: 180, alto: 20, radio: R.s)
            HStack(spacing: 12) {
                ForEach(0..<3, id: \.self) { _ in
                    Esqueleto(ancho: tarjeta, alto: tarjeta * 10 / 16, radio: R.m)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipped()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Cargando partidos")
    }

    private var tarjeta: CGFloat { maquetacion.tipo == .movil ? 240 : 300 }
}

/// Error sin datos: «No pudimos cargar la agenda» con «Reintentar» e «Ir a los canales».
struct ErrorAgenda: View {
    let reintentando: Bool
    let reintentar: () -> Void
    let irACanales: () -> Void

    var body: some View {
        EstadoVacio(
            titulo: "No pudimos cargar la agenda",
            texto: "La fuente de partidos no respondió. Puedes volver a intentarlo.", error: true
        ) {
            BotonPalco("Reintentar", icono: .refresh, ocupado: reintentando, accion: reintentar)
            BotonPalco("Ir a los canales", icono: .biblioteca, variante: .quieto, accion: irACanales)
        }
        .accessibilityLabel("Error: la fuente de partidos no respondió")
    }
}

/// «Para ti» sin partidos (con gustos).
struct NadaDeLosTuyos: View {
    let editarGustos: () -> Void
    let verTodos: () -> Void

    var body: some View {
        EstadoVacio(
            titulo: "Nada de los tuyos este día",
            texto: "No hay partidos de tus ligas, equipos o selecciones favoritas. Puedes cambiar tus gustos o ver todos."
        ) {
            BotonPalco("Editar mis gustos", icono: .pencil, accion: editarGustos)
            BotonPalco("Ver todos", variante: .quieto, accion: verTodos)
        }
    }
}

/// Día sin partidos: «Ver el día siguiente» si lo hay; si no, «Actualizar».
struct DiaSinPartidos: View {
    let haySiguiente: Bool
    let actualizando: Bool
    let verSiguiente: () -> Void
    let actualizar: () -> Void

    var body: some View {
        EstadoVacio(
            titulo: "Sin partidos anunciados",
            texto: "No hay emisiones de fútbol registradas para este día. Prueba otra fecha."
        ) {
            if haySiguiente {
                BotonPalco("Ver el día siguiente", iconoFinal: .chevR, variante: .quieto, accion: verSiguiente)
            } else {
                BotonPalco("Actualizar", icono: .refresh, variante: .quieto, ocupado: actualizando, accion: actualizar)
            }
        }
    }
}
