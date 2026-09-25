// swift-tools-version: 6.2
// Espejo SwiftPM «NucleoPuro» (b-arquitectura §1.13.2): compila EN SU SITIO los ficheros
// puros [L] de la app (solo Foundation) y sus pruebas de Tests/AceNeoTests/Puros, para
// probarlos en Linux (Docker en el PC: scripts/probar-linux.ps1; trabajo nucleo-linux en la CI).
// XcodeGen no lo ve: la app se compila siempre con AceNeo.xcodeproj.
// Solo I0 y el integrador lo tocan. Cuando llegue un fichero [L] nuevo fuera de las carpetas
// de abajo (Player/TiposReproduccion.swift, App/MigracionClaves.swift, Debug/DemoNucleo),
// se añade a `sources`.
import PackageDescription

let package = Package(
    name: "NucleoPuro",
    platforms: [.iOS(.v26), .macOS(.v26)],  // coherente con la app; Linux lo ignora
    products: [.library(name: "NucleoPuro", targets: ["NucleoPuro"])],
    targets: [
        .target(
            name: "NucleoPuro",
            path: "Sources",
            sources: [
                "Core/Models",
                "Core/Dominio",
                "Core/Reglas",
                "Core/Networking/Endpoint.swift",
                "Core/Networking/APIError.swift",
                "Core/Networking/ErrorCatalog.swift",
                "Core/Networking/PlazosWeb.generado.swift",
                "Core/Networking/RutaID.generado.swift",
                "Core/Networking/SSEParser.swift",
                "Core/Auth/Servidores.swift",
                "Player/MaquinaConexion.swift",
                "Player/Directo.swift",
            ],
            swiftSettings: [.swiftLanguageMode(.v6), .define("DEBUG")]
        ),
        .testTarget(
            name: "NucleoPuroTests",
            dependencies: ["NucleoPuro"],
            path: "Tests/AceNeoTests",
            sources: ["Puros"],
            resources: [.copy("Vectores")],
            swiftSettings: [.swiftLanguageMode(.v6), .define("DEBUG")]
        ),
    ]
)
