import Foundation

/// Lo último bueno que se recibió del servidor, con su fecha.
public struct EntradaCache<Valor: Sendable>: Sendable {
    public let valor: Valor
    public let guardadoEn: Date
}

/// Caché local en disco de la agenda, la biblioteca y el arranque.
///
/// Es lo que permite abrir la app en menos de 1 s hasta la agenda aunque la
/// red vaya lenta (§2.1): se pinta lo guardado y se refresca después. Un JSON
/// por clave en `Caches/AceNeo/`, escrito de forma atómica y protegido hasta
/// el primer desbloqueo. Si el sistema lo borra por falta de espacio, no pasa
/// nada: se vuelve a pedir.
public actor DiskCache {
    public enum Clave: String, Sendable, CaseIterable {
        case agenda
        case biblioteca
        case arranque
        case marcadores
        /// Los gustos de fútbol: la agenda abre en «Para ti» sin esperar a la red.
        case preferencias
    }

    private struct Sobre<Valor: Codable>: Codable {
        let version: Int
        let guardadoEn: Date
        let valor: Valor
    }

    /// Sube si cambia el formato de lo guardado: lo anterior se ignora.
    /// 2: la agenda lleva escudos y colores (`homeTeam`, `awayTeam`, `competitionBadge`).
    private static let version = 2

    private let directorio: URL

    public init(directorio: URL? = nil) {
        self.directorio =
            directorio
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AceNeo", isDirectory: true)
    }

    private func fichero(_ clave: Clave) -> URL {
        directorio.appendingPathComponent("\(clave.rawValue).json", isDirectory: false)
    }

    public func guardar<Valor: Codable & Sendable>(_ valor: Valor, en clave: Clave, fecha: Date = .now) throws {
        try FileManager.default.createDirectory(at: directorio, withIntermediateDirectories: true)
        let datos = try JSONEncoder().encode(Sobre(version: Self.version, guardadoEn: fecha, valor: valor))
        try datos.write(to: fichero(clave), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    public func leer<Valor: Codable & Sendable>(_ tipo: Valor.Type, de clave: Clave) -> EntradaCache<Valor>? {
        guard let datos = try? Data(contentsOf: fichero(clave)),
            let sobre = try? JSONDecoder().decode(Sobre<Valor>.self, from: datos),
            sobre.version == Self.version
        else { return nil }
        return EntradaCache(valor: sobre.valor, guardadoEn: sobre.guardadoEn)
    }

    public func borrar(_ clave: Clave) {
        try? FileManager.default.removeItem(at: fichero(clave))
    }

    /// Al desemparejar: no se queda nada del servidor anterior.
    public func borrarTodo() {
        try? FileManager.default.removeItem(at: directorio)
    }
}
