import Foundation

/* El nombre que pinta una fila de canal (M5). Las listas de Isma («NEW ERA», «Elcano»…) ponen el proveedor en el
   título de cada canal («DAZN 1 FHD --> NEW ERA»). Si ese proveedor ya se lee encima (la lista activa, la cabecera
   de la categoría) o en la propia fila (la categoría como subtítulo), la fila enseña SOLO el nombre del canal
   («DAZN 1 FHD»): Isma lo pidió así, repetirlo abajo no sirve de nada. Si el proveedor no se lee en ningún otro
   sitio, el título se queda entero (dos «DAZN 1» de dos proveedores no se confunden). Puro. */

extension ReglasBiblioteca {
    /// `titulo` sin « --> proveedor» cuando alguno de `yaSeLee` nombra ese proveedor; si no, tal cual.
    static func nombreFila(_ titulo: String, yaSeLee: [String]) -> String {
        let clave = claveProveedor(ReglasFuentes.proveedor(titulo))
        guard !clave.isEmpty else { return titulo }
        let repetido = yaSeLee.contains { (texto: String) -> Bool in claveProveedor(texto).contains(clave) }
        guard repetido else { return titulo }
        let canal = ReglasFuentes.parteCanal(titulo)
        return canal.isEmpty ? titulo : canal
    }

    /// Solo letras y cifras, sin mayúsculas ni tildes: «EL CANO», «Elcano» y «Directorio de Elcano» casan.
    static func claveProveedor(_ texto: String) -> String {
        let plano = texto.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        var salida = String.UnicodeScalarView()
        for escalar in plano.unicodeScalars where CharacterSet.alphanumerics.contains(escalar) {
            salida.append(escalar)
        }
        return String(salida)
    }
}
