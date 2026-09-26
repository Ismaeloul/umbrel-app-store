import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* classifySwipe (lib/gestures.ts) con sus vectores, el soltar del borde (a2 §27.4), el mini
   (MiniPlayer.tsx) y la tabla de sitios hápticos (a1 §8.1 con las correcciones de §0.3). */

struct GestosTests {
    @Test func clasificarComoClassifySwipe() {
        for caso in VectoresComunes.lote.gestos {
            // La web mide px/ms sobre el mayor de los dos recorridos: velocidad = recorrido / ms × 1000.
            let ms = max(caso.ms, 1)
            let eje: EjeDeslizar = caso.eje == "x" ? .horizontal : (caso.eje == "y" ? .vertical : .ambos)
            let resultado = Deslizamiento.clasificar(
                dx: caso.dx, dy: caso.dy, vx: caso.dx / ms * 1000, vy: caso.dy / ms * 1000, eje: eje, umbral: caso.umbral)
            let esperado: ResultadoDeslizar =
                switch caso.resultado {
                case "left": .izquierda
                case "right": .derecha
                case "up": .arriba
                case "down": .abajo
                default: .ninguno
                }
            #expect(resultado == esperado, "classifySwipe(\(caso.dx), \(caso.dy), \(caso.ms), \(caso.eje), \(caso.umbral))")
        }
    }

    @Test func contratoSinEjeMiraLosDos() {
        #expect(Deslizamiento.clasificar(dx: 0, dy: -60, vx: 0, vy: 0) == .arriba)
        #expect(Deslizamiento.clasificar(dx: 60, dy: 0, vx: 0, vy: 0) == .derecha)
        #expect(Deslizamiento.clasificar(dx: 30, dy: 0, vx: 500, vy: 0) == .derecha)
        #expect(Deslizamiento.clasificar(dx: 20, dy: 0, vx: 2000, vy: 0) == .ninguno)
        #expect(Deslizamiento.clasificar(dx: 60, dy: 50, vx: 0, vy: 0) == .ninguno, "ningún eje domina")
    }

    @Test func volverDesdeElBorde() {
        #expect(Volver.decide(dx: 136.5, vx: 0, ancho: 390))
        #expect(!Volver.decide(dx: 136, vx: 0, ancho: 390))
        #expect(Volver.decide(dx: 24, vx: 450, ancho: 390))
        #expect(!Volver.decide(dx: 23, vx: 900, ancho: 390))
        #expect(!Volver.decide(dx: 100, vx: 449, ancho: 390))
    }

    @Test func miniComoMiniPlayer() {
        #expect(GestosMini.soltar(dx: 0, dy: -72, vx: 0, vy: 0, ancho: 366) == .abrir)
        #expect(GestosMini.soltar(dx: 72, dy: 0, vx: 0, vy: 0, ancho: 366) == .descartar)
        #expect(GestosMini.soltar(dx: -80, dy: 10, vx: 0, vy: 0, ancho: 366) == .descartar)
        #expect(GestosMini.soltar(dx: 0, dy: 120, vx: 0, vy: 0, ancho: 366) == .volver, "abajo está la barra")
        #expect(GestosMini.soltar(dx: 60, dy: 0, vx: 0, vy: 0, ancho: 366) == .volver)
        #expect(GestosMini.soltar(dx: 30, dy: 0, vx: 600, vy: 0, ancho: 366) == .descartar, "rápido cuenta con ≥ 24")
        #expect(GestosMini.pasado(dx: 72, dy: 10) && !GestosMini.pasado(dx: 71, dy: 0) && !GestosMini.pasado(dx: 80, dy: 90))
        let arrastre = GestosMini.arrastre(dx: 160, dy: 40)
        #expect(arrastre.x == 160 && arrastre.y == 10 && arrastre.opacidad == 0.5)
        #expect(GestosMini.arrastre(dx: 400, dy: -30).opacidad == 0.35)
        #expect(GestosMini.arrastre(dx: 0, dy: -30).y == -30)
    }
}

struct SitiosHapticosTests {
    @Test func cadaSitioTieneFila() {
        for sitio in SitioHaptico.allCases {
            let fila = SitiosHapticos.fila(sitio)
            #expect(!fila.donde.isEmpty, "\(sitio)")
            #expect((fila.tipo == nil) == (fila.origen == .ninguno), "\(sitio): sin tipo ⇔ ninguno")
        }
    }

    @Test func correccionesDeLaArquitectura() {
        // §0.3: la pulsación larga (menú contextual) no lanza nada propio: vibra el menú del sistema.
        for sitio in [SitioHaptico.agendaMenuPartido, .canalesMenuFila, .fuenteMenuCartel, .reproductorMenuVideo,
                      .dispositivosMenuFila, .galeriaPulsacionLarga] {
            #expect(sitio.tipo == nil, "\(sitio)")
        }
    }

    @Test func algunasFilasDeA1() {
        #expect(SitioHaptico.barraCambiarDestino.tipo == .seleccion && SitioHaptico.barraCambiarDestino.origen == .anadido)
        #expect(SitioHaptico.hojaCerrarArrastrando.tipo == .media)
        #expect(SitioHaptico.miniUmbralDescartar.tipo == .fuerte)
        #expect(SitioHaptico.fuenteCambioAutomatico.tipo == .aviso)
        #expect(SitioHaptico.fuenteFallaManual.tipo == .error)
        #expect(SitioHaptico.fuenteElegir.tipo == .rigida && SitioHaptico.reproductorDetener.tipo == .rigida)
        #expect(SitioHaptico.escenarioGol.tipo == .exito && SitioHaptico.emparejarHecho.tipo == .exito)
        #expect(SitioHaptico.agendaAbrirPartido.tipo == .ligera && SitioHaptico.miniAbrirTocando.tipo == nil)
    }
}
