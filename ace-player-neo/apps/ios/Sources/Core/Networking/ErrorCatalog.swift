// GENERADO por scripts/generar-catalogo-errores.mjs desde
// packages/shared/src/errors.ts. No lo edites a mano: cambia el catálogo
// común y vuelve a generarlo (la CI de iOS comprueba que está al día).

import Foundation

/// Definición de un código del catálogo común de errores (arquitectura §6.4).
public struct ErrorDefinition: Sendable, Equatable {
    /// HTTP con el que responde /api/v1.
    public let status: Int
    /// Si /api/v1 lo enseña tal cual (los internos no deberían llegar nunca).
    public let isPublic: Bool
    /// Texto en español para enseñárselo a Isma tal cual.
    public let message: String
}

/// Catálogo de códigos de error con sus mensajes en español (87 códigos).
public enum ErrorCatalog {
    public static let entries: [String: ErrorDefinition] = [
        "bad_request": ErrorDefinition(status: 400, isPublic: true, message: "La petición no es válida."),
        "bad_json": ErrorDefinition(status: 400, isPublic: true, message: "El cuerpo de la petición no es un JSON válido."),
        "validation_error": ErrorDefinition(status: 400, isPublic: true, message: "Falta algún dato o no tiene el formato esperado."),
        "body_too_large": ErrorDefinition(status: 413, isPublic: true, message: "La petición es demasiado grande (máximo 2 MiB)."),
        "not_found": ErrorDefinition(status: 404, isPublic: true, message: "Esa dirección no existe."),
        "method_not_allowed": ErrorDefinition(status: 405, isPublic: true, message: "Esa dirección no admite este método."),
        "cross_origin": ErrorDefinition(status: 403, isPublic: true, message: "Se ha bloqueado una petición que venía de otra web."),
        "internal_error": ErrorDefinition(status: 500, isPublic: true, message: "Algo ha fallado en el servidor. Queda anotado en el registro."),
        "not_implemented": ErrorDefinition(status: 501, isPublic: true, message: "Esta función todavía no está disponible en esta versión."),
        "unauthorized": ErrorDefinition(status: 401, isPublic: true, message: "Este dispositivo no está emparejado o su acceso ha caducado. Vuelve a emparejarlo."),
        "device_revoked": ErrorDefinition(status: 401, isPublic: true, message: "Se ha retirado el acceso de este dispositivo. Vuelve a emparejarlo desde la web."),
        "origin_forbidden": ErrorDefinition(status: 403, isPublic: true, message: "Esta función no está disponible desde aquí."),
        "video_token_invalid": ErrorDefinition(status: 401, isPublic: true, message: "El enlace del vídeo ha caducado. Vuelve a abrir el canal."),
        "pairing_invalid": ErrorDefinition(status: 401, isPublic: true, message: "El código no es correcto. Revísalo en la web y vuelve a intentarlo."),
        "pairing_expired": ErrorDefinition(status: 410, isPublic: true, message: "El código ha caducado o ya se ha usado. Pide uno nuevo en la web."),
        "pairing_rate_limited": ErrorDefinition(status: 429, isPublic: true, message: "Demasiados intentos. Espera un minuto y vuelve a probar."),
        "device_not_found": ErrorDefinition(status: 404, isPublic: true, message: "Ese dispositivo no existe."),
        "rate_limited": ErrorDefinition(status: 429, isPublic: true, message: "Demasiadas peticiones seguidas. Espera un momento."),
        "session_expired": ErrorDefinition(status: 410, isPublic: true, message: "La sesión de este canal ha terminado. Vuelve a abrirlo."),
        "session_not_found": ErrorDefinition(status: 404, isPublic: true, message: "Esa sesión de reproducción no existe."),
        "handoff_denied": ErrorDefinition(status: 409, isPublic: true, message: "Otro dispositivo tiene el mando y no se ha podido pasar a este."),
        "source_no_peers": ErrorDefinition(status: 504, isPublic: true, message: "Esta señal no tiene pares ahora mismo. Prueba otra fuente."),
        "engine_timeout": ErrorDefinition(status: 504, isPublic: true, message: "El motor AceStream no ha respondido a tiempo."),
        "ffmpeg_missing": ErrorDefinition(status: 501, isPublic: true, message: "Falta ffmpeg en el servidor: no se puede preparar el vídeo para el iPhone."),
        "engine_unavailable": ErrorDefinition(status: 503, isPublic: true, message: "El motor AceStream no responde. Si sigue así, reinícialo desde Ajustes."),
        "engine_bad_response": ErrorDefinition(status: 502, isPublic: true, message: "El motor AceStream ha dado una respuesta que no se entiende."),
        "ace_timeout": ErrorDefinition(status: 504, isPublic: true, message: "El motor AceStream tarda demasiado en responder."),
        "restart_cooldown": ErrorDefinition(status: 429, isPublic: true, message: "El motor se acaba de reiniciar. Espera unos segundos antes de volver a intentarlo."),
        "restart_failed": ErrorDefinition(status: 502, isPublic: true, message: "No se pudo reiniciar el motor."),
        "remux_busy": ErrorDefinition(status: 503, isPublic: true, message: "Hay demasiados vídeos preparándose para iPhone a la vez. Cierra alguno y reintenta."),
        "remux_died": ErrorDefinition(status: 502, isPublic: true, message: "La conversión del vídeo para iPhone se ha detenido. Vuelve a intentarlo."),
        "remux_timeout": ErrorDefinition(status: 504, isPublic: true, message: "El vídeo para iPhone no ha llegado a tiempo. La señal va lenta."),
        "bad_action": ErrorDefinition(status: 400, isPublic: true, message: "Esa acción sobre la biblioteca no existe."),
        "bad_collection": ErrorDefinition(status: 400, isPublic: true, message: "Esa colección de la biblioteca no existe."),
        "bad_title": ErrorDefinition(status: 400, isPublic: true, message: "El nombre no puede quedar vacío."),
        "source_not_found": ErrorDefinition(status: 404, isPublic: true, message: "Ese directorio ya no existe."),
        "source_limit": ErrorDefinition(status: 409, isPublic: true, message: "Ya tienes 8 directorios. Elimina uno antes de añadir otro."),
        "last_source": ErrorDefinition(status: 409, isPublic: true, message: "Debe quedar al menos un directorio guardado."),
        "empty_directory": ErrorDefinition(status: 422, isPublic: true, message: "La fuente respondió, pero no contenía enlaces AceStream válidos."),
        "bad_url": ErrorDefinition(status: 400, isPublic: true, message: "La dirección no es válida: tiene que empezar por http:// o https://."),
        "private_url": ErrorDefinition(status: 400, isPublic: true, message: "Por seguridad, las direcciones de tu red local están bloqueadas. Usa una lista publicada en internet."),
        "dns_failed": ErrorDefinition(status: 502, isPublic: true, message: "No se pudo resolver el dominio de esa fuente."),
        "fetch_timeout": ErrorDefinition(status: 504, isPublic: true, message: "La fuente no respondió a tiempo."),
        "fetch_failed": ErrorDefinition(status: 502, isPublic: true, message: "No se pudo descargar la lista."),
        "redirect_limit": ErrorDefinition(status: 502, isPublic: true, message: "La fuente entra en un bucle o encadena demasiadas redirecciones."),
        "redirect_loop": ErrorDefinition(status: 502, isPublic: true, message: "La fuente entra en un bucle o encadena demasiadas redirecciones."),
        "response_too_large": ErrorDefinition(status: 502, isPublic: true, message: "La lista es demasiado grande (máximo 2 MiB)."),
        "unsupported_encoding": ErrorDefinition(status: 502, isPublic: true, message: "La fuente envía la lista comprimida de una forma que no se admite."),
        "ipfs_not_found": ErrorDefinition(status: 502, isPublic: true, message: "Esa ruta ya no existe en IPFS."),
        "ipfs_bad_cid": ErrorDefinition(status: 502, isPublic: true, message: "La red IPFS no entregó la lista. Vuelve a intentarlo en un rato."),
        "ipfs_bad_block": ErrorDefinition(status: 502, isPublic: true, message: "La red IPFS no entregó la lista. Vuelve a intentarlo en un rato."),
        "ipfs_bad_data": ErrorDefinition(status: 502, isPublic: true, message: "La red IPFS no entregó la lista. Vuelve a intentarlo en un rato."),
        "ipfs_bad_record": ErrorDefinition(status: 502, isPublic: true, message: "La red IPFS no entregó la lista. Vuelve a intentarlo en un rato."),
        "ipfs_hamt_unsupported": ErrorDefinition(status: 502, isPublic: true, message: "La red IPFS no entregó la lista. Vuelve a intentarlo en un rato."),
        "ipfs_missing_block": ErrorDefinition(status: 502, isPublic: true, message: "La red IPFS no entregó la lista. Vuelve a intentarlo en un rato."),
        "ipfs_not_file": ErrorDefinition(status: 502, isPublic: true, message: "La red IPFS no entregó la lista. Vuelve a intentarlo en un rato."),
        "ipfs_unsupported_codec": ErrorDefinition(status: 502, isPublic: true, message: "La red IPFS no entregó la lista. Vuelve a intentarlo en un rato."),
        "ipfs_unsupported_hash": ErrorDefinition(status: 502, isPublic: true, message: "La red IPFS no entregó la lista. Vuelve a intentarlo en un rato."),
        "football_unavailable": ErrorDefinition(status: 502, isPublic: true, message: "No se pudo cargar la agenda de partidos. Vuelve a intentarlo en un rato."),
        "channel_required": ErrorDefinition(status: 400, isPublic: true, message: "Este partido no anuncia ningún canal."),
        "bad_binding": ErrorDefinition(status: 400, isPublic: true, message: "Hace falta un canal y un ID AceStream válido para vincularlos."),
        "scan_not_found": ErrorDefinition(status: 404, isPublic: true, message: "Esa comprobación de fuentes ya no existe. Vuelve a buscar el canal."),
        "bad_outcome": ErrorDefinition(status: 400, isPublic: true, message: "El resultado de la reproducción no es válido."),
        "bad_feedback": ErrorDefinition(status: 400, isPublic: true, message: "La corrección no es válida."),
        "empty_query": ErrorDefinition(status: 400, isPublic: true, message: "Escribe al menos 2 letras para buscar."),
        "state_unreadable": ErrorDefinition(status: 500, isPublic: false, message: "No se pudo leer el estado guardado."),
        "scanner_unavailable": ErrorDefinition(status: 502, isPublic: false, message: "El comprobador no responde."),
        "scanner_timeout": ErrorDefinition(status: 504, isPublic: false, message: "El comprobador tarda demasiado."),
        "scanner_session_failed": ErrorDefinition(status: 502, isPublic: false, message: "El comprobador no pudo abrir la señal."),
        "scanner_bad_response": ErrorDefinition(status: 502, isPublic: false, message: "El comprobador dio una respuesta que no se entiende."),
        "scanner_response_too_large": ErrorDefinition(status: 502, isPublic: false, message: "El comprobador dio una respuesta demasiado grande."),
        "epg_unavailable": ErrorDefinition(status: 502, isPublic: false, message: "La EPG de Movistar+ no responde."),
        "epg_bad_response": ErrorDefinition(status: 502, isPublic: false, message: "La EPG de Movistar+ dio una respuesta que no se entiende."),
        "epg_empty": ErrorDefinition(status: 502, isPublic: false, message: "La EPG de Movistar+ no trae partidos."),
        "fltv_empty": ErrorDefinition(status: 502, isPublic: false, message: "futbolenlatv no trae partidos."),
        "ollama_unavailable": ErrorDefinition(status: 502, isPublic: false, message: "La IA local no responde."),
        "ollama_timeout": ErrorDefinition(status: 504, isPublic: false, message: "La IA local tarda demasiado."),
        "ollama_bad_response": ErrorDefinition(status: 502, isPublic: false, message: "La IA local dio una respuesta que no se entiende."),
        "ollama_response_too_large": ErrorDefinition(status: 502, isPublic: false, message: "La IA local dio una respuesta demasiado grande."),
        "restart_timeout": ErrorDefinition(status: 504, isPublic: false, message: "engine_control no respondió a tiempo."),
        "not_file": ErrorDefinition(status: 404, isPublic: false, message: "No es un fichero."),
        "engine_stalled": ErrorDefinition(status: 503, isPublic: false, message: "El motor responde pero no entrega vídeo a quien está viendo."),
        "engine_auto_restart": ErrorDefinition(status: 503, isPublic: false, message: "El motor no respondía con alguien esperando y se ha reiniciado solo."),
        "engine_auto_restart_exhausted": ErrorDefinition(status: 503, isPublic: false, message: "El motor ya se ha reiniciado solo 3 veces en la última hora; no se reinicia más."),
        "engine_not_ready": ErrorDefinition(status: 503, isPublic: false, message: "El motor no ha vuelto a responder a tiempo después de reiniciarse."),
        "engine_stop_failed": ErrorDefinition(status: 502, isPublic: false, message: "El motor no ha confirmado el cierre de una sesión."),
        "scanner_session_leak": ErrorDefinition(status: 502, isPublic: false, message: "El comprobador puede haber dejado sesiones abiertas en su motor."),
    ]
}
