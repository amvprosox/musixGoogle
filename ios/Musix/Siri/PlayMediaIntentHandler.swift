import Intents
import MusixCore

final class PlayMediaIntentHandler: NSObject, INPlayMediaIntentHandling {
    private let model: AppModel

    init(model: AppModel) {
        self.model = model
    }

    func resolveMediaItems(for intent: INPlayMediaIntent) async -> [INPlayMediaMediaItemResolutionResult] {
        let search = intent.mediaSearch
        let query = [search?.mediaName, search?.artistName, search?.albumName]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if query.isEmpty, let snapshot = await model.settings.resume {
            let item = INMediaItem(
                identifier: MediaIds.track(snapshot.videoId, playlistId: snapshot.playlistId),
                title: snapshot.title,
                type: .song,
                artwork: nil
            )
            return INPlayMediaMediaItemResolutionResult.successes(with: [item])
        }
        let library = model.library
        guard let entry = await library.firstPlayable(matching: query) else {
            return [INPlayMediaMediaItemResolutionResult.unsupported()]
        }
        let type: INMediaItemType
        switch entry.kind {
        case .album: type = .album
        case .playlist: type = .playlist
        case .artist: type = .artist
        default: type = .song
        }
        let item = INMediaItem(identifier: entry.mediaId, title: entry.title, type: type, artwork: nil)
        return INPlayMediaMediaItemResolutionResult.successes(with: [item])
    }

    func handle(intent: INPlayMediaIntent) async -> INPlayMediaIntentResponse {
        let player = model.player
        guard let identifier = intent.mediaItems?.first?.identifier else {
            let resumed = await player.resumeLastSession()
            return INPlayMediaIntentResponse(code: resumed ? .success : .failure, userActivity: nil)
        }
        await player.play(mediaId: identifier)
        return INPlayMediaIntentResponse(code: .success, userActivity: nil)
    }
}
