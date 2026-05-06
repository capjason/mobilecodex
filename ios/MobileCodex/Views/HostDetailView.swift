import SwiftUI

struct HostDetailView: View {
    @EnvironmentObject private var store: AppStore
    let host: HostConfig

    var body: some View {
        List {
            if let report = store.doctorByHost[host.id] {
                Section("Host") {
                    DoctorRow(report: report)
                }
            }

            Section("Active Sessions") {
                ForEach(store.sessionsByHost[host.id] ?? []) { session in
                    NavigationLink {
                        SessionView(host: host, session: session)
                    } label: {
                        SessionRow(session: session)
                    }
                }
            }

            Section("New Session") {
                NavigationLink {
                    NewSessionView(host: host)
                } label: {
                    Label("Create Agent Session", systemImage: "plus.circle")
                }
            }
        }
        .navigationTitle(host.name)
        .toolbar {
            Button {
                Task { await store.refresh(host: host) }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
        }
        .task {
            await store.refresh(host: host)
        }
    }
}

private struct DoctorRow: View {
    let report: DoctorReport

    var body: some View {
        HStack {
            Label(report.platform, systemImage: "server.rack")
            Spacer()
            HStack(spacing: 10) {
                CapabilityBadge(title: "tmux", enabled: report.tmux)
                CapabilityBadge(title: "git", enabled: report.git)
                CapabilityBadge(title: "codex", enabled: report.codex)
                CapabilityBadge(title: "claude", enabled: report.claude)
            }
        }
    }
}

private struct CapabilityBadge: View {
    let title: String
    let enabled: Bool

    var body: some View {
        Text(title)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(enabled ? Color.green.opacity(0.16) : Color.gray.opacity(0.16))
            .foregroundStyle(enabled ? .green : .secondary)
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct SessionRow: View {
    let session: AgentSession

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: session.agent == .codex ? "terminal" : "sparkles")
                .frame(width: 26)
                .foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(session.agent.title) / \(session.repoName)")
                    .font(.headline)
                Text(session.status.rawValue)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }
}

