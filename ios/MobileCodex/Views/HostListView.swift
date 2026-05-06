import SwiftUI

struct HostListView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        NavigationStack {
            List(store.hosts) { host in
                NavigationLink(value: host) {
                    HostRow(host: host, report: store.doctorByHost[host.id])
                }
            }
            .navigationTitle("Hosts")
            .navigationDestination(for: HostConfig.self) { host in
                HostDetailView(host: host)
            }
            .task {
                for host in store.hosts {
                    await store.refresh(host: host)
                }
            }
            .alert("Error", isPresented: errorBinding) {
                Button("OK") { store.errorMessage = nil }
            } message: {
                Text(store.errorMessage ?? "")
            }
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { store.errorMessage != nil },
            set: { if !$0 { store.errorMessage = nil } }
        )
    }
}

private struct HostRow: View {
    let host: HostConfig
    let report: DoctorReport?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "desktopcomputer")
                .frame(width: 28, height: 28)
                .foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 4) {
                Text(host.name)
                    .font(.headline)
                Text("\(host.user)@\(host.host):\(host.port)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            StatusDot(isOnline: report != nil)
        }
        .padding(.vertical, 4)
    }
}

private struct StatusDot: View {
    let isOnline: Bool

    var body: some View {
        Circle()
            .fill(isOnline ? Color.green : Color.gray)
            .frame(width: 10, height: 10)
            .accessibilityLabel(isOnline ? "Online" : "Unknown")
    }
}

