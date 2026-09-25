import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Reglas del selector de fuentes: los casos de apps/web/src/features/sources/model.test.ts portados uno a uno
   (mismos datos, mismas salidas), más la regla D6 del iPhone. */

private let ahora = FechaISO.parse("2026-09-23T18:30:00.000Z") ?? Date(timeIntervalSince1970: 0)

private func hash(_ n: Int) -> String {
    let hex = String(n, radix: 16)
    return String(repeating: "0", count: 40 - hex.count) + hex
}

private func candidata(
    _ n: Int, titulo: String? = nil, fuente: CandidateSource = .m3u, listaId: String? = "principal",
    disponibilidad: Double? = nil, reportada: ResolutionCandidate.Reported? = nil, enCuarentena: Bool = false
) -> ResolutionCandidate {
    ResolutionCandidate(
        id: hash(n), title: titulo ?? "M+ Liga de Campeones --> Prov\(n)", alias: nil, ih: false, source: fuente,
        score: 100, matchedChannel: "M+ Liga de Campeones", soloFamilia: false, familyFallbackAllowed: false,
        listaId: listaId, availability: disponibilidad, bitrate: nil, learned: nil, reported: reportada,
        rejectedByLearning: false, quarantined: enCuarentena, semantic: nil, semanticSimilarity: nil)
}

private func prueba(
    _ n: Int, _ estado: ScanCandidateState, pares: Double = 0, rateKbps: Double? = nil, intakeKbps: Double? = nil,
    streamKbps: Double = 0, motivo: String = "", codec: String = "", reintento: String? = nil,
    dondeSeVe: PlayableOn? = nil
) -> ScanCandidate {
    ScanCandidate(
        id: hash(n), state: estado, checkedAt: nil, retryAt: reintento, durationMs: 0, bytes: 0, peers: pares,
        speedDown: 0, rateKbps: rateKbps, intakeKbps: intakeKbps, streamKbps: streamKbps, reason: motivo,
        mediaValid: false, browserCompatible: false, videoCodec: codec, audioCodecs: [], cached: false, attempts: 0,
        playableOn: dondeSeVe)
}

/// `scanned(states)` de la web: entradas del servidor con el comprobador configurado y aplicado.
private func comprobadas(_ estados: [ScanCandidateState]) -> [EntradaFuente] {
    let entradas = ReglasFuentes.empezarComprobacion(
        estados.indices.map { EntradaFuente(candidata($0 + 1), ahora: ahora) }, inicial: 3)
    return ReglasFuentes.aplicarComprobacion(
        entradas, candidatos: estados.enumerated().map { prueba($0.offset + 1, $0.element) })
}

private func efectos(_ entradas: [EntradaFuente], pantalla: EnPantalla = .nada) -> [String: Efectivo] {
    ReglasFuentes.efectivos(entradas, pantalla: pantalla, ahora: ahora)
}

private let listas = [
    WebSourceSummary(
        id: "principal", name: "Directorio de Elcano", url: "https://example.com/l.m3u", type: .m3u, count: 1,
        syncedAt: nil, lastErrorAt: nil, lastError: nil)
]

struct PresentacionFuenteTests {
    @Test func elProveedorEsLoQueVaTrasLaFlecha() {
        #expect(ReglasFuentes.proveedor("M+ Liga de Campeones --> Elcano") == "Elcano")
        #expect(ReglasFuentes.proveedor("DAZN 1 → Faro") == "Faro")
        #expect(ReglasFuentes.proveedor("LaLiga => Norte") == "Norte")
        #expect(ReglasFuentes.proveedor("LaLiga -> Sur") == "Sur")
        #expect(ReglasFuentes.proveedor("DAZN 1").isEmpty)
        #expect(ReglasFuentes.parteCanal("M+ Liga de Campeones --> Elcano") == "M+ Liga de Campeones")
    }

    @Test func nombreCortoProveedorListaOTipo() {
        let conProveedor = ReglasFuentes.presentacion(EntradaFuente(candidata(1), ahora: ahora), listas: listas)
        #expect(conProveedor.tipo == "M3U" && conProveedor.corto == "Prov1" && conProveedor.etiqueta == "M3U · Prov1")
        let llana = ReglasFuentes.presentacion(EntradaFuente(candidata(2, titulo: "DAZN 1"), ahora: ahora), listas: listas)
        #expect(llana.corto == "Elcano" && llana.etiqueta == "M3U · Elcano")
        let pelada = EntradaFuente(candidata(3, titulo: "DAZN 1", fuente: .saved, listaId: nil), ahora: ahora)
        #expect(ReglasFuentes.presentacion(pelada, listas: listas).corto == "Guardada")
        #expect(ReglasFuentes.presentacion(.manual(id: hash(9), titulo: "Stream", canal: ""), listas: []).corto == "Externa")
    }

    @Test func unTipoDeFuenteNuevoSePresentaComoFuente() {
        // Un origen que el servidor añada después (p. ej. IPTV) llega como «desconocido»: «Fuente», como la web.
        let nueva = EntradaFuente(candidata(4, titulo: "Canal", fuente: .desconocido, listaId: nil), ahora: ahora)
        #expect(ReglasFuentes.presentacion(nueva, listas: []).tipo == "Fuente")
    }

    @Test func laDisponibilidadSeLeeComoPorcentaje() {
        #expect(ReglasFuentes.porcentaje(0.91) == 91)
        #expect(ReglasFuentes.porcentaje(42) == 42)
        #expect(ReglasFuentes.porcentaje(nil) == nil)
        #expect(ReglasFuentes.porcentaje(180) == 100)
    }

    @Test func descripcionConTodosLosDatos() {
        let entradas = ReglasFuentes.aplicarComprobacion(
            ReglasFuentes.empezarComprobacion([EntradaFuente(candidata(1), ahora: ahora)], inicial: 3),
            candidatos: [prueba(1, .working, pares: 48, intakeKbps: 6200, streamKbps: 4800, motivo: "playable_media")])
        let entrada = entradas[0]
        let efectivo = ReglasFuentes.efectivo(entrada, pantalla: .nada, ahora: ahora)
        let presentacion = ReglasFuentes.presentacion(entrada, listas: [])
        let texto = ReglasFuentes.describir(
            entrada, numero: 1, efectivo: efectivo, presentacion: presentacion, conComprobador: true)
        #expect(texto.hasPrefix("Fuente 1:"))
        #expect(texto.contains("Hash \(hash(1))"))
        #expect(texto.contains("48 pares en la prueba"))
        #expect(texto.contains("6,2 Mbit/s del enjambre para un canal de 4,8"))
        let suelta = ReglasFuentes.describir(
            entrada, numero: 1, efectivo: efectivo, presentacion: presentacion, conComprobador: false)
        #expect(suelta.contains("Disponibilidad sin medir"))
    }

    @Test func etiquetasDeLaResolucion() {
        #expect(ReglasFuentes.etiquetaOrigenResolucion("saved") == "Asociación guardada")
        #expect(ReglasFuentes.etiquetaOrigenResolucion("raro") == "Fuente disponible")
        #expect(ReglasFuentes.etiquetaRevisado("ai-programming") == "IA")
        #expect(ReglasFuentes.etiquetaRevisado("history") == "Recientes")
    }

    @Test func calidadPorBitrateYHEVC() {
        func con(_ p: ScanCandidate) -> SondaFuente { SondaFuente(p) }
        #expect(ReglasFuentes.calidad(nil) == nil)
        #expect(ReglasFuentes.calidad(con(prueba(1, .working))) == nil)
        #expect(ReglasFuentes.calidad(con(prueba(1, .working, rateKbps: 3800))) == "1080p")
        #expect(ReglasFuentes.calidad(con(prueba(1, .working, rateKbps: 2400))) == "720p")
        #expect(ReglasFuentes.calidad(con(prueba(1, .working, rateKbps: 900))) == "SD")
        #expect(ReglasFuentes.calidad(con(prueba(1, .working, streamKbps: 4800))) == "1080p")
        #expect(ReglasFuentes.calidad(con(prueba(1, .working, rateKbps: 1200, streamKbps: 4800))) == "SD")
        #expect(ReglasFuentes.calidad(con(prueba(1, .working, streamKbps: 4800, codec: "hevc"))) == "1080p · HEVC")
        #expect(ReglasFuentes.calidad(con(prueba(1, .working, streamKbps: 4800, codec: "h264"))) == "1080p")
        #expect(ReglasFuentes.calidad(con(prueba(1, .working, codec: "H.265"))) == "HEVC")
    }

    @Test func laTeselaLlevaElNombreDelCanal() {
        #expect(ReglasFuentes.nombreCanal(EntradaFuente(candidata(1), ahora: ahora)) == "M+ Liga de Campeones")
        let suelta = EntradaFuente(id: "x", titulo: "Canal suelto", ih: false, origen: "m3u", canal: "")
        #expect(ReglasFuentes.nombreCanal(suelta) == "Canal suelto")
    }

    @Test func listaSinDirectorio() {
        #expect(ReglasFuentes.nombreLista("principal", listas: listas) == "Elcano")
        #expect(ReglasFuentes.nombreLista(nil, listas: listas).isEmpty)
    }
}

struct EstadoEfectivoTests {
    @Test func reproduciendoEnPantallaEsVerificada() {
        let entrada = comprobadas([.failed])[0]
        let efectivo = ReglasFuentes.efectivo(entrada, pantalla: EnPantalla(id: hash(1), sonando: true, conectando: false), ahora: ahora)
        #expect(efectivo.estado == .working && efectivo.motivo == "player")
        #expect(ReglasFuentes.detalle(efectivo, entrada) == "reproduciendo ahora")
    }

    @Test func laQueSeConectaEsComprobando() {
        let entrada = comprobadas([.failed])[0]
        let efectivo = ReglasFuentes.efectivo(
            entrada, pantalla: EnPantalla(id: hash(1), sonando: false, conectando: true), ahora: ahora)
        #expect(efectivo.estado == .checking && efectivo.motivo == "player_check")
        let senal = ReglasFuentes.senal(efectivo, entrada)
        #expect(senal.estado == .checking && senal.palabra == "Comprobando")
    }

    @Test func loQueVioElReproductorMandaTresMinutos() {
        var entrada = comprobadas([.working])[0]
        entrada.veredicto = VeredictoReproductor(estado: .failed, motivo: "player_failed", fecha: ahora)
        let casi = ahora.addingTimeInterval(ReglasFuentes.vigenciaVeredicto - 0.001)
        let pasado = ahora.addingTimeInterval(ReglasFuentes.vigenciaVeredicto)
        #expect(ReglasFuentes.efectivo(entrada, pantalla: .nada, ahora: casi).estado == .failed)
        #expect(ReglasFuentes.efectivo(entrada, pantalla: .nada, ahora: pasado).estado == .working)
    }

    @Test func unaReportadaMandaSobreTodo() {
        var entrada = comprobadas([.working])[0]
        entrada.reportadaHasta = ahora.addingTimeInterval(1)
        entrada.motivoReporte = .wrongChannel
        let efectivo = ReglasFuentes.efectivo(
            entrada, pantalla: EnPantalla(id: hash(1), sonando: true, conectando: false), ahora: ahora)
        #expect(efectivo.reportada)
        let senal = ReglasFuentes.senal(efectivo, entrada)
        #expect(senal.estado == .fail && senal.palabra == "Reportada")
        #expect(ReglasFuentes.detalle(efectivo, entrada) == "apartada por tu reporte (canal incorrecto)")
        #expect(!ReglasFuentes.efectivo(entrada, pantalla: .nada, ahora: ahora.addingTimeInterval(2)).reportada)
    }

    @Test func laQueYaVeniaReportadaSaleMarcada() {
        let fin = ahora.addingTimeInterval(60)
        let reportada = EntradaFuente(
            candidata(
                1,
                reportada: ResolutionCandidate.Reported(
                    reason: .wrongChannel, state: .failed, quarantineUntil: FechaISO.texto(fin))), ahora: ahora)
        #expect(reportada.motivoReporte == .wrongChannel)
        #expect(abs((reportada.reportadaHasta ?? .distantPast).timeIntervalSince(fin)) < 0.001)
        let enCuarentena = EntradaFuente(candidata(2, enCuarentena: true), ahora: ahora)
        #expect(enCuarentena.motivoReporte == .notStarting)
        #expect(enCuarentena.reportadaHasta == ahora.addingTimeInterval(30 * 60))
        let vencida = EntradaFuente(
            candidata(
                3,
                reportada: ResolutionCandidate.Reported(
                    reason: .audio, state: .working, quarantineUntil: FechaISO.texto(ahora.addingTimeInterval(-1)))),
            ahora: ahora)
        #expect(vencida.reportadaHasta == nil)
    }

    @Test func frasesDeLaPruebaYReintentoConSuHora() {
        let entrada = ReglasFuentes.aplicarComprobacion(
            ReglasFuentes.empezarComprobacion([EntradaFuente(candidata(1), ahora: ahora)], inicial: 3),
            candidatos: [prueba(1, .failed, motivo: "timeout", reintento: "2026-09-23T18:16:00.000Z")])[0]
        #expect(
            ReglasFuentes.detalle(ReglasFuentes.efectivo(entrada, pantalla: .nada, ahora: ahora), entrada)
                == "sin señal; reintento a las 20:16")
        let frases = [
            "unsupported_codec": "vídeo no compatible",
            "starved": "llega menos señal de la que el canal necesita",
            "player_dropped": "se cortó en el reproductor",
            "player_ok": "funcionó en el reproductor",
            "intermittent": "intermitente: falló la última prueba",
            "unverified_media": "señal detectada · vídeo sin confirmar",
        ]
        for (motivo, frase) in frases {
            #expect(ReglasFuentes.detalle(Efectivo(estado: .weak, motivo: motivo, reportada: false), entrada) == frase)
        }
        #expect(ReglasFuentes.detalle(Efectivo(estado: .queued, motivo: "", reportada: false), entrada) == "en cola")
    }

    @Test func sinComprobadorLaDisponibilidad() {
        let rica = EntradaFuente(candidata(1, disponibilidad: 0.72), ahora: ahora)
        let pobre = EntradaFuente(candidata(2, disponibilidad: 0.2), ahora: ahora)
        let nada = EntradaFuente(candidata(3), ahora: ahora)
        func senal(_ e: EntradaFuente) -> (estado: EstadoSenal, palabra: String) {
            ReglasFuentes.senal(ReglasFuentes.efectivo(e, pantalla: .nada, ahora: ahora), e)
        }
        #expect(senal(rica).estado == .ok && senal(rica).palabra == "72% disponible")
        #expect(senal(pobre).estado == .weak)
        #expect(senal(nada).estado == .pending && senal(nada).palabra == "Sin comprobar")
    }

    @Test func enPantallaSoloConCanalYSinParar() {
        #expect(EnPantalla(fase: .reproduciendo, id: hash(1), arranco: true) == EnPantalla(id: hash(1), sonando: true, conectando: false))
        #expect(EnPantalla(fase: .cargando, id: hash(1), arranco: false).conectando)
        #expect(EnPantalla(fase: .error, id: hash(1), arranco: false).id == nil)
    }

    @Test func d6DelIPhoneUnaQueSoloFallaPorElCodecEnLaWebEsVerificada() {
        let sonda = SondaFuente(prueba(1, .failed, motivo: "unsupported_codec", dondeSeVe: PlayableOn(web: false, ios: true)))
        #expect(sonda.estado == .working)
        let noSeVe = SondaFuente(prueba(1, .failed, motivo: "unsupported_codec", dondeSeVe: PlayableOn(web: false, ios: false)))
        #expect(noSeVe.estado == .failed)
    }
}

struct QueSeVeYQueArrancaTests {
    @Test func conComprobadorLaActivaLasVivasYLasInicialesSinProbar() {
        let entradas = comprobadas([.failed, .queued, .working, .queued, .weak, .failed])
        let e = efectos(entradas)
        let vistas = entradas.filter { ReglasFuentes.visibleMientrasComprueba($0, efectivo: e[$0.id]!, activa: nil) }
        #expect(vistas.map(\.id) == [hash(2), hash(3), hash(5)])
        #expect(ReglasFuentes.visibleMientrasComprueba(entradas[0], efectivo: e[hash(1)]!, activa: hash(1)))
    }

    @Test func vista60sYCortadaEsFloja() {
        let floja = ReglasFuentes.veredictoFallo(.cayo, segundos: 75)
        #expect(floja.0 == .weak && floja.1 == "player_dropped")
        let corta = ReglasFuentes.veredictoFallo(.cayo, segundos: 20)
        #expect(corta.0 == .failed && corta.1 == "player_failed")
        #expect(ReglasFuentes.veredictoFallo(.fallo, segundos: 0).0 == .failed)
    }

    @Test func arranqueAutomaticoLaPrimeraVerificadaYLaFlojaSoloAlTerminar() {
        let entradas = comprobadas([.failed, .weak, .working, .working])
        #expect(ReglasFuentes.elegirAutomatica(entradas, efectivos: efectos(entradas), terminado: false)?.id == hash(3))
        let soloFloja = comprobadas([.failed, .weak, .checking])
        #expect(ReglasFuentes.elegirAutomatica(soloFloja, efectivos: efectos(soloFloja), terminado: false) == nil)
        #expect(ReglasFuentes.elegirAutomatica(soloFloja, efectivos: efectos(soloFloja), terminado: true)?.id == hash(2))
    }

    @Test func nuncaRepiteUnaProbadaNiUnaReportada() {
        var entradas = comprobadas([.working, .working, .working])
        entradas[0].probadaAuto = true
        entradas[1].reportadaHasta = ahora.addingTimeInterval(1e6)
        entradas[1].motivoReporte = .audio
        #expect(ReglasFuentes.elegirAutomatica(entradas, efectivos: efectos(entradas), terminado: true)?.id == hash(3))
    }

    @Test func saltoDeEntrada() {
        let entradas = comprobadas([.failed, .queued, .weak])
        #expect(ReglasFuentes.elegirSaltoInicial(entradas, activa: hash(1), pantalla: .nada, ahora: ahora)?.id == hash(3))
        let viendola = EnPantalla(id: hash(1), sonando: true, conectando: false)
        #expect(ReglasFuentes.elegirSaltoInicial(entradas, activa: hash(1), pantalla: viendola, ahora: ahora) == nil)
        #expect(
            ReglasFuentes.elegirSaltoInicial(comprobadas([.working, .weak]), activa: hash(1), pantalla: .nada, ahora: ahora)
                == nil)
    }

    @Test func empezarYOlvidarLaComprobacion() {
        let entradas = ReglasFuentes.empezarComprobacion(
            [1, 2, 3, 4].map { EntradaFuente(candidata($0), ahora: ahora) }, inicial: 2)
        #expect(entradas.map(\.inicial) == [true, true, false, false])
        #expect(entradas.allSatisfy { $0.sonda?.estado == .queued })
        #expect(ReglasFuentes.olvidarComprobacion(entradas).allSatisfy { $0.sonda == nil && !$0.inicial })
    }

    @Test func unVeredictoPorSSECambiaLaFuenteAlMomento() {
        let entradas = comprobadas([.checking, .queued])
        let veredicto = ScanVerdictData(
            jobId: "j", hash: hash(2), state: .working, reason: "playable_media", by: .scanner, checkedAt: "",
            playableOn: nil)
        let siguientes = ReglasFuentes.aplicarVeredicto(entradas, veredicto)
        #expect(siguientes[1].sonda?.estado == .working)
        #expect(siguientes[0] == entradas[0])
    }

    @Test func sinDuplicadosConservaElOrdenYElIdEsOpaco() {
        let a = EntradaFuente(id: "iptv:canal-1", titulo: "A", ih: nil, origen: "desconocido", canal: "")
        let b = EntradaFuente(id: "IPTV:CANAL-1", titulo: "B", ih: nil, origen: "desconocido", canal: "")
        #expect(ReglasFuentes.sinDuplicados([a, b, a]).map(\.titulo) == ["A", "B"])
    }
}

struct ProgresoYReportesTests {
    private let entradas = comprobadas([.working, .weak, .failed, .queued])

    private func vista(_ estado: ScanJobStatus, comprobadas: Int = 3, total: Int = 4) -> EstadoComprobador {
        EstadoComprobador(id: "j", estado: estado, total: total, comprobadas: comprobadas, jugables: 2, reintentoEn: nil)
    }

    @Test func textosSegunElEstado() {
        let e = efectos(entradas)
        #expect(ReglasFuentes.textoProgreso(nil, entradas: [], efectivos: e, precalentado: nil) == "Preparando fuentes")
        #expect(
            ReglasFuentes.textoProgreso(vista(.complete), entradas: entradas, efectivos: e, precalentado: nil)
                == "2 verificadas · 4 comprobadas")
        #expect(
            ReglasFuentes.textoProgreso(vista(.waiting), entradas: entradas, efectivos: e, precalentado: nil)
                == "2 verificadas · fallidas en reposo")
        #expect(
            ReglasFuentes.textoProgreso(vista(.running), entradas: entradas, efectivos: e, precalentado: nil)
                == "3/4 · buscando señales vivas")
        let una = comprobadas([.working])
        #expect(
            ReglasFuentes.textoProgreso(vista(.complete, total: 1), entradas: una, efectivos: efectos(una), precalentado: nil)
                == "1 verificada · 1 comprobada")
        #expect(
            ReglasFuentes.textoProgreso(nil, entradas: entradas, efectivos: e, precalentado: nil)
                == "4 fuentes disponibles")
        let precalentado = PreheatPublic(
            matchId: "x", stage: .scan, status: .ready, updatedAt: nil, candidateCount: 6, checked: 6, playable: 2,
            total: 6, error: "")
        #expect(
            ReglasFuentes.textoProgreso(nil, entradas: entradas, efectivos: e, precalentado: precalentado)
                == "6 fuentes precalentadas")
    }

    @Test func laBarraNuncaBajaDel4PorCiento() {
        #expect(ReglasFuentes.progreso(vista(.running, comprobadas: 0), entradas: entradas.count) == 0.04)
        #expect(ReglasFuentes.progreso(vista(.running, comprobadas: 2), entradas: entradas.count) == 0.5)
        #expect(ReglasFuentes.progreso(nil, entradas: entradas.count) == 0)
        #expect(ReglasFuentes.comprobadorTerminado(vista(.waiting)))
        #expect(!ReglasFuentes.comprobadorTerminado(vista(.running)))
        #expect(ReglasFuentes.comprobadorTerminado(nil))
    }

    @Test func seguimientoDelReporte() {
        let vuelve = ReglasFuentes.seguimientoReporte(.notStarting, estado: .working)
        #expect(!vuelve.sigueApartada && vuelve.texto == "El segundo motor confirma que la fuente vuelve a funcionar")
        let apartada = ReglasFuentes.seguimientoReporte(.stuttering, estado: .weak)
        #expect(apartada.sigueApartada && apartada.texto == "La señal está viva, pero queda apartada por tu reporte")
        let muerta = ReglasFuentes.seguimientoReporte(.notStarting, estado: .failed)
        #expect(muerta.sigueApartada && muerta.texto == "El segundo motor confirma que esta fuente no entrega señal")
        #expect(muerta.tono == .err)
    }
}

struct HermanasYHashTests {
    private func item(_ n: Int, _ titulo: String, _ tipo: ItemType = .web) -> Item {
        Item(
            id: hash(n), title: titulo, alias: nil, type: tipo, category: "Deportes", date: "2026-09-23T18:30:00.000Z",
            fromWebSync: true, ih: false)
    }

    @Test func soloLasDelMismoCanalSinRepetir() {
        let biblioteca = LibraryView(
            web: [item(1, "DAZN 1 HD"), item(2, "DAZN 1 FHD"), item(3, "DAZN 2"), item(4, "Eurosport")],
            webSyncedAt: nil, webSources: [], activeWebSourceId: "principal",
            favorites: [item(1, "DAZN 1 HD", .fav)], history: [item(5, "DAZN 1", .recent)])
        #expect(ReglasFuentes.hermanas(biblioteca, id: hash(1)).map(\.id) == [hash(1), hash(2), hash(5)])
        #expect(ReglasFuentes.hermanas(biblioteca, id: hash(9)).isEmpty)
    }

    @Test func delDirectorioSeLeeComoM3UDeLaListaActiva() {
        let web = EntradaFuente(item(1, "DAZN 1"), listaActiva: "principal")
        #expect(web.origen == "m3u" && web.listaId == "principal")
        let favorito = EntradaFuente(item(1, "DAZN 1", .fav), listaActiva: "principal")
        #expect(favorito.origen == "favorites" && favorito.listaId == nil)
    }

    @Test func normalizarHashComoLaWeb() {
        let h = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
        #expect(ReglasFuentes.normalizarHash("acestream://\(h.uppercased())") == h)
        #expect(ReglasFuentes.normalizarHash("http://x.local/ace/getstream?id=\(h)") == h)
        #expect(ReglasFuentes.normalizarHash("mira esto: \(h) ya") == h)
        #expect(ReglasFuentes.normalizarHash("no hay hash") == nil)
    }
}
