import SwiftUI

/// Lista de la agenda por días, con tirar para actualizar y estados de carga,
/// vacío y error.
struct AgendaView: View {
    @State private var vm: AgendaViewModel

    init(entorno: Entorno) {
        _vm = State(initialValue: AgendaViewModel(entorno: entorno))
    }

    var body: some View {
        NavigationStack {
            contenido
                .navigationTitle("Agenda")
                .background(Tinta.fondo.ignoresSafeArea())
                .scrollContentBackground(.hidden)
                .refreshable { await vm.refrescar() }
                .task { await vm.arrancar() }
                .overlay(alignment: .bottom) { avisoSinConexion }
                .animation(Muelle.estandar, value: vm.fallo)
        }
    }

    @ViewBuilder private var contenido: some View {
        if vm.agenda == nil && vm.cargando {
            List {
                ForEach(0..<6, id: \.self) { _ in
                    FilaPartido(partido: .muestra)
                }
            }
            .redacted(reason: .placeholder)
            .disabled(true)
            .accessibilityLabel("Cargando la agenda")
        } else if vm.agenda == nil, let fallo = vm.fallo {
            ContentUnavailableView {
                Label("No se puede cargar la agenda", systemImage: "wifi.exclamationmark")
            } description: {
                Text(fallo)
            } actions: {
                Button("Reintentar") { Task { await vm.refrescar() } }
                    .buttonStyle(.borderedProminent)
            }
        } else if vm.dias.isEmpty {
            ContentUnavailableView(
                "No hay partidos", systemImage: "sportscourt",
                description: Text("La agenda está vacía. Tira hacia abajo para actualizar."))
        } else {
            List {
                ForEach(vm.dias) { dia in
                    Section {
                        ForEach(dia.matches) { partido in
                            FilaPartido(partido: partido)
                                .listRowBackground(Tinta.superficie)
                        }
                    } header: {
                        Text(FormatoAgenda.etiqueta(dia: dia.date))
                            .font(.headline)
                            .foregroundStyle(Tinta.texto)
                            .textCase(nil)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .accessibilityIdentifier("lista-agenda")
        }
    }

    /// Píldora de cristal cuando se está enseñando la agenda guardada sin red.
    @ViewBuilder private var avisoSinConexion: some View {
        if vm.agenda != nil, vm.fallo != nil {
            HStack(spacing: 8) {
                Image(systemName: "icloud.slash")
                if let fecha = vm.actualizadaEn {
                    Text("Sin conexión · agenda de hace \(fecha, style: .relative)")
                } else {
                    Text("Sin conexión")
                }
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(Tinta.texto)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .cristal()
            .padding(.bottom, 12)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityIdentifier("aviso-sin-conexion")
        }
    }
}

/// Una fila de partido: hora grande a la izquierda, equipos y canales.
struct FilaPartido: View {
    let partido: FootballMatch

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(partido.time)
                .font(.numeros(.title3))
                .foregroundStyle(Tinta.acentoTinta)
                .frame(minWidth: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                Text(FormatoAgenda.equipos(partido))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Tinta.texto)
                Text(FormatoAgenda.detalle(partido))
                    .font(.footnote)
                    .foregroundStyle(Tinta.texto2)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: Medida.toque)
        .accessibilityElement(children: .combine)
    }
}

extension FootballMatch {
    /// Partido de relleno para el esqueleto de carga.
    static let muestra = FootballMatch(
        id: "muestra", date: "2026-01-01", time: "21:00", start: nil, title: "Equipo local - Equipo visitante",
        home: "Equipo local", away: "Equipo visitante", competition: "Competición", country: "",
        channels: [FootballChannelRef(id: "canal", name: "Canal")])
}
