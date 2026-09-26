import SwiftUI

/* Hojas de la app (b-arquitectura §2.4.2, I0→M4): la ÚNICA puerta a `.sheet(` (regla R5). Hojas
   nativas (decisión 5) con el contenido de la web: detents medidos, asa del sistema, fondo opaco
   `Palco.glassSolid` (a1 §6, a2 §9.2), radio 24. La web nunca apila hojas: abrir una sustituye a la
   que haya. Cuerpos de I0 (fase 0.3b); M4 pone los tamaños de a2 §9 y las pruebas (CentroHojasTests). */

enum ContextoPegar: Hashable, Sendable { case libre, partido(id: String) }

struct RefCanal: Hashable, Sendable {
    var hash: String
    var titulo: String
    var coleccion: LibraryCollection?
    var ih: Bool?
    /// La categoría de la fila (Recientes, lista o resultado del motor): «Guardar favorito» la guarda
    /// (`input.category || 'Guardado'`). Aditivo de M5.
    var categoria: String?
    /// Al guardar el favorito, la biblioteca salta a Favoritos (`onFavoriteSaved`, solo desde Canales). Aditivo de M5.
    var alGuardarIrAFavoritos = false
}

enum DetentsHoja: Sendable { case medido, grande, medioYGrande }

enum Hoja: Identifiable, Hashable, Sendable {
    case gustos
    case pegar(ContextoPegar)
    case reportar(hash: String, numero: Int)
    case encontrarCanal
    case guardarFavorito(RefCanal)
    case renombrar(RefCanal)
    case ayuda
    case otroServidor(PairingLink)
    /// Las hojas de muestra de la galería «Sistema» y del banco (P): pasan por esta misma puerta.
    case muestra(HojaMuestra)

    var id: String {
        switch self {
        case .gustos: "gustos"
        case .pegar: "pegar"
        case .reportar(let hash, _): "reportar-\(hash)"
        case .encontrarCanal: "encontrar-canal"
        case .guardarFavorito(let canal): "guardar-favorito-\(canal.hash)"
        case .renombrar(let canal): "renombrar-\(canal.hash)"
        case .ayuda: "ayuda"
        case .otroServidor: "otro-servidor"
        case .muestra(let muestra): "muestra-\(muestra.rawValue)"
        }
    }

    /// Ancho del contenido en ≥ 768 (420 / 560 / 760). Valor neutro de I0; M4 pone el de a2 §9 por hoja.
    var tamano: TamanoHoja {
        switch self {
        case .muestra(let muestra): muestra.tamano
        default: .md
        }
    }

    var detents: DetentsHoja {
        switch self {
        case .gustos, .ayuda, .muestra(.atajos): .grande
        case .encontrarCanal: .medioYGrande
        default: .medido
        }
    }
}

@MainActor @Observable final class CentroHojas {
    var actual: Hoja?
    @ObservationIgnored private var cerrandoConBoton = false

    /// Sustituye a la que haya (la web nunca apila hojas).
    func abrir(_ hoja: Hoja) {
        cerrandoConBoton = false
        actual = hoja
    }

    /// ✕, «Cancelar» o fin de una acción.
    func cerrar() {
        guard actual != nil else { return }
        cerrandoConBoton = true
        actual = nil
    }

    /// onDismiss: true si se cerró arrastrando (→ háptica media, a1 §8.1).
    func alDescartar() -> Bool {
        let arrastrando = !cerrandoConBoton
        cerrandoConBoton = false
        return arrastrando
    }
}

/// Qué pinta cada hoja. Los contenidos son de los módulos (stubs de I0).
struct VistaHoja: View {
    let hoja: Hoja
    var body: some View {
        switch hoja {
        case .gustos: ContenidoGustos()  // M5
        case .pegar(let contexto): ContenidoPegar(contexto: contexto)  // M5
        case .reportar(let hash, let numero): ContenidoReportar(hash: hash, numero: numero)  // M6
        case .encontrarCanal: ContenidoEncontrarCanal()  // M6
        case .guardarFavorito(let canal): ContenidoGuardarFavorito(canal: canal)  // M5
        case .renombrar(let canal): ContenidoRenombrar(canal: canal)  // M5
        case .ayuda: ContenidoAyuda()  // M7
        case .otroServidor(let enlace): ContenidoOtroServidor(enlace: enlace)  // M7
        case .muestra(let muestra): ContenidoHojaMuestra(muestra: muestra)  // P (galería y banco)
        }
    }
}

extension View {
    /// El ÚNICO `.sheet(` de la app (en AppShell y en PantallaEmparejar): detents medidos (.height) o .large o
    /// [.medium, .large], asa visible, fondo opaco Palco.glassSolid, radio 24, contenido desplazable.
    func hojasDeLaApp(_ centro: CentroHojas) -> some View { modifier(ModificadorHojas(centro: centro)) }
}

private struct ModificadorHojas: ViewModifier {
    @Bindable var centro: CentroHojas
    @Environment(Haptica.self) private var haptica
    @State private var altoMedido: CGFloat = 320

    func body(content: Content) -> some View {
        content.sheet(item: $centro.actual, onDismiss: alCerrar) { hoja in
            VistaHoja(hoja: hoja)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { altoMedido = $0 }
                .presentationDetents(detents(hoja.detents))
                .presentationDragIndicator(.visible)
                .presentationBackground(Palco.glassSolid)
                .presentationCornerRadius(24)
                .presentationContentInteraction(.scrolls)
        }
    }

    private func alCerrar() {
        if centro.alDescartar() { haptica.disparar(.media) }
    }

    private func detents(_ d: DetentsHoja) -> Set<PresentationDetent> {
        switch d {
        case .medido: [.height(altoMedido)]
        case .grande: [.large]
        case .medioYGrande: [.medium, .large]
        }
    }
}
