import Foundation

// b-arquitectura §1.13.2: la única puerta a los datos de prueba, en Xcode y en Linux.

/// Ejemplos de @ace/shared (packages/shared/fixtures).
enum Fixtures {
    static func datos(_ ruta: String) throws -> Data { try Data(contentsOf: raiz.appendingPathComponent(ruta)) }

    /// Nombres (sin `.json`) de los ejemplos de una carpeta.
    static func nombres(_ carpeta: String) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: raiz.appendingPathComponent(carpeta).path)
            .filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }.sorted()
    }

    #if SWIFT_PACKAGE
        /// apps/ios/Tests/AceNeoTests/Puros/Soporte/Fixtures.swift → ace-player-neo/packages/shared/fixtures
        /// (siete niveles: el fichero, Soporte, Puros, AceNeoTests, Tests, ios y apps).
        static var raiz: URL {
            var url = URL(fileURLWithPath: #filePath)
            for _ in 0..<7 { url.deleteLastPathComponent() }
            return url.appendingPathComponent("packages/shared/fixtures")
        }
    #else
        static var raiz: URL {
            guard let url = Bundle(for: MarcaBundle.self).url(forResource: "fixtures", withExtension: nil) else {
                fatalError("La carpeta fixtures no está en el bundle de los tests (revisa project.yml)")
            }
            return url
        }
    #endif
}

/// Vectores y golden generados (Tests/AceNeoTests/Vectores).
enum Vectores {
    static func datos(_ nombre: String) throws -> Data {
        #if SWIFT_PACKAGE
            guard let recursos = Bundle.module.resourceURL else { throw CocoaError(.fileNoSuchFile) }
            let base = recursos.appendingPathComponent("Vectores")
            for sub in ["", "demo"] {
                let url = base.appendingPathComponent(sub).appendingPathComponent(nombre + ".json")
                if FileManager.default.fileExists(atPath: url.path) { return try Data(contentsOf: url) }
            }
            throw CocoaError(.fileNoSuchFile)
        #else
            guard let url = Bundle(for: MarcaBundle.self).url(forResource: nombre, withExtension: "json") else {
                throw CocoaError(.fileNoSuchFile)
            }
            return try Data(contentsOf: url)
        #endif
    }
}

#if !SWIFT_PACKAGE
    private final class MarcaBundle {}
#endif
