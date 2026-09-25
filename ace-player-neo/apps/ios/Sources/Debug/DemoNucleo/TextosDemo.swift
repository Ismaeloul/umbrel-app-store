#if DEBUG
    import Foundation

    /* Las marcas de la demo (a7 §5.1 y §13.13), literales de la web, para que las pantallas las pinten igual
       que `?demo=1` cuando la app corre con `-AceNeoDemo` (solo Debug: en Release no existen). El único texto
       que cambia respecto a la web es la nota de los gustos («…en este iPhone.», decidido en a7 §5.1). */

    enum TextosDemo {
        /// Toast de arranque (info, 4 s): api/boot.ts.
        static let toastArranque = "Modo demo: sin backend, canales de muestra cargados"
        /// Duración de ese toast (api/boot.ts).
        static let duracionToastArranque = 4.0
        /// Cabecera de cada vista en lugar del indicador del motor (a2 §6.4).
        static let etiquetaCabecera = "Modo demo"
        /// Ajustes → Motor: settings/SettingsView.tsx.
        static let motor = "Motor en línea (demo)"
        /// Tras la versión en Acerca de: settings/SettingsView.tsx.
        static let sufijoVersion = " · modo demo"
        /// Tras «Todo funciona.» en Salud: health/HealthSection.tsx.
        static let sufijoSalud = " (demo)"
        /// Último trozo del pie de Canales (`libraryFooter`, library/model.ts), unido con « · ».
        static let pieCanales = "demo"
        /// Nota de la hoja de gustos (la web dice «…en este navegador.», preferences/PreferencesSheet.tsx).
        static let notaGustos = "En la demo se guardan únicamente en este iPhone."
        /// «Dónde se está reproduciendo»: where-playing/WherePlayingSection.tsx.
        static let donde = "En la demo es un ejemplo: un ordenador y un iPhone viendo el mismo canal."
        /// Bajo el QR de Dispositivos: devices/PairingPanel.tsx.
        static let pieQR = "QR de muestra (demo)"
        /// Motor en «Datos técnicos»: player/NerdPanel.tsx.
        static let motorDatosTecnicos = "en línea (demo)"
        /// Acciones de listas que no existen en demo (409 `demo_unsupported`): directories/model.ts.
        static let accionNoDisponible = "En modo demo no hay backend: esta acción funcionará en el Umbrel."
        /// El canal de muestra que «no responde» (título con «caíd»): player/engines/demo.ts.
        static let senalNoResponde = "La señal de muestra no responde; buscando una alternativa"
        /// PiP en demo: player/index.tsx.
        static let pipSinVideo = "PiP necesita un vídeo real (en demo no hay señal)"
        /// Rótulo bajo el título en la imagen de demo: player/PlayerSurface.tsx.
        static let rotuloImagen = "reproducción simulada — en el Umbrel verías el stream real"
        /// «Hay señal» a los 1,8 s (DEMO_SIGNAL_MS de player/constants.ts).
        static let senalMs = 1800.0

        /// Todos los textos que se enseñan (para `RedaccionTests`).
        static let todos: [String] = [
            toastArranque, etiquetaCabecera, motor, sufijoVersion, sufijoSalud, pieCanales, notaGustos, donde, pieQR,
            motorDatosTecnicos, accionNoDisponible, senalNoResponde, pipSinVideo, rotuloImagen,
        ]
    }
#endif
