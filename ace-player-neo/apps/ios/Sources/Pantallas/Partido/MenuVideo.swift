import SwiftUI

/* «Opciones del reproductor» (a4 §5.6): el MISMO menú en ⋯ «Más opciones», en la pulsación larga del vídeo y
   en las acciones de VoiceOver. En táctil, sin las teclas. Orden, peligro, ✓ y háptica de player/index.tsx
   (`allMenuItems`) y de a4 §5.7. Abrir el menú no vibra. */

extension EntornoVideo {
    /// Las 14 opciones (o menos, según zapping, pantalla completa y PiP).
    func accionesMenu() -> [AccionMenu] {
        guard let canal = reproductor.canal else { return [] }
        let foto = self.foto
        var acciones: [AccionMenu] = accionesReproduccion(foto)
        let zapea = puedeZapear
        if zapea {
            acciones.append(
                AccionMenu(OpcionMenu(id: "anterior", titulo: "Canal anterior", icono: .chevL, separadaAntes: true)) {
                    zapping(-1)
                })
            acciones.append(AccionMenu(OpcionMenu(id: "siguiente", titulo: "Canal siguiente", icono: .chevR)) { zapping(1) })
        }
        acciones.append(contentsOf: accionesVista(separarDatos: !zapea))
        acciones.append(contentsOf: accionesFuera(canal))
        return acciones
    }

    private func accionesReproduccion(_ foto: FotoEscenario) -> [AccionMenu] {
        let pausa = OpcionMenu(
            id: "pausa", titulo: foto.quiereSonar ? "Pausar" : "Reproducir", icono: foto.quiereSonar ? .pause : .play)
        let atras = OpcionMenu(
            id: "atras", titulo: "Retroceder 30 s", icono: .back, deshabilitada: !foto.puedeRetroceder)
        return [
            AccionMenu(pausa) { alternar() },
            AccionMenu(atras) { retroceder() },
            AccionMenu(OpcionMenu(id: "directo", titulo: "Ir al directo", icono: .directo)) { irAlDirecto() },
            AccionMenu(OpcionMenu(id: "detener", titulo: "Detener", icono: .stop, peligro: true)) { detener() },
        ]
    }

    private func accionesVista(separarDatos: Bool) -> [AccionMenu] {
        let datosAbiertos = presentacion.datosTecnicosAbiertos
        var acciones: [AccionMenu] = [
            AccionMenu(
                OpcionMenu(
                    id: "nerd", titulo: "Datos técnicos", icono: .nerd, marcada: datosAbiertos,
                    separadaAntes: separarDatos)
            ) { alternarDatosTecnicos() },
            AccionMenu(OpcionMenu(id: "donde", titulo: "Dónde se está reproduciendo", icono: .tv)) { abrirDonde() },
            AccionMenu(OpcionMenu(id: "completa", titulo: "Pantalla completa", icono: .full)) {
                alternarPantallaCompleta()
            },
        ]
        if pip.soportado {
            acciones.append(AccionMenu(OpcionMenu(id: "pip", titulo: "Imagen dentro de imagen", icono: .pip)) { alternarPiP() })
        }
        return acciones
    }

    private func accionesFuera(_ canal: CanalReproducible) -> [AccionMenu] {
        let hash = canal.id
        let hashValido = hash.count == 40 && hash.allSatisfy { $0.isHexDigit && !$0.isUppercase }
        return [
            AccionMenu(
                OpcionMenu(id: "abrir", titulo: "Abrir en la app de AceStream", icono: .externo, separadaAntes: true)
            ) { abrirEnAceStream(hash) },
            AccionMenu(OpcionMenu(id: "url", titulo: "Copiar URL del stream (VLC)", icono: .link)) {
                copiarURLStream(hash, infohash: canal.ih == true)
            },
            AccionMenu(OpcionMenu(id: "enlace", titulo: "Copiar enlace acestream://", icono: .copy)) {
                copiar("acestream://\(hash)", bien: "Enlace acestream:// copiado", mal: "No se pudo copiar")
            },
            AccionMenu(OpcionMenu(id: "hash", titulo: "Copiar hash", icono: .hash, deshabilitada: !hashValido)) {
                copiar(hash, bien: "Hash copiado", mal: "No se pudo copiar el hash")
            },
        ]
    }
}
