import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Ni un texto inventado (a8 §3.11.8): cada texto del reproductor y de la sesión de fuentes está, literal, en
   Vectores/textos-web.json, que saca scripts/generar-textos.mjs del TypeScript real (reproductor y fuentes de la web). Las
   plantillas se comprueban con su «{}» y rellenándolas con los mismos datos que la función Swift. */

private struct TextosWeb: Decodable { var textos: [String] }

private let web: Set<String> = {
    guard let datos = try? Vectores.datos("textos-web"),
        let leidos = try? JSONDecoder().decode(TextosWeb.self, from: datos)
    else { return [] }
    return Set(leidos.textos)
}()

/// Rellena los «{}» de una plantilla en orden.
private func rellenar(_ plantilla: String, _ valores: [String]) -> String {
    var salida = ""
    var resto = valores[...]
    var trozos = plantilla.components(separatedBy: "{}")
    let ultimo = trozos.removeLast()
    for trozo in trozos {
        salida += trozo + (resto.popFirst() ?? "")
    }
    return salida + ultimo
}

/// (lo que dice Swift, la plantilla de la web, con qué se rellena).
private let plantillas: [(String, String, [String])] = [
    (TextosReproductor.reconexion("Sin señal suficiente: reintentando", n: 1, max: 3), "{} ({}/{})…",
     ["Sin señal suficiente: reintentando", "1", "3"]),
    (TextosReproductor.motorDeVuelta("DAZN 1"), "Motor de vuelta: reconectando «{}»…", ["DAZN 1"]),
    (TextosReproductor.retrocedido(30), "Retrocedido {} s · pulsa DIRECTO para volver", ["30"]),
    (TextosReproductor.zapping("DAZN 1"), "Zapping: {}", ["DAZN 1"]),
    (TextosReproductor.modoActivado("Estable"), "Modo «{}» activado", ["Estable"]),
    (TextosReproductor.comprobandoFuentes(5), "Comprobando {} fuentes: arranca la primera que funcione…", ["5"]),
    (TextosReproductor.comprobandoProgreso(2, de: 5), "Comprobando fuentes… {}/{}", ["2", "5"]),
    (TextosReproductor.ningunaDaSenal(4),
     "Ninguna de las {} fuentes da señal ahora mismo. Prueba \"Rebuscar\" o pega un Content ID.", ["4"]),
    (TextosReproductor.verificadaArrancando(1), "Fuente {} verificada: arrancando", ["1"]),
    (TextosReproductor.probamosFloja(3), "Ninguna verificada del todo; probamos la fuente {}, que da señal floja", ["3"]),
    (TextosReproductor.saltoInicial(2), "La señal inicial no responde; probamos automáticamente la fuente {}", ["2"]),
    (TextosReproductor.manualConOtras(2, partido: true),
     "Esta señal no responde. Tienes {} {} para este {}: prueba otra en el selector.", ["2", "fuentes más", "partido"]),
    (TextosReproductor.manualSinOtras(partido: false),
     "Esta señal no responde y no quedan más fuentes para este {}. Prueba «Rebuscar» o pega un Content ID.", ["canal"]),
    (TextosReproductor.rebusqueda(6, nuevas: 2, ia: false),
     "Rebúsqueda: {} señales reunidas, {} sin probar antes · comprobándolas…{}", ["6", "2", ""]),
    (TextosReproductor.rebusquedaTerminada(1, ia: true), "Rebúsqueda terminada · {} {}{}",
     ["1", "fuente nueva que funciona", " · revisadas por la IA"]),
    (TextosReproductor.rebusquedaTerminada(0, ia: false), "Rebúsqueda terminada · ninguna fuente nueva funciona{}", [""]),
    (TextosReproductor.verLa(2), "Ver la {}", ["2"]),
    (TextosReproductor.eleccion("M3U · Elcano", id: "0feeabf0888811b8dd55c807eef65f8d85fa4cce"), "{} · {}",
     ["M3U · Elcano", "0feeabf088"]),
    (TextosReproductor.stream("0feeabf0888811b8dd55c807eef65f8d85fa4cce"), "Stream {}", ["0feeabf0"]),
    (TextosReproductor.canal("0feeabf0888811b8dd55c807eef65f8d85fa4cce"), "Canal {}", ["0feeabf0"]),
    (TextosReproductor.enReposo(3, hora: "21:36"),
     "Ninguna de las {} fuentes da señal todavía. {} y arranco la primera que responda.",
     ["3", "Las vuelvo a probar a las 21:36"]),
]

struct TextosTests {
    @Test func elCatalogoDeLaWebEstaCargado() {
        #expect(web.count > 100)
    }

    @Test(arguments: TextosReproductor.fijos)
    func cadaTextoFijoEsDeLaWeb(_ texto: String) {
        #expect(web.contains(texto), "No está en la web: «\(texto)»")
    }

    @Test func lasPlantillasSonLasDeLaWeb() {
        for (swift, plantilla, valores) in plantillas {
            #expect(web.contains(plantilla), "Plantilla que no está en la web: «\(plantilla)»")
            #expect(swift == rellenar(plantilla, valores), "«\(swift)» no es «\(plantilla)» rellenada")
        }
        #expect(web.contains("Las vuelvo a probar en unos minutos"))
        #expect(web.contains("Las vuelvo a probar a las {}"))
        #expect(web.contains("fuentes nuevas que funcionan"))
        #expect(web.contains("fuente más"))
    }

    @Test func losTextosDeLasReglasTambien() {
        let reglas =
            ReglasFuentes.motivosReporte.map(\.texto) + ["Verificada", "Floja", "Sin señal", "Comprobando", "Pendiente"]
            + ["Reportada", "Sin comprobar", "reproduciendo ahora", "probándose en el segundo motor", "Preparando fuentes"]
            + ["Ya está en pantalla", "Ver esta fuente", "Es el canal correcto", "Reportar…", "Buscando señal"]
            + ["En otro dispositivo", "No se pudo abrir", "Reanudar en directo", "Ya en directo", "Ir al directo · "]
        for texto in reglas where !["Verificada", "Floja", "Sin señal", "Comprobando", "Pendiente"].contains(texto) {
            #expect(web.contains(texto), "No está en la web: «\(texto)»")
        }
    }
}
