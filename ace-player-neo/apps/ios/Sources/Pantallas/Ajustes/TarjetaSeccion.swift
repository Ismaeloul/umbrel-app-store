import SwiftUI

/* La tarjeta de cada sección de Ajustes (a6 §1.1; SettingsView.tsx `Section`): `--surface`, radio 24,
   relleno 16, borde `--line-soft`, `--shadow-1`, columna con separación 16; cabecera con el cuadro de 44 (radio
   14, oro lavado, icono 24 en `--accent-ink`) y el título 22/800/125 (30 en horizontal ≥ 768); descripción
   opcional 13 en `--text-2` a 8 del título. Su id es el ancla del índice de chips. */

struct TarjetaSeccion<Contenido: View>: View {
    let seccion: SeccionAjustes
    let titulo: String
    let icono: NombreIcono
    let descripcion: String?
    let contenido: Contenido
    @Environment(\.maquetacion) private var maquetacion

    init(_ seccion: SeccionAjustes, titulo: String, icono: NombreIcono, descripcion: String? = nil,
         @ViewBuilder contenido: () -> Contenido) {
        self.seccion = seccion
        self.titulo = titulo
        self.icono = icono
        self.descripcion = descripcion
        self.contenido = contenido()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            cabecera
            if let descripcion {
                Text(descripcion)
                    .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, -8)
            }
            contenido
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tarjeta()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.seccion(seccion.rawValue))
    }

    private var cabecera: some View {
        HStack(spacing: 12) {
            IconoPalco(icono, tamano: 24)
                .foregroundStyle(Palco.accentInk)
                .frame(width: 44, height: 44)
                .background(Palco.accentWash, in: RoundedRectangle(cornerRadius: R.m, style: .circular))
                .accessibilityHidden(true)
            Text(titulo)
                .estilo(EstiloTexto(tamano: maquetacion.tipo == .tableta ? 30 : 22, peso: 800, anchura: 125,
                                    trackingEm: -0.02, altoLinea: 1.1))
                .foregroundStyle(Palco.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        }
    }
}

/// Rótulo en mayúsculas de un bloque (kicker 13/700/+0,14 em en `--text-3`), con un dato opcional al lado.
struct RotuloBloque: View {
    let titulo: String
    var dato: String? = nil
    var datoKicker = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: datoKicker ? 6 : 8) {
            Text(titulo).estilo(.kicker).foregroundStyle(Palco.text3).accessibilityAddTraits(.isHeader)
            if let dato {
                if datoKicker {
                    Text("· \(dato)").estilo(.kicker).foregroundStyle(Palco.text3)
                } else {
                    Text(dato).estilo(EstiloTexto(tamano: 13, peso: 560, altoLinea: 1.45)).foregroundStyle(Palco.text3)
                }
            }
        }
    }
}

/// Fila en línea de Dispositivos y Salud (`.disp-inline`, a6 §8.6): relleno 12 14, radio 8, `--bg`, borde
/// `--line-soft`, 15 pt en `--text-2`, icono 18; con error, icono `aviso` en `--fail-ink` y botón «Reintentar».
struct FilaEnLinea<Accion: View>: View {
    let icono: NombreIcono
    let tinta: Color
    let texto: String
    let accion: Accion

    init(icono: NombreIcono, tinta: Color, texto: String, @ViewBuilder accion: () -> Accion) {
        self.icono = icono
        self.tinta = tinta
        self.texto = texto
        self.accion = accion()
    }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: 8, style: .circular)
        HStack(alignment: .top, spacing: 8) {
            IconoPalco(icono, tamano: 18).foregroundStyle(tinta).padding(.top, 2)
            VStack(alignment: .leading, spacing: 8) {
                Text(texto).estilo(.cuerpo).foregroundStyle(Palco.text2).fixedSize(horizontal: false, vertical: true)
                accion
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palco.bg, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
    }
}

extension FilaEnLinea where Accion == EmptyView {
    init(icono: NombreIcono, tinta: Color, texto: String) {
        self.init(icono: icono, tinta: tinta, texto: texto) { EmptyView() }
    }
}

/// Lista con filas separadas por 1 pt (`.disp-list`, a6 §8.9): radio 8, `--bg`, borde `--line-soft`.
struct ListaSeparada<Contenido: View>: View {
    let contenido: Contenido

    init(@ViewBuilder contenido: () -> Contenido) { self.contenido = contenido() }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: 8, style: .circular)
        VStack(spacing: 0) {
            Group(subviews: contenido) { filas in
                ForEach(Array(filas.enumerated()), id: \.offset) { (par: (offset: Int, element: Subview)) in
                    if par.offset > 0 { Rectangle().fill(Palco.lineSoft).frame(height: 1) }
                    par.element
                }
            }
        }
        .background(Palco.bg, in: forma)
        .clipShape(forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
    }
}
