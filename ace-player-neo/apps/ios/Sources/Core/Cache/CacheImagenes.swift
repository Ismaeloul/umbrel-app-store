import CryptoKit
import Foundation
import UIKit

/// Memoria de imágenes ya decodificadas (`NSCache` es segura entre hilos):
/// se lee de forma síncrona desde las vistas para pintar al instante.
public final class MemoriaImagenes: @unchecked Sendable {
    private let cache = NSCache<NSString, UIImage>()

    public init(limite: Int = 24 << 20) {
        cache.totalCostLimit = limite
    }

    public func leer(_ clave: String) -> UIImage? {
        cache.object(forKey: clave as NSString)
    }

    public func guardar(_ imagen: UIImage, clave: String) {
        let coste = Int(imagen.size.width * imagen.size.height * imagen.scale * imagen.scale * 4)
        cache.setObject(imagen, forKey: clave as NSString, cost: coste)
    }

    public func vaciar() {
        cache.removeAllObjects()
    }
}

/// Escudos y logos sin parpadeo: memoria, disco (`Caches/AceNeo/imagenes/<sha256>.png`,
/// escritura atómica) y red, con las peticiones repetidas de una misma URL
/// unidas en una sola. Las URL de los escudos llevan `?v=<etag>`, así que
/// una imagen guardada no caduca: si cambia, cambia la URL. Además, el
/// `URLCache` de la sesión hace `If-None-Match`/`ETag` con el servidor.
public actor CacheImagenes {
    /// Cómo se pide una URL (la app le pone el `Authorization: Bearer`).
    public typealias Peticion = @Sendable (URL) async throws -> URLRequest

    public nonisolated let memoria: MemoriaImagenes
    private let session: URLSession
    private let peticion: Peticion
    private let directorio: URL
    private var enCurso: [String: Task<UIImage?, Never>] = [:]

    public init(
        session: URLSession, directorio: URL? = nil, memoria: MemoriaImagenes = MemoriaImagenes(),
        peticion: @escaping Peticion
    ) {
        self.session = session
        self.peticion = peticion
        self.memoria = memoria
        self.directorio =
            directorio
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AceNeo", isDirectory: true)
            .appendingPathComponent("imagenes", isDirectory: true)
    }

    /// Clave de una URL: solo ruta y consulta (la misma imagen por la red local y por Tailscale).
    public nonisolated static func clave(_ url: URL) -> String {
        let texto = url.path() + "?" + (url.query() ?? "")
        let resumen = SHA256.hash(data: Data(texto.utf8))
        return resumen.map { String(format: "%02x", $0) }.joined()
    }

    /// Lo que ya está en memoria, sin esperar (para pintar al instante).
    public nonisolated func enMemoria(_ url: URL) -> UIImage? {
        memoria.leer(Self.clave(url))
    }

    /// La imagen, de memoria, disco o red (nil si no se pudo).
    public func imagen(para url: URL) async -> UIImage? {
        let clave = Self.clave(url)
        if let ya = memoria.leer(clave) { return ya }
        if let tarea = enCurso[clave] { return await tarea.value }
        let tarea = Task<UIImage?, Never> { [session, peticion, directorio] in
            let fichero = directorio.appendingPathComponent("\(clave).png", isDirectory: false)
            if let datos = try? Data(contentsOf: fichero), let imagen = UIImage(data: datos) {
                return await CacheImagenes.preparada(imagen)
            }
            do {
                let solicitud = try await peticion(url)
                let (datos, respuesta) = try await session.data(for: solicitud)
                guard let http = respuesta as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                    let imagen = UIImage(data: datos)
                else { return nil }
                try? FileManager.default.createDirectory(at: directorio, withIntermediateDirectories: true)
                try? datos.write(to: fichero, options: [.atomic])
                return await CacheImagenes.preparada(imagen)
            } catch {
                return nil
            }
        }
        enCurso[clave] = tarea
        let resultado = await tarea.value
        enCurso[clave] = nil
        if let resultado { memoria.guardar(resultado, clave: clave) }
        return resultado
    }

    /// Decodificada fuera del hilo principal antes de pintarla (a8 §3.7): el primer pintado no da tirón.
    private static func preparada(_ imagen: UIImage) async -> UIImage {
        await imagen.byPreparingForDisplay() ?? imagen
    }

    /// Pide varias sin esperar (los escudos de los partidos del día).
    public func precalentar(_ urls: [URL]) {
        for url in urls where memoria.leer(Self.clave(url)) == nil {
            Task { _ = await self.imagen(para: url) }
        }
    }

    /// Cuántas peticiones hay en vuelo (para los tests).
    public var peticionesEnCurso: Int { enCurso.count }

    /// Vacía memoria y disco (al desemparejar).
    public func borrarTodo() {
        memoria.vaciar()
        enCurso = [:]
        try? FileManager.default.removeItem(at: directorio)
    }
}
