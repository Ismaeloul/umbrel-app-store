import SwiftUI

/* Una sección de la hoja de gustos (M5; a3 §13.2-§13.4; `PreferenceSection`): «01 Tus ligas» y su pista, los
   chips (fijos y tuyos; oro con ✓ al marcarlos; deshabilitados con la lista llena), «Añadir otro…» con su
   botón «Añadir» (el campo conserva el foco) y el mensaje de tope. Háptica de selección al marcar y añadir. */

struct SeccionGustos: View {
    let tipo: TipoGusto
    let borrador: GustosFutbol
    let deshabilitado: Bool
    let cambiar: (GustosFutbol) -> Void
    @Environment(Haptica.self) private var haptica
    @State private var texto = ""
    @State private var mensaje: String?
    @FocusState private var enfocado: Bool

    private var lleno: Bool { borrador[keyPath: tipo.clave].count >= tipo.maximo }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            cabecera
            Flujo(horizontal: 10, vertical: 10) {
                ForEach(ModeloGustos.chips(tipo, borrador), id: \.self) { nombre in chip(nombre) }
            }
            anadir
            if let aviso = mensaje ?? (lleno ? tipo.textoLleno : nil) {
                Text(aviso).estilo(.pista).foregroundStyle(Palco.text2)
            }
        }
    }

    private var cabecera: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(tipo.numero)
                .estilo(EstiloTexto(tamano: 17, peso: 800, anchura: 125, trackingEm: 0.02, altoLinea: 1))
                .foregroundStyle(Palco.accentInk)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(tipo.titulo).estilo(.tituloVacio).accessibilityAddTraits(.isHeader)
                Text(tipo.explicacion).estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text2)
            }
        }
    }

    private func chip(_ nombre: String) -> some View {
        let marcado = borrador[keyPath: tipo.clave].contains(nombre)
        return ChipGusto(nombre: nombre, tipo: tipo, marcado: marcado) {
            haptica.disparar(.seleccion)
            cambiar(ModeloGustos.alternar(borrador, tipo, nombre))
        }
        .disabled(deshabilitado || (!marcado && lleno))
    }

    private var anadir: some View {
        HStack(spacing: 8) {
            CampoTexto(
                tipo.marcador.replacingOccurrences(of: "…", with: ""), texto: $texto, marcador: tipo.marcador, icono: .plus,
                piel: .buscador, ocultarEtiqueta: true, enfocado: $enfocado
            )
            .submitLabel(.done)
            .onSubmit(anadirPropio)
            .onChange(of: texto) { _, nuevo in
                if nuevo.count > tipo.largoMaximo { texto = String(nuevo.prefix(tipo.largoMaximo)) }
            }
            BotonAnadir(etiqueta: tipo.etiquetaAnadir, accion: anadirPropio)
        }
        .frame(maxWidth: 480, alignment: .leading)
        .disabled(deshabilitado)
    }

    /// `add`: se ignora con menos de 2 letras; con la lista llena, el mensaje; si entra, se marca y el campo
    /// se vacía conservando el foco.
    private func anadirPropio() {
        let resultado = ModeloGustos.anadir(borrador, tipo, texto)
        if resultado.lleno {
            mensaje = tipo.textoLleno
        } else if resultado.anadido == nil {
            mensaje = nil
        } else {
            haptica.disparar(.seleccion)
            cambiar(resultado.borrador)
            texto = ""
            mensaje = nil
        }
        enfocado = true
    }
}

/// Chip de 44: `--surface-2` con filo; marcado, oro con ✓ delante (el cambio de color es instantáneo).
private struct ChipGusto: View {
    let nombre: String
    let tipo: TipoGusto
    let marcado: Bool
    let accion: () -> Void
    @Environment(\.isEnabled) private var habilitado

    var body: some View {
        Button(action: accion) {
            HStack(spacing: 8) {
                if marcado { IconoPalco(.check, tamano: 16).padding(.leading, -4) }
                adorno
                Text(nombre).estilo(EstiloTexto(tamano: 15, peso: 640, anchura: 88, altoLinea: 1.45)).lineLimit(1)
            }
            .padding(.leading, tipo == .ligas ? 18 : 12)
            .padding(.trailing, 18)
            .frame(height: 44)
            .background(fondo)
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(marcado ? Palco.onAccent : Palco.text)
        .opacity(habilitado ? 1 : 0.55)
        .accessibilityAddTraits(marcado ? [.isSelected] : [])
    }

    @ViewBuilder private var adorno: some View {
        switch tipo {
        case .nacionalidades:
            Text(ModeloGustos.bandera(nombre)).font(Mona.fuente(17, peso: 450)).accessibilityHidden(true)
        case .equipos:
            MarcaEquipo(equipo, tamano: 22, encendido: false).accessibilityHidden(true)
        case .ligas:
            EmptyView()
        }
    }

    /// Monograma de 22 con el color del nombre (las opciones no traen escudo).
    private var equipo: DatosEquipo {
        let paleta = ColoresPartido.paleta(nombre: nombre, colores: nil)
        return DatosEquipo(
            nombre: nombre, siglas: ColoresPartido.iniciales(nombre, corto: nil), primario: paleta.primario,
            secundario: nil, escudo: nil, halo: nil)
    }

    @ViewBuilder private var fondo: some View {
        if marcado {
            Capsule().fill(Palco.accent)
                .brilloSuperior(Color.white.opacity(0.35), forma: Capsule())
                .sombra([CapaSombra(y: 2, desenfoque: 8, color: Color.black.opacity(0.16))], forma: Capsule())
        } else {
            Capsule().fill(Palco.surface2).bordeInterior(Palco.lineSoft, forma: Capsule())
        }
    }
}

/// «Añadir»: pequeño `quiet` con + 18, alto 52, relleno 0 14, 13/650 (a3 §13.2).
private struct BotonAnadir: View {
    let etiqueta: String
    let accion: () -> Void

    var body: some View {
        Button(action: accion) {
            HStack(spacing: 8) {
                IconoPalco(.plus, tamano: 18)
                Text("Añadir").estilo(.botonSm)
            }
            .padding(.horizontal, 14)
            .frame(height: 52)
            .background(Palco.lineSoft, in: Capsule())
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(Palco.text)
        .fixedSize()
        .accessibilityLabel(etiqueta)
    }
}
