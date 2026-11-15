import Foundation
import HassCore

// Runs every publication file in a corpus through the app's own compiler and prints one line per file:
//   <file>\tOK
//   <file>\t<code>\t<pointer>\t<capability or ->
// plus a final `capabilities\t<json array>` line. Arguments: <corpus-dir> [file ...].

let arguments = Array(CommandLine.arguments.dropFirst())
guard let root = arguments.first else { FileHandle.standardError.write(Data("usage: appcheck <corpus-dir> [files]\n".utf8)); exit(2) }
let directory = URL(fileURLWithPath: root)
var files = Array(arguments.dropFirst())
if files.isEmpty {
    for folder in ["accept", "reject"] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.appendingPathComponent(folder).path)) ?? []
        files += names.filter { $0.hasSuffix(".json") }.sorted().map { "\(folder)/\($0)" }
    }
}
for file in files {
    guard let bytes = try? Data(contentsOf: directory.appendingPathComponent(file)) else { print("\(file)\tUNREADABLE"); continue }
    do {
        _ = try ServerUICompositionPublication.decode(bytes)
        print("\(file)\tOK")
    } catch let error as ServerUICompositionError {
        print("\(file)\t\(error.code.rawValue)\t\(error.pointer)\t\(error.capability ?? "-")")
    } catch {
        print("\(file)\tOTHER\t\(error)")
    }
}
let list = ServerUICompositionPublication.supportedCapabilities.sorted()
let data = try JSONSerialization.data(withJSONObject: list, options: [.withoutEscapingSlashes])
print("capabilities\t\(String(decoding: data, as: UTF8.self))")
