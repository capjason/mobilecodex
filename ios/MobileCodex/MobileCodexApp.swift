import SwiftUI

@main
struct MobileCodexApp: App {
    @StateObject private var store = AppStore(helper: MockHelperClient())

    var body: some Scene {
        WindowGroup {
            HostListView()
                .environmentObject(store)
        }
    }
}

