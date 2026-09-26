import SwiftUI

/* «Registro de fallos» de Salud (a6 §9.5; health/DiagnosticsLog.tsx): rótulo con el total de 24 h, chips de
   causa («Todo» y las causas con fallos en 24 h o la elegida; tocar la elegida vuelve a «Todo»), la ayuda de la
   causa, y la lista (esqueleto, error, vacío o filas) con su pie. Con una causa, se pide ya filtrada. */

struct RegistroFallos: View {
    let todas: DiagnosticsListResponse?
    let errorTodas: APIError?
    let cuentasSalud: DiagnosticCounts?
    let nombres: [String: String]
    let ahora: Date
    let reintentar: () -> Void
    @Environment(SesionApp.self) private var sesion
    @State private var causa: DiagnosticCause?
    @State private var filtrado: DiagnosticsListResponse?
    @State private var errorFiltrado: APIError?

    private var cuentas: DiagnosticCounts? { todas?.counts24h ?? cuentasSalud }
    private var fuente: DiagnosticsListResponse? { causa == nil ? todas : filtrado }
    private var error: APIError? { causa == nil ? errorTodas : errorFiltrado }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RotuloBloque(titulo: "Registro de fallos", dato: cuentas.map { "\(RegistroSalud.total($0)) en 24 h" }, datoKicker: true)
            chips
            if let causa {
                Text(RegistroSalud.info(causa).ayuda)
                    .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            cuerpo
            if let fuente, let pie = RegistroSalud.pie(mostrados: fuente.entries.count, guardados: fuente.total) {
                Text(pie).estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text3)
            }
        }
        .task(id: causa) { await pedirFiltrado() }
    }

    private var chips: some View {
        Flujo(horizontal: 8, vertical: 8) {
            Chip("Todo", contador: cuentas.map(RegistroSalud.total), pulsado: causa == nil) { causa = nil }
            ForEach(RegistroSalud.causasVisibles(cuentas, elegida: causa), id: \.self) { (c: DiagnosticCause) in
                let info = RegistroSalud.info(c)
                Chip(info.palabra, icono: info.icono, contador: cuentas.map { RegistroSalud.cuenta(c, en: $0) } ?? 0,
                     pulsado: causa == c) { causa = causa == c ? nil : c }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Filtrar por causa")
    }

    @ViewBuilder private var cuerpo: some View {
        if let fuente {
            if fuente.entries.isEmpty {
                FilaEnLinea(icono: .check, tinta: Palco.okInk, texto: RegistroSalud.vacio(causa: causa))
            } else {
                ListaSeparada {
                    ForEach(fuente.entries) { (e: DiagnosticEntry) in
                        FilaFallo(entrada: e, dispositivo: e.deviceId.flatMap { nombres[$0] }, ahora: ahora)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Fallos registrados")
            }
        } else if let error {
            FilaEnLinea(icono: .aviso, tinta: Palco.failInk, texto: "No se pudo leer el registro. \(error.mensaje)") {
                BotonPalco("Reintentar", icono: .refresh, variante: .quieto, tamano: .sm) {
                    if causa == nil { reintentar() } else { Task { await pedirFiltrado() } }
                }
            }
        } else {
            FilasEsqueleto(3, anuncio: "Leyendo el registro…")
        }
    }

    private func pedirFiltrado() async {
        guard let causa else { return }
        filtrado = nil
        errorFiltrado = nil
        let api = sesion.entorno.api
        do {
            filtrado = try await api.enviar(API.diagnosticos(causa: causa, limite: RegistroSalud.limite))
        } catch {
            let fallo = APIError.desde(error)
            if case .cancelado = fallo { return }
            errorFiltrado = fallo
        }
    }
}

/// Una fila del registro: icono de la causa (32, al 16 %), mensaje 15/560, meta 12 (causa en su tinta · canal ·
/// aparato · «02:34 · ayer»), métricas 13 y el código en Martian 12 `--text-3`.
private struct FilaFallo: View {
    let entrada: DiagnosticEntry
    let dispositivo: String?
    let ahora: Date

    var body: some View {
        let info = RegistroSalud.info(entrada.cause)
        HStack(alignment: .top, spacing: 12) {
            IconoPalco(info.icono, tamano: 16)
                .foregroundStyle(tinta)
                .frame(width: 32, height: 32)
                .background(fondo.opacity(0.16), in: RoundedRectangle(cornerRadius: R.s, style: .circular))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(RegistroSalud.describir(entrada))
                    .estilo(EstiloTexto(tamano: 15, peso: 560, altoLinea: 1.25))
                    .foregroundStyle(Palco.text)
                    .fixedSize(horizontal: false, vertical: true)
                meta(info)
                if let metricas = RegistroSalud.metricas(entrada.metrics) {
                    Text(metricas).estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(entrada.code).estilo(.mono).foregroundStyle(Palco.text3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .accessibilityElement(children: .combine)
    }

    private func meta(_ info: InfoCausa) -> some View {
        let cuando = TiemposSalud.cuando(entrada.at, ahora: ahora)
        return Flujo(horizontal: 10, vertical: 2) {
            Text(info.palabra).estilo(EstiloTexto(tamano: 12, peso: 650, altoLinea: 1.45)).foregroundStyle(tinta)
            if let canal = entrada.channel { Text(canal).estilo(Self.meta).foregroundStyle(Palco.text2) }
            if let dispositivo { Text(dispositivo).estilo(Self.meta).foregroundStyle(Palco.text2) }
            Text("\(cuando.hora) · \(cuando.relativo)").estilo(Self.meta).foregroundStyle(Palco.text2)
        }
    }

    private static let meta = EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)

    /// Motor y datos guardados en ámbar; fuente en rojo; red, códec y reproductor neutros.
    private var fondo: Color {
        switch entrada.cause {
        case .engine, .state: Palco.weak
        case .source: Palco.fail
        default: Palco.text3
        }
    }

    private var tinta: Color {
        switch entrada.cause {
        case .engine, .state: Palco.weakInk
        case .source: Palco.failInk
        default: Palco.text2
        }
    }
}
