import Foundation

@MainActor
final class AppStore: ObservableObject {
    @Published var hosts: [HostConfig] = [.sample]
    @Published var sessionsByHost: [UUID: [AgentSession]] = [:]
    @Published var reposByHost: [UUID: [Repo]] = [:]
    @Published var doctorByHost: [UUID: DoctorReport] = [:]
    @Published var errorMessage: String?

    private let helper: any HelperClient

    init(helper: any HelperClient) {
        self.helper = helper
    }

    func refresh(host: HostConfig) async {
        do {
            async let doctor = helper.doctor(host: host)
            async let repos = helper.scanRepos(host: host)
            async let sessions = helper.sessions(host: host)
            doctorByHost[host.id] = try await doctor
            reposByHost[host.id] = try await repos
            sessionsByHost[host.id] = try await sessions
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func createSession(host: HostConfig, request: NewSessionRequest) async -> AgentSession? {
        do {
            let session = try await helper.createSession(host: host, request: request)
            var sessions = sessionsByHost[host.id] ?? []
            sessions.insert(session, at: 0)
            sessionsByHost[host.id] = sessions
            return session
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func status(host: HostConfig, sessionId: String) async -> GitStatusReport? {
        do {
            return try await helper.status(host: host, sessionId: sessionId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func diff(host: HostConfig, sessionId: String) async -> DiffReport? {
        do {
            return try await helper.diff(host: host, sessionId: sessionId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }
}

