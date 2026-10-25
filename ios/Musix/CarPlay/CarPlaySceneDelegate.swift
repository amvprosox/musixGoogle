import CarPlay
import Combine
import MusixCore
import UIKit

@MainActor
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var coordinator: CarPlayCoordinator?

    nonisolated func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        Task { @MainActor in
            self.connect(interfaceController)
        }
    }

    nonisolated func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        Task { @MainActor in
            self.disconnect()
        }
    }

    private func connect(_ interfaceController: CPInterfaceController) {
        coordinator?.stop()
        let coordinator = CarPlayCoordinator(model: AppModel.shared, interface: interfaceController)
        self.coordinator = coordinator
        coordinator.start()
    }

    private func disconnect() {
        coordinator?.stop()
        coordinator = nil
    }
}

@MainActor
final class CarPlayCoordinator {
    private final class ListState {
        let mediaId: String
        let title: String
        let playable: Bool
        var entries: [LibraryEntry] = []
        var page = 0
        var done = false
        var failure: LoadFailure?
        var loading = false
        weak var template: CPListTemplate?

        init(mediaId: String, title: String, playable: Bool) {
            self.mediaId = mediaId
            self.title = title
            self.playable = playable
        }
    }

    private let model: AppModel
    private let interface: CPInterfaceController
    private var lists: [ListState] = []
    private var cancellables = Set<AnyCancellable>()
    private var alertShown = false

    init(model: AppModel, interface: CPInterfaceController) {
        self.model = model
        self.interface = interface
    }

    func start() {
        let templates = RootTab.allCases.map { tab -> CPListTemplate in
            let state = ListState(mediaId: MediaIds.tab(tab), title: tab.title, playable: false)
            let template = makeTemplate(for: state)
            template.tabTitle = tab.title
            template.tabImage = UIImage(named: Self.iconName(for: tab))
            return template
        }
        let tabBar = CPTabBarTemplate(templates: templates)
        interface.setRootTemplate(tabBar, animated: false, completion: nil)
        configureNowPlaying()
        for state in lists {
            load(state)
        }
        model.engine.$status
            .removeDuplicates()
            .sink { [weak self] status in
                guard let self, status == .ready else {
                    return
                }
                for state in self.lists where state.failure != nil {
                    self.reset(state)
                }
            }
            .store(in: &cancellables)
        model.engine.$account
            .removeDuplicates()
            .dropFirst()
            .sink { [weak self] _ in
                guard let self else {
                    return
                }
                Task {
                    await self.model.library.clear()
                    for state in self.lists {
                        self.reset(state)
                    }
                }
            }
            .store(in: &cancellables)
        model.player.$state
            .map { $0.likeStatus == .like }
            .removeDuplicates()
            .sink { [weak self] liked in
                self?.updateLikeButton(liked: liked)
            }
            .store(in: &cancellables)
    }

    func stop() {
        cancellables.removeAll()
        lists.removeAll()
    }

    private static func iconName(for tab: RootTab) -> String {
        switch tab {
        case .home: return "home"
        case .library: return "library"
        case .playlists: return "list_music"
        case .recent: return "history"
        }
    }

    private func makeTemplate(for state: ListState) -> CPListTemplate {
        let template = CPListTemplate(title: state.title, sections: [])
        template.emptyViewTitleVariants = ["Loading"]
        template.emptyViewSubtitleVariants = [""]
        state.template = template
        lists.append(state)
        return template
    }

    private func reset(_ state: ListState) {
        state.entries = []
        state.page = 0
        state.done = false
        state.failure = nil
        state.template?.emptyViewTitleVariants = ["Loading"]
        state.template?.emptyViewSubtitleVariants = [""]
        state.template?.updateSections([])
        load(state)
    }

    private func load(_ state: ListState) {
        guard !state.loading, !state.done else {
            return
        }
        state.loading = true
        Task {
            let result = await model.library.children(of: state.mediaId, page: state.page)
            state.loading = false
            switch result {
            case let .items(entries, _):
                state.failure = nil
                state.entries.append(contentsOf: entries)
                state.page += 1
                state.done = entries.count < LibraryService.pageSize
                render(state)
            case let .failed(failure):
                state.failure = failure
                state.template?.emptyViewTitleVariants = [failure == .offline ? "You're offline" : "Couldn't load this page"]
                state.template?.emptyViewSubtitleVariants = [failure.message]
                render(state)
                if failure == .signedOut {
                    showSignedOutAlert()
                }
            case .notFound:
                state.done = true
                state.template?.emptyViewTitleVariants = ["Nothing here"]
                render(state)
            }
        }
    }

    private func render(_ state: ListState) {
        guard let template = state.template else {
            return
        }
        if state.entries.isEmpty, state.failure == nil, state.done {
            template.emptyViewTitleVariants = ["Nothing here yet"]
            template.emptyViewSubtitleVariants = [""]
        }
        let limit = max(1, CPListTemplate.maximumItemCount - 2)
        var sections: [CPListSection] = []
        if state.playable, !state.entries.isEmpty {
            let playAll = CPListItem(text: "Play all", detailText: nil, image: UIImage(named: "play_filled"))
            let mediaId = state.mediaId
            playAll.handler = { [weak self] _, completion in
                Task { @MainActor in self?.play(mediaId) }
                completion()
            }
            sections.append(CPListSection(items: [playAll]))
        }
        var currentGroup: String?
        var currentItems: [CPListItem] = []
        for entry in state.entries.prefix(limit) {
            if entry.groupTitle != currentGroup, !currentItems.isEmpty {
                sections.append(CPListSection(items: currentItems, header: currentGroup, sectionIndexTitle: nil))
                currentItems = []
            }
            currentGroup = entry.groupTitle
            currentItems.append(makeItem(entry))
        }
        if !currentItems.isEmpty {
            sections.append(CPListSection(items: currentItems, header: currentGroup, sectionIndexTitle: nil))
        }
        if !state.done, state.entries.count < limit {
            let more = CPListItem(text: "Load more", detailText: nil)
            more.handler = { [weak self] _, completion in
                Task { @MainActor in self?.load(state) }
                completion()
            }
            sections.append(CPListSection(items: [more]))
        }
        template.updateSections(sections)
    }

    private func makeItem(_ entry: LibraryEntry) -> CPListItem {
        let detail = entry.subtitle.isEmpty ? nil : entry.subtitle
        let item = CPListItem(text: entry.title, detailText: detail, image: UIImage(named: "music"))
        item.accessoryType = entry.browsable ? .disclosureIndicator : .none
        item.handler = { [weak self] _, completion in
            Task { @MainActor in self?.select(entry) }
            completion()
        }
        if !entry.artworkUrl.isEmpty {
            let address = entry.artworkUrl
            Task {
                if let data = await ArtworkLoader.shared.data(for: address), let image = UIImage(data: data) {
                    item.setImage(image)
                }
            }
        }
        return item
    }

    private func select(_ entry: LibraryEntry) {
        if entry.browsable {
            let state = ListState(mediaId: entry.mediaId, title: entry.title, playable: entry.playable)
            let template = makeTemplate(for: state)
            interface.pushTemplate(template, animated: true, completion: nil)
            load(state)
            return
        }
        if entry.playable {
            play(entry.mediaId)
        }
    }

    private func play(_ mediaId: String) {
        model.player.play(mediaId: mediaId)
        interface.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
    }

    private func configureNowPlaying() {
        let nowPlaying = CPNowPlayingTemplate.shared
        nowPlaying.isUpNextButtonEnabled = false
        nowPlaying.isAlbumArtistButtonEnabled = false
        updateLikeButton(liked: model.player.isLiked)
    }

    private func updateLikeButton(liked: Bool) {
        guard let image = UIImage(named: liked ? "heart_filled" : "heart") else {
            return
        }
        let like = CPNowPlayingImageButton(image: image) { [weak self] _ in
            Task { @MainActor in self?.model.player.toggleLike() }
        }
        let shuffle = CPNowPlayingShuffleButton { [weak self] _ in
            Task { @MainActor in self?.model.player.toggleShuffle() }
        }
        let repeatButton = CPNowPlayingRepeatButton { [weak self] _ in
            Task { @MainActor in self?.model.player.cycleRepeat() }
        }
        CPNowPlayingTemplate.shared.updateNowPlayingButtons([shuffle, like, repeatButton])
    }

    private func showSignedOutAlert() {
        guard !alertShown else {
            return
        }
        alertShown = true
        let ok = CPAlertAction(title: "OK", style: .cancel) { [weak self] _ in
            Task { @MainActor in self?.interface.dismissTemplate(animated: true, completion: nil) }
        }
        let alert = CPAlertTemplate(titleVariants: ["Open Musix on your iPhone and sign in to see your library."], actions: [ok])
        interface.presentTemplate(alert, animated: true, completion: nil)
    }
}
