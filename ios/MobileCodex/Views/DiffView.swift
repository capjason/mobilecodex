import SwiftUI

struct DiffView: View {
    @EnvironmentObject private var store: AppStore
    let host: HostConfig
    let session: AgentSession

    @State private var status: GitStatusReport?
    @State private var diff: DiffReport?

    var body: some View {
        List {
            if let status {
                Section("Status") {
                    FileGroup(title: "Modified", files: status.modified)
                    FileGroup(title: "Staged", files: status.staged)
                    FileGroup(title: "Deleted", files: status.deleted)
                    FileGroup(title: "Untracked", files: status.untracked)
                }
            }

            if let diff {
                Section("Stat") {
                    Text(diff.stat.isEmpty ? "No unstaged diff" : diff.stat)
                        .font(.system(.footnote, design: .monospaced))
                }
                Section("Diff") {
                    Text(diff.diff.isEmpty ? "No diff" : diff.diff)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                }
            }
        }
        .navigationTitle("Diff")
        .task {
            async let statusReport = store.status(host: host, sessionId: session.sessionId)
            async let diffReport = store.diff(host: host, sessionId: session.sessionId)
            status = await statusReport
            diff = await diffReport
        }
    }
}

private struct FileGroup: View {
    let title: String
    let files: [String]

    var body: some View {
        if !files.isEmpty {
            DisclosureGroup("\(title) (\(files.count))") {
                ForEach(files, id: \.self) { file in
                    Text(file)
                        .font(.system(.footnote, design: .monospaced))
                }
            }
        }
    }
}

