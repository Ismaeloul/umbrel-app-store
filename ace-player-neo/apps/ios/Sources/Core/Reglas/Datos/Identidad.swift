import Foundation

/* Identidad del dispositivo emparejado (b-arquitectura §2.1.4, contrato I0→M1; a7 §7). */

enum IdentidadDispositivo {
    /// `<deviceId>.<secreto>` → `deviceId` (a7 §7).
    static func id(token: String) -> String? { token.split(separator: ".", maxSplits: 1).first.map(String.init) }
}
