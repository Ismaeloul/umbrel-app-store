import SwiftUI

/* El teatro de un partido sin partido (index.tsx de match-center; a4 §17): el esqueleto mientras llega la agenda
   y los vacíos «No se pudo cargar la agenda» (error) y «Este partido ya no está en la agenda». */

/// Esqueleto: kicker 160×14 (radio 10), fila con círculo 36 · barra `min(60 %, 320)`×28 · círculo 36, una píldora
/// de ancho completo ×48 y tres filas «Cargando el partido…».
struct EsqueletoPartido: View {
    @Environment(\.maquetacion) private var maquetacion

    var body: some View {
        let barra: CGFloat = CGFloat(min(0.6 * (maquetacion.ancho - 32), 320))
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Esqueleto(ancho: 160, alto: 14, radio: R.s)
                HStack(spacing: 10) {
                    Esqueleto(ancho: 36, alto: 36, radio: 18)
                    Esqueleto(ancho: barra, alto: 28, radio: R.m)
                    Esqueleto(ancho: 36, alto: 36, radio: 18)
                }
            }
            .padding(.top, 12)
            Esqueleto(alto: 48, radio: 24)
            FilasEsqueleto(3, anuncio: "Cargando el partido…")
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Cargando el partido…")
    }
}

/// «No se pudo cargar la agenda» / «Este partido ya no está en la agenda» con sus botones.
struct PartidoQueNoEsta: View {
    let error: Bool
    let reintentar: () -> Void
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas

    var body: some View {
        EstadoVacio(
            titulo: error ? "No se pudo cargar la agenda" : "Este partido ya no está en la agenda",
            texto: error
                ? "Sin la agenda no sabemos qué canales emiten el partido. Puedes pegar un Content ID."
                : "Puede que la agenda se haya actualizado. Búscalo de nuevo o pega un Content ID.",
            error: error
        ) {
            if error { BotonPalco("Reintentar", icono: .refresh, accion: reintentar) }
            BotonPalco("Ir a la agenda", icono: .agenda, variante: .quieto) { navegador.ir(.agenda) }
            BotonPalco("Pegar hash", icono: .paste, variante: .quieto) { hojas.abrir(.pegar(.libre)) }
        }
    }
}
