import Foundation

/* Los equipos de un partido listos para Palco, con las reglas de M2 (`Equipos`, lib/teams.ts: `teamPalette`,
   `teamShort`, `teamCrest`, `competitionLogo`) y la URL simbólica de M1 para las imágenes del servidor
   (`RutaImagen`: `CacheImagenes` la cambia por la dirección que responda ahora, casa o Tailscale). */

extension DatosEquipo {
    /// El equipo de un lado: sus colores (API o tono del nombre), sus siglas y su escudo de mismo origen.
    static func de(_ partido: FootballMatch, _ lado: LadoPartido) -> DatosEquipo {
        let paleta: PaletaEquipo = Equipos.paleta(partido, lado)
        let gris = RGB(r: 0.5, g: 0.5, b: 0.5)
        return DatosEquipo(
            nombre: Equipos.nombre(partido, lado), siglas: Equipos.siglas(partido, lado),
            primario: ColorOKLab.desdeHex(paleta.primario) ?? gris, secundario: ColorOKLab.desdeHex(paleta.secundario),
            escudo: RutaImagen.url(Equipos.escudo(partido, lado)), halo: nil)
    }
}

enum ImagenesPartido {
    /// El logo de la competición (`competitionLogo`), por la misma puerta que los escudos.
    static func logoCompeticion(_ partido: FootballMatch) -> URL? {
        RutaImagen.url(Equipos.logoCompeticion(partido))
    }
}
