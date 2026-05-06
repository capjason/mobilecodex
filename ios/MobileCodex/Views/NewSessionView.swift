import SwiftUI

struct NewSessionView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let host: HostConfig

    @State private var request = NewSessionRequest()
    @State private var isCreating = false

    var body: some View {
        Form {
            Section("Agent") {
                Picker("Agent", selection: $request.agent) {
                    ForEach(AgentKind.allCases) { agent in
                        Text(agent.title).tag(agent)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section("Directory") {
                Picker("Repository", selection: repoBinding) {
                    Text("Select Repository").tag(nil as Repo?)
                    ForEach(store.reposByHost[host.id] ?? []) { repo in
                        Text(repo.name).tag(Optional(repo))
                    }
                }
            }

            Section("Profile") {
                Picker("Profile", selection: $request.profile) {
                    ForEach(LaunchProfile.allCases) { profile in
                        Text(profile.title).tag(profile)
                    }
                }
            }

            Section("Model") {
                TextField("default", text: $request.model)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            Section("Initial Prompt") {
                TextEditor(text: $request.initialPrompt)
                    .frame(minHeight: 120)
            }

            Section("Advanced") {
                TextField("--model gpt-5.2", text: $request.extraArgs)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
        }
        .navigationTitle("New Session")
        .toolbar {
            Button {
                Task { await create() }
            } label: {
                if isCreating {
                    ProgressView()
                } else {
                    Text("Create")
                }
            }
            .disabled(request.repo == nil || isCreating)
        }
        .task {
            await store.refresh(host: host)
        }
    }

    private var repoBinding: Binding<Repo?> {
        Binding(
            get: { request.repo },
            set: { request.repo = $0 }
        )
    }

    private func create() async {
        isCreating = true
        _ = await store.createSession(host: host, request: request)
        isCreating = false
        dismiss()
    }
}

