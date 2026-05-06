import SwiftUI

struct SessionView: View {
    @EnvironmentObject private var store: AppStore
    let host: HostConfig
    let session: AgentSession

    @State private var prompt = ""
    @State private var lines: [TerminalLine] = [
        TerminalLine(text: "Connected to tmux session."),
        TerminalLine(text: "Waiting for agent output...")
    ]

    private let quickPrompts = [
        "Continue",
        "Summarize progress",
        "Explain the last change",
        "Run tests",
        "Fix the error",
        "Generate commit message",
        "Do not edit code. Analyze first."
    ]

    var body: some View {
        VStack(spacing: 0) {
            terminal
            Divider()
            promptBar
            quickPromptScroller
            specialKeys
        }
        .navigationTitle(session.repoName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            NavigationLink {
                DiffView(host: host, session: session)
            } label: {
                Image(systemName: "doc.text.magnifyingglass")
            }
        }
    }

    private var terminal: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                ForEach(lines) { line in
                    Text(line.text)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(.green)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(12)
        }
        .background(Color.black)
    }

    private var promptBar: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message", text: $prompt, axis: .vertical)
                .lineLimit(1...5)
                .textFieldStyle(.roundedBorder)
            Button {
                send(prompt)
                prompt = ""
            } label: {
                Image(systemName: "paperplane.fill")
            }
            .buttonStyle(.borderedProminent)
            .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(10)
    }

    private var quickPromptScroller: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(quickPrompts, id: \.self) { text in
                    Button(text) { send(text) }
                        .buttonStyle(.bordered)
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
        }
    }

    private var specialKeys: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(["Esc", "Tab", "Ctrl+C", "Ctrl+D", "Up", "Down", "Enter"], id: \.self) { key in
                    Button(key) { sendKey(key) }
                        .font(.caption)
                        .buttonStyle(.bordered)
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 10)
        }
    }

    private func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        lines.append(TerminalLine(text: "> \(trimmed)"))
    }

    private func sendKey(_ key: String) {
        lines.append(TerminalLine(text: "[\(key)]"))
    }
}
