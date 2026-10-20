// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "MusixCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "MusixCore", targets: ["MusixCore"]),
    ],
    targets: [
        .target(
            name: "MusixCore",
            swiftSettings: [.enableExperimentalFeature("StrictConcurrency")]
        ),
        .testTarget(
            name: "MusixCoreTests",
            dependencies: ["MusixCore"]
        ),
    ]
)
