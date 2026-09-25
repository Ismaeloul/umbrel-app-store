import SwiftUI

/// Galería «Sistema», bloques 7-10 de a1 §11: señal, directo y equipos, cápsulas y anillos, versus y carrusel.
struct SeccionesSistemaB: View {
    let galeria: EstadoGaleria

    var body: some View {
        SeccionGaleria("Señal de una fuente") { BloqueSenal() }
        SeccionGaleria("Directo, equipos y canales") { BloqueDirecto() }
        SeccionGaleria("Cápsulas y anillos de estado (Palco)") { BloqueCapsulas(galeria: galeria) }
        SeccionGaleria("Tarjeta versus y carrusel (Palco)") { BloqueVersus(galeria: galeria) }
    }
}

private struct BloqueSenal: View {
    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            ForEach(EstadoSenal.allCases, id: \.self) { estado in
                Flujo(horizontal: S.s5, vertical: S.s5) {
                    MedidorSenal(estado, tamano: .lg)
                    MedidorSenal(estado, apilado: true)
                    MedidorSenal(estado, tamano: .sm)
                    MedidorSenal(estado, compacto: true)
                }
                .frame(minHeight: 44)
            }
            MedidorSenal(.fail, palabra: "Sin señal · reintento 20:51")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tarjeta()
    }
}

private struct BloqueDirecto: View {
    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            Flujo(horizontal: S.s4, vertical: S.s4) {
                AnilloMinuto(minuto: "72", progreso: 72.0 / 90, diametro: 50, letra: 17)
                AnilloMinuto(minuto: "Desc.", progreso: 0.5, diametro: 50, letra: 11, descanso: true)
                AnilloMinuto(minuto: "58", progreso: 58.0 / 90, diametro: 40, letra: 13)
                AnilloMinuto(minuto: "12", progreso: 12.0 / 90, diametro: 46, letra: 15)
                HStack(spacing: 4) {
                    PuntoDirecto()
                    Text("3 en directo").estilo(EstiloTexto(tamano: 13, peso: 700, altoLinea: 1.45))
                }
                .foregroundStyle(Palco.liveInk)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .tarjeta()
            Flujo(horizontal: S.s4, vertical: S.s4) {
                MarcaEquipo(MuestrasGaleria.equipo("Atlético de Madrid", "ATM", "#cb3524", "#272e61"), tamano: 64)
                MarcaEquipo(MuestrasGaleria.equipo("Tottenham", "TOT", "#f7f8fa", "#132257"), tamano: 64)
                MarcaEquipo(MuestrasGaleria.equipo("Real Sociedad", "RSO", "#0067b1", "#f4f4f4"), tamano: 28,
                            encendido: false, patron: .franjas)
                MarcaEquipo(MuestrasGaleria.equipo("Galatasaray", "GAL", "#fdb912", "#a90432"), tamano: 28, patron: .mitades)
                MarcaEquipo(MuestrasGaleria.equipo("Equipo sin datos", "EQU", nil, nil), tamano: 28, encendido: false)
                MarcaEquipo(MuestrasGaleria.juve, tamano: 64, encendido: false)
                MarcaCanal(nombre: "DAZN 1", tamano: 52)
                MarcaCanal(nombre: "M+ Liga de Campeones 2", tamano: 52)
                MarcaCanal(nombre: "Eurosport", tamano: 52)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .tarjeta()
            TeselasCanal()
        }
    }
}

/// `.sis-tiles`: teselas alineadas abajo, separación 12.
private struct TeselasCanal: View {
    var body: some View {
        Flujo(horizontal: S.s3, vertical: S.s3) {
            MarcaCanal(nombre: "DAZN 1", forma: .tesela, tamano: 54)
            MarcaCanal(nombre: "M+ Liga de Campeones 2", forma: .tesela, tamano: 72)
            MarcaCanal(nombre: "La 1 HD", forma: .tesela, tamano: 90)
            MarcaCanal(nombre: "Eurosport", forma: .tesela, tamano: 54)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tarjeta()
    }
}

/// `<LiveRing>` simplificado (a1 §10.9: en iPhone solo lo enseña la galería): anillo de 3 que se llena de 0'
/// a 90' en `--live` sobre `--text-3` al 38 %, muesca del descanso y el minuto en `Num` rojo.
private struct AnilloMinuto: View {
    let minuto: String
    let progreso: Double
    let diametro: CGFloat
    let letra: CGFloat
    var descanso = false

    var body: some View {
        ZStack {
            Circle().strokeBorder(Palco.text3.opacity(0.38), lineWidth: 3)
            Circle().inset(by: 1.5).trim(from: 0, to: progreso).stroke(Palco.live, lineWidth: 3).rotationEffect(.degrees(-90))
            Capsule().fill(Palco.text2).frame(width: 2, height: 6).offset(y: diametro / 2 - 2)
            if descanso {
                Text(minuto).estilo(EstiloTexto(tamano: 11, peso: 650, anchura: 88)).foregroundStyle(Palco.live)
            } else {
                Num("\(minuto)'", tamano: letra, etiqueta: "Minuto \(minuto), en directo").foregroundStyle(Palco.live)
            }
        }
        .frame(width: diametro, height: diametro)
        .padding(diametro * 0.08)
    }
}

private struct BloqueCapsulas: View {
    let galeria: EstadoGaleria

    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            Flujo(horizontal: S.s2, vertical: S.s2) {
                Capsula("En directo · 13'", tono: .directo, punto: true)
                Capsula("VIE 21:00", icono: .clock)
                Capsula("Señal lista", tono: .ok, punto: true)
                Capsula("Floja", tono: .weak)
                Capsula("Sin señal", tono: .fail, icono: .aviso)
                Capsula("Tu equipo", tono: .oro, icono: .starF)
                Capsula("Marcador", pulsado: galeria.pulsado) { galeria.pulsado.toggle() }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .tarjeta()
            CapsulasEnCristal()
            AnillosSenal()
        }
    }
}

/// Cápsulas en cristal y pastillas sobre la retransmisión de mentira (cada una a lo ancho de su celda).
private struct CapsulasEnCristal: View {
    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            Capsula("En directo · 72'", tono: .directo, tamano: .sm, punto: true, cristal: .video).frame(maxWidth: .infinity, alignment: .leading)
            Capsula("Señal lista", tono: .ok, tamano: .sm, punto: true, cristal: .video).frame(maxWidth: .infinity, alignment: .leading)
            Capsula("45 min antes", tamano: .sm, icono: .clock, cristal: .video).frame(maxWidth: .infinity, alignment: .leading)
            Capsula("Sin señal", tono: .fail, tamano: .sm, cristal: .video).frame(maxWidth: .infinity, alignment: .leading)
            PastillaCompeticion(nombre: "Champions League", logo: nil, tamano: 28).frame(maxWidth: .infinity)
            PastillaCompeticion(nombre: "LaLiga", logo: nil, tamano: 40).frame(maxWidth: .infinity)
        }
        .padding(.vertical, S.s6)
        .padding(.horizontal, S.s4)
        .background(FondoRetransmision())
        .clipShape(RoundedRectangle(cornerRadius: R.xl, style: .circular))
    }
}

private struct AnillosSenal: View {
    private static let filas: [(EstadoAnillo, String)] = [
        (.senal(.ok), "Verificada"), (.senal(.weak), "Floja"), (.senal(.fail), "Sin señal"),
        (.senal(.checking), "Comprobando"), (.senal(.pending), "Pendiente"), (.reportada, "Reportada"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            ForEach(AnillosSenal.filas, id: \.1) { fila in
                HStack(spacing: S.s5) {
                    AnilloSenal(fila.0, palabra: fila.1)
                    AnilloSenal(fila.0, tamano: 40)
                }
                .frame(minHeight: 44)
            }
            AnilloSenal(.activa, tamano: 40, palabra: "En pantalla").frame(minHeight: 44)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tarjeta()
    }
}

private struct BloqueVersus: View {
    let galeria: EstadoGaleria

    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            TarjetaVersus(MuestrasGaleria.heroe, tamano: .xl) {
                Capsula("Señal lista", tono: .ok, tamano: .sm, punto: true, cristal: .video)
            }
            CarrilCarteles(MuestrasGaleria.carteles, anchoCelda: 240, etiqueta: "Partidos de muestra") { cartel in
                CartelMuestra(cartel: cartel)
            }
            .padding(.horizontal, -S.gutter)
            BloqueProgreso(galeria: galeria)
        }
    }
}

private struct CartelMuestra: View {
    let cartel: MuestrasGaleria.Cartel

    var body: some View {
        TarjetaVersus(cartel.datos, tamano: cartel.pequena ? .sm : .md) { senal }
    }

    @ViewBuilder private var senal: some View {
        switch cartel.id {
        case 0: Capsula("45 min antes", tamano: .sm, icono: .clock, cristal: .video)
        case 1: Capsula("Floja", tono: .weak, tamano: .sm, cristal: .video)
        default: EmptyView()
        }
    }
}

private struct BloqueProgreso: View {
    let galeria: EstadoGaleria

    var body: some View {
        VStack(alignment: .leading, spacing: S.s4) {
            BarraProgreso(valor: galeria.progreso, tono: .directo, muescas: [0.5],
                          etiqueta: "Minuto \(Int((galeria.progreso * 90).rounded())) de 90")
            BarraProgreso(valor: 4.0 / 6, fina: true, etiqueta: "4 de 6 fuentes comprobadas")
            BotonPalco("Avanzar el partido", variante: .quieto, tamano: .sm) {
                galeria.progreso = galeria.progreso >= 1 ? 0.1 : min(1, galeria.progreso + 0.1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tarjeta()
    }
}
