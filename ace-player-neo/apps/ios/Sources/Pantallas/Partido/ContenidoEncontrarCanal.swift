import SwiftUI
import UIKit

/* Hoja «Encontrar canal» (ResolverSheet.tsx; a4 §13.3, tamaño md): se abre sola cuando la resolución no es clara.
   Resumen («No hemos encontrado el canal» / «Elige la señal que quieres usar»), lo que se revisó («M3U ✓»…), las
   candidatas (suenan al pulsarlas, sin esperar al comprobador) con «Recordar mi elección para {canal}» marcada y,
   siempre, el bloque manual para pegar un Content ID y vincularlo. */

struct ContenidoEncontrarCanal: View {
    @Environment(CentroHojas.self) private var hojas
    @Environment(SesionFuentes.self) private var fuentes
    @Environment(Navegador.self) private var navegador
    @Environment(DatosApp.self) private var datos
    @State private var recordar = true
    @State private var texto = ""
    @State private var error: String?
    @State private var ocupado = false

    private var resolucion: Resolution? {
        let sesion: SesionFuentes = fuentes
        let valor: Resolution? = sesion.resolucion
        return valor
    }
    private var candidatas: [ResolutionCandidate] { resolucion?.candidates ?? [] }
    private var noEncontrado: Bool { resolucion?.status != .choices }

    /// El canal por el que se pregunta: el primero de la resolución, si no el primero del partido (`resolverChannel`).
    private var canal: String {
        if let primero = resolucion?.channels.first, !primero.isEmpty { return primero }
        if case .partido(let id) = navegador.capa, let partido = BuscarPartido.en(datos.agenda.datos, id: id),
            let primero = partido.channels.first?.name, !primero.isEmpty
        {
            return primero
        }
        return "Canal por confirmar"
    }

    var body: some View {
        ContenidoHoja(titulo: "Encontrar canal", tamano: .md) {
            hojas.cerrar()
        } cuerpo: {
            VStack(alignment: .leading, spacing: 16) {
                ResumenResolucion(noEncontrado: noEncontrado, buscadorDisponible: resolucion?.engineAvailable != false)
                if let revisado = resolucion?.checked, !revisado.isEmpty { ChipsRevisado(valores: revisado) }
                if !candidatas.isEmpty { listaCandidatas }
                BloqueManual(canal: canal, texto: $texto, error: $error, ocupado: ocupado) { vincular() }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.hojaEncontrarCanal)
    }

    private var listaCandidatas: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(candidatas) { candidata in
                FilaCandidata(candidata: candidata) { elegir(candidata) }
                    .disabled(ocupado)
            }
            CasillaRecordar(canal: canal, marcada: $recordar)
        }
    }

    private func elegir(_ candidata: ResolutionCandidate) {
        guard !ocupado else { return }
        ocupado = true
        let recordarla = recordar
        Task {
            await fuentes.elegirCandidata(candidata, recordar: recordarla)
            ocupado = false
        }
    }

    /// «Vincular y reproducir»: valida y vincula siempre (`bindManual`).
    private func vincular() {
        guard !ocupado else { return }
        guard ReglasFuentes.hashValido(texto) != nil else {
            error = ReglasFuentes.textoHashNoValido
            return
        }
        ocupado = true
        let valor = texto
        Task {
            do {
                try await fuentes.vincularManual(valor)
                texto = ""
                error = nil
            } catch {
                self.error = ReglasFuentes.textoHashNoValido
            }
            ocupado = false
        }
    }
}

/// Cuadro de 44 (radio 14, `--accent-wash`, icono 24 `--accent-ink`: lupa o tele) + título 17/800 y texto 13.
private struct ResumenResolucion: View {
    let noEncontrado: Bool
    let buscadorDisponible: Bool

    private var texto: String {
        if !noEncontrado { return "Hay varias coincidencias posibles. No reproduciremos ninguna sin que la confirmes." }
        return buscadorDisponible
            ? "No aparece en tus listas ni en el buscador AceStream. Puedes buscarlo fuera y pegarlo aquí."
            : "Revisamos tus listas, pero el buscador AceStream no estaba disponible. Puedes introducirlo manualmente."
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconoPalco(noEncontrado ? .buscar : .tv, tamano: 24)
                .foregroundStyle(Palco.accentInk)
                .frame(width: 44, height: 44)
                .background(Palco.accentWash, in: RoundedRectangle(cornerRadius: R.m, style: .circular))
            VStack(alignment: .leading, spacing: 4) {
                Text(noEncontrado ? "No hemos encontrado el canal" : "Elige la señal que quieres usar")
                    .estilo(EstiloTexto(tamano: 17, peso: 800, anchura: 125, altoLinea: 1.1))
                Text(texto).estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.25)).foregroundStyle(Palco.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Lo que se revisó: chips de 28 (`--surface-2`, borde `--line-soft`, 12/650 `--text-2`), separación 6.
private struct ChipsRevisado: View {
    let valores: [String]

    private static let nombres: [String: String] = [
        "saved": "Vínculos", "favorites": "Favoritos", "history": "Recientes", "m3u": "M3U", "library": "Biblioteca",
        "acestream": "AceStream", "ai-programming": "IA", "ai": "IA",
    ]

    var body: some View {
        Flujo(horizontal: 6, vertical: 6) {
            ForEach(valores, id: \.self) { valor in
                Text("\(ChipsRevisado.nombres[valor] ?? valor) ✓")
                    .estilo(EstiloTexto(tamano: 12, peso: 650, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(Palco.surface2, in: Capsule())
                    .bordeInterior(Palco.lineSoft, forma: Capsule())
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Lo que se ha revisado")
    }
}

/// Una candidata: botón a todo el ancho (mín. 60, relleno 10 14, radio 14, `--surface-2`, borde `--line-soft`):
/// título 15 en negrita + «Directorio M3U · 91% disponible» 12 y ▶ 20 en `--accent-ink`.
private struct FilaCandidata: View {
    let candidata: ResolutionCandidate
    let accion: () -> Void

    private static let origenes: [String: String] = [
        "saved": "Asociación guardada", "m3u": "Directorio M3U", "favorites": "Favoritos", "history": "Recientes",
        "acestream": "Buscador AceStream",
    ]

    private var detalle: String {
        let origen = FilaCandidata.origenes[candidata.source.rawValue] ?? "Fuente disponible"
        guard let p = ReglasFuentes.porcentaje(candidata.availability) else { return origen }
        return "\(origen) · \(p)% disponible"
    }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        Button(action: accion) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(candidata.title).estilo(EstiloTexto(tamano: 15, peso: 700, altoLinea: 1.25))
                        .foregroundStyle(Palco.text).fixedSize(horizontal: false, vertical: true)
                    Text(detalle).estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text2)
                }
                Spacer(minLength: 0)
                IconoPalco(.play, tamano: 20).foregroundStyle(Palco.accentInk)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .frame(minHeight: 60)
            .background(Palco.surface2, in: forma)
            .bordeInterior(Palco.lineSoft, forma: forma)
            .contentShape(forma)
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(forma)))
        .multilineTextAlignment(.leading)
    }
}

/// «Recordar mi elección para {canal}» (13 `--text-2`, casilla de 20 en `--accent-edge`, alto 44), marcada.
private struct CasillaRecordar: View {
    let canal: String
    @Binding var marcada: Bool

    var body: some View {
        Button { marcada.toggle() } label: {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 5, style: .circular).strokeBorder(Palco.accentEdge, lineWidth: 2)
                    if marcada {
                        RoundedRectangle(cornerRadius: 5, style: .circular).fill(Palco.accentEdge)
                        IconoPalco(.check, tamano: 16).foregroundStyle(Palco.surface)
                    }
                }
                .frame(width: 20, height: 20)
                recordar
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(marcada ? .isSelected : [])
    }

    private var recordar: some View {
        let nombre: Text = Text(verbatim: canal).foregroundStyle(Palco.text).font(Mona.fuente(13, peso: 700))
        let base: Text = Text(verbatim: "Recordar mi elección para ")
        return Text("\(base)\(nombre)")
            .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
            .foregroundStyle(Palco.text2)
    }
}

/// «¿Lo has encontrado por tu cuenta?»: la caja con el nombre del canal (copiar), el campo y «Vincular y reproducir».
private struct BloqueManual: View {
    let canal: String
    @Binding var texto: String
    @Binding var error: String?
    let ocupado: Bool
    let vincular: () -> Void
    @Environment(Avisos.self) private var avisos

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("¿Lo has encontrado por tu cuenta?").estilo(EstiloTexto(tamano: 15, peso: 800, altoLinea: 1.25))
            Text("Pega el Content ID o enlace AceStream. Lo vincularemos a este canal para la próxima vez.")
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text2)
                .fixedSize(horizontal: false, vertical: true)
            cajaCanal
            CampoTexto(
                "Content ID o enlace AceStream", texto: $texto, marcador: "acestream://…", icono: .hash, error: error)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .submitLabel(.go)
                .onSubmit(vincular)
                .onChange(of: texto) { _, _ in if error != nil { error = nil } }
            BotonPalco("Vincular y reproducir", icono: .link, bloque: true, ocupado: ocupado, accion: vincular)
        }
        .padding(.top, 16)
        .overlay(alignment: .top) { Rectangle().fill(Palco.lineSoft).frame(height: 1) }
    }

    /// Fondo `--bg-sunk`, radio 14, borde `--line-soft`, relleno izquierdo 12: el nombre en mono 13 y copiar (44).
    private var cajaCanal: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        return HStack(spacing: 0) {
            Text(canal).estilo(EstiloTexto(tamano: 13, peso: 400, anchura: 87.5, mono: true)).lineLimit(1)
            Spacer(minLength: 0)
            BotonIcono(.copy, etiqueta: "Copiar nombre del canal") {
                UIPasteboard.general.string = canal
                let ok = UIPasteboard.general.string == canal
                avisos.avisar(ok ? "Nombre del canal copiado" : "No se pudo copiar el nombre", tono: ok ? .ok : .warn, icono: .copy)
            }
        }
        .padding(.leading, 12)
        .background(Palco.bgSunk, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
    }
}
