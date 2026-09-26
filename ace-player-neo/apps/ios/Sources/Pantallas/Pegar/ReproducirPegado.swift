import Foundation

/* Reproducir un Content ID pegado o detectado (M5; a5 §4.4, §5; PasteHashSheet.tsx y SearchView.tsx): háptica
   de éxito, sin apuntarlo en Recientes (origen «manual») ni vincularlo a un partido; el título es el tuyo si
   ya lo tienes o «Stream {8}», el tipo el tuyo o `auto`; al teatro del canal y el aviso de la web. */

@MainActor
struct ReproducirPegado {
    let datos: DatosApp
    let reproductor: Reproductor
    let navegador: Navegador
    let avisos: Avisos
    let haptica: Haptica

    func reproducir(_ hash: String) {
        let conocido = ReglasBiblioteca.conocido(datos.biblioteca.datos, hash: hash)
        haptica.disparar(.exito)
        let canal = CanalReproducible(
            id: hash, titulo: ModeloBusqueda.tituloPegado(hash, conocido: conocido?.title), ih: conocido?.ih,
            origen: "manual")
        reproductor.reproducir(canal)
        navegador.ir(.canal(hash: hash))
        avisos.avisar(
            conocido == nil ? TextosPegar.reproduciendoExterno : TextosPegar.reproduciendoConocido, tono: .ok, icono: .play)
    }
}
