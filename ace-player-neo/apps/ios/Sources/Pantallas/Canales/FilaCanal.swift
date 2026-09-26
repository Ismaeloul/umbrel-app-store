import SwiftUI

/* Fila de canal (M5; a5 §3.5.3-§3.5.6; ChannelRow.tsx): la tesela 64 × 36, el nombre (con el aviso de «canal
   caído»), lo que da hoy según la agenda (en directo con escudos y marcador —tapado si es el que ves— o «A las
   21:30, Local – Visitante») y la meta («En pantalla», el minuto o el subtítulo); a la derecha «…». Tocar
   reproduce (sin háptica ni respuesta visual, como la web); pulsación larga = menú contextual nativo. */

struct FilaCanal: View {
    let canal: CanalFila
    let subtitulo: String
    let caido: Bool
    let enPantalla: Bool
    let antena: CanalEnAntena
    let tapado: Bool
    let acciones: [AccionMenu]
    let reproducir: () -> Void
    let identificador: String
    @Environment(\.maquetacion) private var maquetacion

    private var titulo: String { canal.titulo.isEmpty ? "Canal sin nombre" : canal.titulo }

    var body: some View {
        HStack(spacing: 0) {
            principal
                .contentShape(Rectangle())
                .onTapGesture(perform: reproducir)
                .menuContextual(acciones)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(enPantalla ? "\(titulo), en pantalla" : titulo)
                .accessibilityHint(LineaAntena.texto(antena, tapado: tapado) ?? subtitulo)
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier(identificador)
            BotonMas(etiqueta: "Más acciones para \(titulo)") { acciones }
                .frame(width: 44, height: 44)
                .padding(.trailing, 6)
        }
    }

    private var principal: some View {
        HStack(spacing: 14) {
            MarcaCanal(nombre: titulo, forma: .tesela, tamano: 36)
                .sombra([CapaSombra(y: 4, desenfoque: 12, expansion: -4, color: Color.black.opacity(0.5))],
                        forma: RoundedRectangle(cornerRadius: 5.76, style: .circular))
            VStack(alignment: .leading, spacing: 3) {
                nombre
                LineaAntena(antena: antena, tapado: tapado)
                MetaFila(antena: antena, enPantalla: enPantalla, tapado: tapado, subtitulo: subtitulo)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .frame(minHeight: 72)
    }

    private var nombre: some View {
        HStack(spacing: 6) {
            Text(titulo)
                .estilo(EstiloTexto(tamano: 15, peso: 800, anchura: 125, trackingEm: -0.012, altoLinea: 1.2))
                .foregroundStyle(Palco.text)
                .lineLimit(1)
            if caido {
                IconoPalco(.aviso, tamano: 16)
                    .foregroundStyle(Palco.weakInk)
                    .accessibilityLabel("Este canal ya no aparece en la última sincronización")
            }
        }
    }
}

/// La línea de lo que da hoy (`OnAirLine`): 13 `--text-2`, escudos de 18 (encendidos en directo).
struct LineaAntena: View {
    let antena: CanalEnAntena
    let tapado: Bool

    /// El texto que se lee (y va como pista a VoiceOver).
    static func texto(_ antena: CanalEnAntena, tapado: Bool) -> String? {
        if let directo = antena.directo {
            let p = directo.partido
            guard !p.away.isEmpty else { return p.title }
            if !tapado, let m = Marcadores.pintable(directo.marcador) { return "\(p.home) \(m.home) a \(m.away) \(p.away)" }
            return "\(p.home) – \(p.away)"
        }
        guard let siguiente = antena.siguiente else { return nil }
        let p = siguiente.partido
        let equipos = p.away.isEmpty ? p.title : "\(p.home) – \(p.away)"
        return ReglasAgenda.minutosDeHora(p.time) == nil ? "Hoy, hora por confirmar: \(equipos)" : "A las \(p.time), \(equipos)"
    }

    var body: some View {
        if let directo = antena.directo {
            linea(directo.partido, encendido: true) { textoDirecto(directo) }
        } else if let siguiente = antena.siguiente {
            linea(siguiente.partido, encendido: false) { textoSiguiente(siguiente.partido) }
        }
    }

    private func linea<Contenido: View>(_ partido: FootballMatch, encendido: Bool, @ViewBuilder texto: () -> Contenido) -> some View {
        HStack(spacing: 8) {
            EscudosMini(partido: partido, encendido: encendido)
            texto()
        }
        .foregroundStyle(Palco.text2)
        .lineLimit(1)
    }

    private var estilo: EstiloTexto { EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45) }

    @ViewBuilder private func textoDirecto(_ directo: PartidoAntena) -> some View {
        let p = directo.partido
        let fuerte = EstiloTexto(tamano: 13, peso: 560, altoLinea: 1.45)
        if p.away.isEmpty {
            Text(p.title).estilo(fuerte).foregroundStyle(Palco.text)
        } else if !tapado, let m = Marcadores.pintable(directo.marcador) {
            HStack(spacing: 4) {
                Text(p.home).estilo(fuerte)
                Num("\(m.home)–\(m.away)", tamano: 13, etiqueta: "\(m.home) a \(m.away)", animacion: .rueda)
                Text(p.away).estilo(fuerte)
            }
            .foregroundStyle(Palco.text)
        } else {
            Text("\(p.home) – \(p.away)").estilo(fuerte).foregroundStyle(Palco.text)
        }
    }

    @ViewBuilder private func textoSiguiente(_ p: FootballMatch) -> some View {
        let equipos = p.away.isEmpty ? p.title : "\(p.home) – \(p.away)"
        if ReglasAgenda.minutosDeHora(p.time) == nil {
            Text("Hoy, hora por confirmar: \(equipos)").estilo(estilo)
        } else {
            HStack(spacing: 0) {
                Text("A las ").estilo(estilo)
                Num(p.time, estilo: estilo)
                Text(", \(equipos)").estilo(estilo)
            }
        }
    }
}

/// Dos escudos de 18 solapados (el segundo con margen −5).
private struct EscudosMini: View {
    let partido: FootballMatch
    let encendido: Bool

    var body: some View {
        HStack(spacing: -5) {
            MarcaEquipo(equipo(local: true), tamano: 18, encendido: encendido)
            if !partido.away.isEmpty { MarcaEquipo(equipo(local: false), tamano: 18, encendido: encendido) }
        }
        .accessibilityHidden(true)
    }

    private func equipo(local: Bool) -> DatosEquipo {
        let lado = TarjetasAgenda.lado(partido, local: local)
        return DatosEquipo(
            nombre: lado.nombre, siglas: lado.siglas, primario: lado.primario, secundario: lado.secundario,
            escudo: RecursosServidor.imagen(lado.escudo), halo: lado.luz)
    }
}

/// La meta (`.ch__meta`): «En pantalla» con el ecualizador, el minuto y «En directo» / «Marcador oculto», o el
/// subtítulo; 12 `--text-3`, alto mínimo 20.
private struct MetaFila: View {
    let antena: CanalEnAntena
    let enPantalla: Bool
    let tapado: Bool
    let subtitulo: String

    var body: some View {
        HStack(spacing: 8) {
            if enPantalla { CapsulaEnPantalla() }
            if let directo = antena.directo {
                minuto(directo.marcador)
                Text(tapado ? "Marcador oculto" : "En directo")
                    .estilo(EstiloTexto(tamano: 12, peso: 560, altoLinea: 1.45))
                    .foregroundStyle(tapado ? Palco.text2 : Palco.liveInk)
            } else {
                Text(subtitulo).estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text3)
            }
        }
        .lineLimit(1)
        .frame(minHeight: 20)
    }

    private func minuto(_ marcador: LiveScore?) -> some View {
        HStack(spacing: 2) {
            PuntoDirecto()
            if IndiceAntena.descanso(marcador) {
                Text("Descanso").estilo(EstiloTexto(tamano: 13, peso: 650, altoLinea: 1.45))
            } else if let minuto = IndiceAntena.minuto(marcador) {
                Num(minuto, tamano: 13, etiqueta: "minuto \(minuto)", animacion: .rueda)
            }
        }
        .foregroundStyle(Palco.liveInk)
    }
}

/// «En pantalla»: oro, 11/650/88, con el ecualizador de tres barras que late (quieto con movimiento reducido).
struct CapsulaEnPantalla: View {
    var body: some View {
        HStack(spacing: 6) {
            EcualizadorFila()
            Text("En pantalla").estilo(EstiloTexto(tamano: 11, peso: 650, anchura: 88, altoLinea: 1.45))
        }
        .padding(.horizontal, 8)
        .frame(minHeight: 22)
        .background(Palco.accent, in: Capsule())
        .foregroundStyle(Palco.onAccent)
        .fixedSize()
    }
}

/// Tres barras 3 × 10 separadas 2 que laten `scaleY 0,3 ↔ 1` en 1,1 s (desfases 0, −0,4, −0,8 s).
private struct EcualizadorFila: View {
    @Environment(\.movimientoReducido) private var reducido
    private static let desfases: [Double] = [0, 0.4, 0.8]
    private static let quietas: [Double] = [1, 0.5, 0.75]

    var body: some View {
        TimelineView(.animation(paused: reducido)) { contexto in
            let t = contexto.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(0..<3, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 1)
                        .frame(width: 3, height: 10)
                        .scaleEffect(x: 1, y: escala(i, t), anchor: .bottom)
                }
            }
        }
        .frame(height: 10)
        .accessibilityHidden(true)
    }

    private func escala(_ i: Int, _ t: Double) -> Double {
        if reducido { return EcualizadorFila.quietas[i] }
        let fase = ((t + EcualizadorFila.desfases[i]).truncatingRemainder(dividingBy: 2.2)) / 1.1  // ida y vuelta
        let x = fase <= 1 ? fase : 2 - fase
        return 0.3 + 0.7 * x
    }
}
