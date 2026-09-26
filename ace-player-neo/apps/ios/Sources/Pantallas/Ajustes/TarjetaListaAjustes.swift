import SwiftUI

/* Tarjeta de una lista guardada (a6 §3.2; `.dir-card`): rejilla [icono | cuerpo] y las acciones debajo, relleno
   14 16, radio 18, `--bg` con borde `--line-soft` (la activa, 1,5 `--accent-edge`). Icono 40 radio 10; nombre
   15/800/125 con la cápsula oro «En uso»; URL en Martian 12; meta 12 en `--text-3` (con fallo, en `--weak-ink`
   y el error del catálogo debajo). Acciones: «Usar»/«Activo», «Actualizar» y la papelera que se arma «¿Borrar?»
   durante 5 s (pegada a la derecha; en horizontal ≥ 620 van a la derecha en la misma fila). */

struct TarjetaListaAjustes: View {
    let lista: WebSourceSummary
    let activa: Bool
    let armada: Bool
    let ocupado: OperacionLista?
    let hayOperacion: Bool
    let usar: () -> Void
    let actualizar: () -> Void
    let borrar: () -> Void

    private var fallo: Bool { lista.lastErrorAt != nil }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                icono
                cuerpo
            }
            acciones
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palco.bg, in: forma)
        .bordeInterior(activa ? Palco.accentEdge : Palco.lineSoft, ancho: activa ? 1.5 : 1, forma: forma)
    }

    private var icono: some View {
        IconoPalco(.list, tamano: 20)
            .foregroundStyle(activa ? Palco.accentInk : Palco.text2)
            .frame(width: 40, height: 40)
            .background(activa ? Palco.accentWash : Palco.surface2, in: RoundedRectangle(cornerRadius: R.s, style: .circular))
            .accessibilityHidden(true)
    }

    private var cuerpo: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(lista.name)
                    .estilo(EstiloTexto(tamano: 15, peso: 800, anchura: 125, trackingEm: -0.01))
                    .foregroundStyle(Palco.text)
                    .lineLimit(1)
                if activa { Capsula("En uso", tono: .oro, tamano: .sm) }
            }
            Text(lista.url)
                .estilo(.mono)
                .foregroundStyle(Palco.text2)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(ModeloListas.meta(lista))
                .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45))
                .foregroundStyle(fallo ? Palco.weakInk : Palco.text3)
                .fixedSize(horizontal: false, vertical: true)
            if fallo, let codigo = lista.lastError {
                HStack(alignment: .top, spacing: 6) {
                    IconoPalco(.aviso, tamano: 16).foregroundStyle(Palco.weakInk)
                    Text(ErrorCatalog.mensaje(para: codigo))
                        .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                        .foregroundStyle(Palco.text2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var acciones: some View {
        HStack(spacing: 8) {
            BotonPalco(activa ? "Activo" : "Usar", variante: activa ? .quieto : .primario, tamano: .sm,
                       ocupado: ocupado == .activar(lista.id), accion: usar)
                .disabled(activa || hayOperacion)
            BotonPalco("Actualizar", icono: .refresh, variante: .quieto, tamano: .sm,
                       ocupado: ocupado == .actualizar(lista.id), accion: actualizar)
                .disabled(hayOperacion)
            Spacer(minLength: 0)
            papelera
        }
    }

    @ViewBuilder private var papelera: some View {
        if armada {
            BotonPalco("¿Borrar?", icono: .trash, variante: .peligro, tamano: .sm, accion: borrar)
                .disabled(hayOperacion)
                .accessibilityLabel("Confirmar: eliminar \(lista.name) y su lista")
        } else {
            BotonIcono(.trash, etiqueta: "Eliminar \(lista.name)", ocupado: ocupado == .borrar(lista.id), accion: borrar)
                .disabled(hayOperacion)
        }
    }
}
