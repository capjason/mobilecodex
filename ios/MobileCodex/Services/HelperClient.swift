import Foundation

protocol HelperClient {
    func doctor(host: HostConfig) async throws -> DoctorReport
    func scanRepos(host: HostConfig) async throws -> [Repo]
    func sessions(host: HostConfig) async throws -> [AgentSession]
    func createSession(host: HostConfig, request: NewSessionRequest) async throws -> AgentSession
    func stopSession(host: HostConfig, sessionId: String) async throws
    func restartSession(host: HostConfig, sessionId: String) async throws -> AgentSession
    func status(host: HostConfig, sessionId: String) async throws -> GitStatusReport
    func diff(host: HostConfig, sessionId: String) async throws -> DiffReport
}

struct MockHelperClient: HelperClient {
    func doctor(host: HostConfig) async throws -> DoctorReport {
        DoctorReport(tmux: true, codex: true, claude: true, git: true, platform: "darwin")
    }

    func scanRepos(host: HostConfig) async throws -> [Repo] {
        [
            Repo(name: "travel-app", path: "/Users/developer/projects/travel-app"),
            Repo(name: "camera-ui", path: "/Users/developer/projects/camera-ui"),
            Repo(name: "obsidian-plugin", path: "/Users/developer/projects/obsidian-plugin")
        ]
    }

    func sessions(host: HostConfig) async throws -> [AgentSession] {
        [
            AgentSession(
                sessionId: "codex__travel-app__0430-1612",
                agent: .codex,
                repoName: "travel-app",
                repoPath: "/Users/developer/projects/travel-app",
                status: .running,
                createdAt: Date(),
                lastActivityAt: Date(),
                tmuxSession: "codex__travel-app__0430-1612"
            ),
            AgentSession(
                sessionId: "claude__camera-ui__0430-1620",
                agent: .claude,
                repoName: "camera-ui",
                repoPath: "/Users/developer/projects/camera-ui",
                status: .waiting,
                createdAt: Date(),
                lastActivityAt: Date(),
                tmuxSession: "claude__camera-ui__0430-1620"
            )
        ]
    }

    func createSession(host: HostConfig, request: NewSessionRequest) async throws -> AgentSession {
        let repo = request.repo ?? Repo(name: "travel-app", path: "/Users/developer/projects/travel-app")
        return AgentSession(
            sessionId: "\(request.agent.rawValue)__\(repo.name)__0430-1800",
            agent: request.agent,
            repoName: repo.name,
            repoPath: repo.path,
            status: .running,
            createdAt: Date(),
            lastActivityAt: Date(),
            tmuxSession: "\(request.agent.rawValue)__\(repo.name)__0430-1800"
        )
    }

    func stopSession(host: HostConfig, sessionId: String) async throws {}

    func restartSession(host: HostConfig, sessionId: String) async throws -> AgentSession {
        let allSessions = try await sessions(host: host)
        return allSessions.first { $0.sessionId == sessionId } ?? allSessions[0]
    }

    func status(host: HostConfig, sessionId: String) async throws -> GitStatusReport {
        GitStatusReport(
            repoPath: "/Users/developer/projects/travel-app",
            modified: ["src/auth/login.ts", "src/api/session.ts"],
            staged: [],
            deleted: [],
            untracked: ["test/auth.test.ts"]
        )
    }

    func diff(host: HostConfig, sessionId: String) async throws -> DiffReport {
        DiffReport(
            repoPath: "/Users/developer/projects/travel-app",
            stat: "src/auth/login.ts | 12 ++++++------",
            diff: """
            diff --git a/src/auth/login.ts b/src/auth/login.ts
            --- a/src/auth/login.ts
            +++ b/src/auth/login.ts
            @@ -1,2 +1,2 @@
            -old login flow
            +new login flow
            """
        )
    }
}
