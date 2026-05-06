import Foundation

struct HostConfig: Identifiable, Codable, Hashable {
    let id: UUID
    var name: String
    var host: String
    var ip: String
    var user: String
    var port: Int
    var authType: AuthType

    static let sample = HostConfig(
        id: UUID(),
        name: "Dev Host",
        host: "dev-host",
        ip: "100.64.0.1",
        user: "developer",
        port: 22,
        authType: .sshKey
    )
}

enum AuthType: String, Codable, CaseIterable {
    case sshKey = "ssh_key"
}

enum AgentKind: String, Codable, CaseIterable, Identifiable {
    case codex
    case claude

    var id: String { rawValue }

    var title: String {
        switch self {
        case .codex: return "Codex"
        case .claude: return "Claude Code"
        }
    }
}

enum LaunchProfile: String, Codable, CaseIterable, Identifiable {
    case safePlan = "safe_plan"
    case normal = "normal"
    case fullAuto = "full_auto"
    case review

    var id: String { rawValue }

    var title: String {
        switch self {
        case .safePlan: return "Safe Plan"
        case .normal: return "Normal Coding"
        case .fullAuto: return "Full Auto"
        case .review: return "Review"
        }
    }
}

struct Repo: Identifiable, Codable, Hashable {
    var id: String { path }
    let name: String
    let path: String
}

struct AgentSession: Identifiable, Codable, Hashable {
    var id: String { sessionId }
    let sessionId: String
    let agent: AgentKind
    let repoName: String
    let repoPath: String
    let status: SessionStatus
    let createdAt: Date
    let lastActivityAt: Date?
    let tmuxSession: String
}

enum SessionStatus: String, Codable {
    case running
    case waiting
    case idle
    case stopped
    case missing
}

struct DoctorReport: Codable {
    let tmux: Bool
    let codex: Bool
    let claude: Bool
    let git: Bool
    let platform: String
}

struct NewSessionRequest {
    var agent: AgentKind = .codex
    var repo: Repo?
    var profile: LaunchProfile = .normal
    var model: String = "default"
    var initialPrompt: String = ""
    var extraArgs: String = ""
}

struct GitStatusReport: Codable {
    let repoPath: String
    let modified: [String]
    let staged: [String]
    let deleted: [String]
    let untracked: [String]
}

struct DiffReport: Codable {
    let repoPath: String
    let stat: String
    let diff: String
}

struct TerminalLine: Identifiable, Hashable {
    let id = UUID()
    let text: String
}
