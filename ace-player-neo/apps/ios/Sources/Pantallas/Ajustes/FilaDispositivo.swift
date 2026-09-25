import SwiftUI

/* Una fila de «Emparejados» (a6 §8.9; DevicesSection.tsx `DeviceRow`) y la de «Este iPhone» (a6 §8.10.2-§8.10.3):
   alto mínimo 68, relleno 10 12 10 14, [icono 40 | texto | botón] con separación 12 (a 390 el contenedor mide
   ≤ 340 y el botón baja bajo el texto). Nombre 15/800/125; meta 12 con el punto verde de 7 si está conectado
   ahora; segunda meta en `--text-3`. Otros: «Revocar» → «¿Revocar? Pulsa otra vez» (5 s). Este iPhone: icono en
   oro, cápsula «Este iPhone», siempre «Conectado ahora mismo», «Olvidar este iPhone» → «¿Olvidar? Pulsa otra
   vez» con la línea de aviso debajo. Pulsación larga: el menú de la web (nativo) con la misma acción; en los
   revocados, sin botón ni menú. */

struct FilaDispositivo: View {
    enum Tipo: Equatable { case otro, este, revocado, esteSinBoton }

    let dispositivo: Device
    let tipo: Tipo
    let ahora: Date
    let armado: Bool
    let ocupado: Bool
    let accion: () -> Void
    @State private var ancho: CGFloat = 326

    private var esEste: Bool { tipo == .este || tipo == .esteSinBoton }
    private var conBoton: Bool { tipo == .otro || tipo == .este }
    private var conectado: Bool { esEste || ModeloDispositivos.conectado(dispositivo, ahora: ahora) }

    var body: some View {
        HStack(alignment: ancho > 340 ? .center : .top, spacing: 12) {
            icono
            VStack(alignment: .leading, spacing: 2) {
                nombre
                metas
                if conBoton && ancho <= 340 { boton.padding(.top, 8) }
                if tipo == .este && armado { avisoOlvidar }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if conBoton && ancho > 340 { boton }
        }
        .padding(.top, 10)
        .padding(.bottom, 10)
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .frame(minHeight: 68)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { ancho = $0 }
        .modifier(MenuFila(dispositivo: dispositivo, tipo: tipo, armado: armado, accion: accion))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(esEste ? IDUI.filaEsteIPhone : IDUI.filaDispositivo(dispositivo.id))
    }

    private var icono: some View {
        IconoPalco(ModeloDispositivos.icono(dispositivo.platform), tamano: 20)
            .foregroundStyle(esEste ? Palco.accentInk : (conectado ? Palco.text : Palco.text2))
            .frame(width: 40, height: 40)
            .background(esEste ? Palco.accentWash : Palco.surface2, in: RoundedRectangle(cornerRadius: R.s, style: .circular))
            .accessibilityHidden(true)
    }

    private var nombre: some View {
        Flujo(horizontal: 8, vertical: 4) {
            Text(dispositivo.name)
                .estilo(EstiloTexto(tamano: 15, peso: 800, anchura: 125, trackingEm: -0.01))
                .foregroundStyle(tipo == .revocado ? Palco.text2 : Palco.text)
            if esEste { Capsula(ModeloDispositivos.capsulaEste(dispositivo), tono: .oro, tamano: .sm) }
        }
    }

    @ViewBuilder private var metas: some View {
        let plataforma = ModeloDispositivos.plataforma(dispositivo.platform)
        if tipo == .revocado {
            Text("\(plataforma) · \(ModeloDispositivos.revocado(dispositivo))").estilo(Self.meta).foregroundStyle(Palco.text2)
        } else {
            HStack(spacing: 6) {
                if conectado { Circle().fill(Palco.ok).frame(width: 7, height: 7) }
                Text("\(plataforma) · \(esEste ? "Conectado ahora mismo" : ModeloDispositivos.ultimaVez(dispositivo, ahora: ahora))")
                    .estilo(Self.meta).foregroundStyle(Palco.text2)
            }
            Text(ModeloDispositivos.emparejado(dispositivo)).estilo(Self.meta).foregroundStyle(Palco.text3)
        }
    }

    private var boton: some View {
        let titulo = tipo == .este ? OpcionesDispositivo.botonOlvidar(armado: armado) : OpcionesDispositivo.botonRevocar(armado: armado)
        let etiqueta = tipo == .este
            ? OpcionesDispositivo.etiquetaOlvidar(armado: armado)
            : OpcionesDispositivo.etiquetaRevocar(dispositivo.name, armado: armado)
        return BotonPalco(titulo, variante: armado ? .peligro : .quieto, tamano: .sm, ocupado: ocupado, accion: accion)
            .accessibilityLabel(etiqueta)
            .accessibilityIdentifier(tipo == .este ? IDUI.botonOlvidarEsteIPhone : IDUI.botonRevocar(dispositivo.id))
    }

    private var avisoOlvidar: some View {
        Text(OpcionesDispositivo.avisoOlvidar)
            .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45))
            .foregroundStyle(Palco.text2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 4)
    }

    static let meta = EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.25)
}

/// La pulsación larga de la fila: el menú de la web con la puerta única de menús (`menuContextual`).
private struct MenuFila: ViewModifier {
    let dispositivo: Device
    let tipo: FilaDispositivo.Tipo
    let armado: Bool
    let accion: () -> Void

    func body(content: Content) -> some View {
        switch tipo {
        case .otro:
            content.menuContextual(OpcionesDispositivo.revocar(armado: armado).map { (o: OpcionMenu) -> AccionMenu in AccionMenu(o, ejecutar: accion) })
                .accessibilityHint(OpcionesDispositivo.titulo(dispositivo.name))
        case .este:
            content.menuContextual(OpcionesDispositivo.olvidar(armado: armado).map { (o: OpcionMenu) -> AccionMenu in AccionMenu(o, ejecutar: accion) })
                .accessibilityHint(OpcionesDispositivo.titulo(dispositivo.name))
        case .revocado, .esteSinBoton:
            content
        }
    }
}
