import SwiftUI

/* «Datos técnicos» (NerdSection.tsx y NerdPanel.tsx; a4 §15): la pestaña del teatro (tarjeta 24 con la cabecera,
   el resumen «48 pares · 1,92 MB/s» y la tabla), siempre en la página, debajo del vídeo. Nunca sobre la imagen:
   ni en vertical ni en pantalla completa (Isma, 26-sep; la web saca su panel de cristal en inmersivo). Lo único
   técnico del reproductor: Martian para los valores. Sin la tecla «S» (táctil). */

/// Una fila de la tabla.
struct FilaDatoTecnico: Identifiable {
    var termino: String
    var valor: String
    var id: String { termino }
}

enum TablaDatosTecnicos {
    /// KB/s → «214 KB/s» o «1,92 MB/s» (`formatSpeed`).
    static func velocidad(_ kbs: Double?) -> String {
        guard let kbs, kbs.isFinite else { return "—" }
        if kbs >= 1000 { return "\((kbs / 1024).formatted(.number.precision(.fractionLength(2)).locale(espanol))) MB/s" }
        return "\(Int(kbs.rounded())) KB/s"
    }

    static func segundos(_ valor: Double?) -> String {
        guard let valor, valor.isFinite else { return "—" }
        return "\(valor.formatted(.number.precision(.fractionLength(0...1)).locale(espanol))) s"
    }

    private static let espanol = Locale(identifier: "es_ES")

    /// Motor sin «Motor:» (`summarizeEngine`); en la demo, «en línea (demo)».
    static func motor(_ estado: EngineState?, fallo: Bool, demo: Bool) -> String {
        if demo { return "en línea (demo)" }
        if fallo && estado == nil { return "sin respuesta" }
        switch estado {
        case .some(.online): return "en línea"
        case .some(.restarting): return "arrancando…"
        case .some(.offline): return "apagado"
        default: return "comprobando…"
        }
    }

    /// Las filas de `nerdRows` con lo que sabe el reproductor nativo (HLS del sistema, remux fMP4 para iPhone).
    @MainActor static func filas(_ video: EntornoVideo) -> [FilaDatoTecnico] {
        let r = video.reproductor
        let datosMotor = video.datos.motor
        let stats = r.estadisticas
        let enMarcha = r.canal != nil && r.conexion.enMarcha
        let directo = r.directo.disponible ? r.directo.retraso : nil
        let pares: [(String, String)] = [
            ("Motor", motor(datosMotor.datos?.status, fallo: datosMotor.error != nil, demo: video.demo)),
            ("Reproductor", r.canal == nil ? "—" : (video.demo ? "Demo" : "HLS del sistema")),
            ("Entrega", enMarcha && !video.demo ? "remux fMP4 para iPhone" : "—"),
            ("Pares", stats.map { String($0.peers) } ?? "—"),
            ("Bajada", velocidad(stats?.speedDown)),
            ("Subida", velocidad(stats?.speedUp)),
            ("Estado del motor", stats.map { $0.status.isEmpty ? "—" : $0.status } ?? "—"),
            ("Colchón", r.canal == nil ? "—" : segundos(r.motor.colchonPorDelante)),
            ("Retraso", segundos(directo)),
            ("Primera imagen", r.primeraImagenMs.map { segundos($0 / 1000) } ?? "—"),
            ("Códec", "—"),
            ("Sesión", r.sesionId ?? "—"),
        ]
        return pares.map { FilaDatoTecnico(termino: $0.0, valor: $0.1) }
    }
}

/// La tabla (`PlayerNerdStats`): filas de 24, término a la izquierda y valor en mono 12 a la derecha; el hash
/// ocupa una fila entera.
struct TablaDatos: View {
    let sobreVideo: Bool
    let video = EntornoVideo()

    var body: some View {
        let filas = TablaDatosTecnicos.filas(video)
        VStack(alignment: .leading, spacing: 2) {
            ForEach(filas) { fila in
                HStack(spacing: 8) {
                    Text(fila.termino).estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.25)).foregroundStyle(termino)
                    Spacer(minLength: 8)
                    Text(fila.valor).estilo(.mono).lineLimit(1).truncationMode(.tail)
                }
                .frame(minHeight: 24)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Hash").estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.25)).foregroundStyle(termino)
                Text(video.reproductor.canal?.id ?? "—").estilo(.mono).fixedSize(horizontal: false, vertical: true)
            }
            .frame(minHeight: 24)
        }
    }

    private var termino: Color { sobreVideo ? Color.white.opacity(0.78) : Palco.text2 }
}

/// La pestaña «Datos técnicos» (NerdSection.tsx): tarjeta de relleno 16, radio 24, `--surface`, borde 1.
struct SeccionDatosTecnicos: View {
    let video = EntornoVideo()

    private var resumen: String? {
        guard let stats = video.reproductor.estadisticas else { return nil }
        return "\(stats.peers) pares · \(TablaDatosTecnicos.velocidad(stats.speedDown))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                IconoPalco(.nerd, tamano: 20)
                Text("Datos técnicos").estilo(EstiloTexto(tamano: 15, peso: 800, anchura: 125, altoLinea: 1.1))
                Spacer(minLength: 0)
                if let resumen {
                    Text(resumen).estilo(EstiloTexto(tamano: 12, peso: 400, anchura: 75, mono: true)).lineLimit(1)
                        .foregroundStyle(Palco.text2)
                }
            }
            if video.reproductor.canal != nil {
                TablaDatos(sobreVideo: false)
            } else {
                Text("Aparecen cuando suena una fuente.").estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
            }
        }
        .foregroundStyle(Palco.text)
        .padding(16)
        .background(Palco.surface, in: RoundedRectangle(cornerRadius: R.xl, style: .circular))
        .bordeInterior(Palco.lineSoft, forma: RoundedRectangle(cornerRadius: R.xl, style: .circular))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.panelDatosTecnicos)
    }
}
