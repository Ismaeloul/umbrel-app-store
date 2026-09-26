import SwiftUI

/* Hoja «¿Qué fútbol te mueve?» (M5; a3 §13; PreferencesSheet.tsx) con el contenido de la web dentro de la hoja
   nativa: «TU AGENDA» y la entradilla, las tres secciones numeradas (chips de 44 que se marcan en oro, «Añadir
   otro…»), la nota y la botonera «Cancelar» / «Guardar y ver mi agenda». Nada se guarda hasta «Guardar…». */

struct ContenidoGustos: View {
    @Environment(DatosApp.self) private var datos
    @Environment(CentroHojas.self) private var hojas
    @Environment(Avisos.self) private var avisos
    @Environment(Haptica.self) private var haptica
    @Environment(\.modoDemo) private var modoDemo
    @State private var borrador = GustosFutbol.vacios
    @State private var base: Date?
    @State private var tocado = false
    @State private var guardando = false
    @State private var fallo = false

    var body: some View {
        ContenidoHoja(titulo: "¿Qué fútbol te mueve?", tamano: .lg, alCerrar: { hojas.cerrar() }) {
            VStack(alignment: .leading, spacing: 0) {
                descripcion.padding(.top, -14)  // .sheet__description: 2 20 0 (el cuerpo trae 16)
                ScrollView {
                    VStack(alignment: .leading, spacing: 32) {
                        ForEach(TipoGusto.allCases) { tipo in
                            SeccionGustos(tipo: tipo, borrador: borrador, deshabilitado: guardando) { nuevo in
                                tocado = true
                                borrador = nuevo
                            }
                        }
                        nota
                    }
                    .padding(.top, 16)
                    .padding(.bottom, 4)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
            }
        } pie: {
            BotonPalco("Cancelar", variante: .quieto) { hojas.cerrar() }.disabled(guardando)
            BotonPalco("Guardar y ver mi agenda", ocupado: guardando, accion: guardar)
        }
        .accessibilityIdentifier(IDUI.hojaGustos)
        .onAppear(perform: partirDeLoGuardado)
        .onChange(of: datos.preferencias.actualizadaEn) { _, _ in if !tocado { partirDeLoGuardado() } }
    }

    private var descripcion: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Tu agenda")
                .estilo(EstiloTexto(tamano: 13, peso: 760, trackingEm: 0.14, altoLinea: 1.45, mayusculas: true))
                .foregroundStyle(Palco.accentInk)
            Text("Elige tus competiciones, equipos y nacionalidades. Los usaremos para ordenar la agenda; siempre podrás ver todos los partidos.")
                .estilo(.cuerpo)
                .foregroundStyle(Palco.text2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// La nota: dónde se guarda, o el error (alerta).
    private var nota: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        let texto: String
        if fallo {
            texto = "No pudimos guardar tus gustos. Puedes cerrar y reintentarlo luego."
        } else if modoDemo {
            texto = "En la demo se guardan únicamente en este navegador."
        } else {
            texto = "Tus gustos se guardan en Ace Player Neo y se comparten entre tus dispositivos."
        }
        return Text(texto)
            .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
            .foregroundStyle(fallo ? Palco.failInk : Palco.text2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 12)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palco.bgSunk, in: forma)
            .overlay { if fallo { forma.strokeBorder(Palco.fail.opacity(0.45), lineWidth: 1) } }
    }

    /// Al abrir, el borrador parte de lo guardado; si cambia fuera y aún no has tocado nada, se pone al día.
    private func partirDeLoGuardado() {
        borrador = ModeloGustos.borrador(datos.preferencias.datos?.preferences)
        base = datos.preferencias.actualizadaEn
    }

    private func guardar() {
        fallo = false
        guardando = true
        let cuerpo = ModeloGustos.cuerpo(datos.preferencias.datos?.preferences, borrador)
        Task {
            defer { guardando = false }
            do {
                try await datos.guardarPreferencias(cuerpo)
                let guardadas = datos.preferencias.datos?.preferences
                let hay = guardadas.map { ParaTi.tieneGustos(GustosFutbol($0)) } ?? ModeloGustos.hayAlguno(borrador)
                haptica.disparar(.exito)
                avisos.avisar(
                    hay ? "Tu agenda ya está personalizada" : "Puedes personalizar tu agenda cuando quieras", tono: .ok,
                    icono: .check)
                hojas.cerrar()
            } catch {
                fallo = true
            }
        }
    }
}
