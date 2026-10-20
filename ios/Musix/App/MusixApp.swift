import Intents
import SwiftUI
import UIKit

@MainActor
final class AppModel {
    static let shared = AppModel()

    let settings: AppSettings
    let engine: WebEngine
    let player: PlayerController
    let library: LibraryService

    private init() {
        let settings = AppSettings()
        let engine = WebEngine(settings: settings)
        self.settings = settings
        self.engine = engine
        self.player = PlayerController(engine: engine, settings: settings)
        self.library = LibraryService(queue: engine.commandQueue, settings: settings)
        engine.start()
    }

    func clearCaches() async {
        await library.clear()
        await ArtworkLoader.shared.clear()
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        _ = AppModel.shared
        return true
    }

    func application(_ application: UIApplication, handlerFor intent: INIntent) -> Any? {
        guard intent is INPlayMediaIntent else {
            return nil
        }
        return PlayMediaIntentHandler(model: AppModel.shared)
    }
}

@main
struct MusixApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            RootView(
                engine: AppModel.shared.engine,
                player: AppModel.shared.player,
                library: AppModel.shared.library,
                settings: AppModel.shared.settings
            )
        }
    }
}
