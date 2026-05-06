# MobileCodex MVP Implementation Plan (v0.5 Updated)

## Goal

Deliver a stable mobile-first chat control surface for Codex / Claude Code CLI sessions, with strong resume continuity and tool-call visibility.

## Current Baseline (Done)

- Host-side helper + metadata under `~/.ai-remote/sessions`.
- Session create/resume/stop APIs.
- Structured Codex chat runtime + WebSocket replay.
- Mobile web app deployable behind a Tailscale-only HTTPS gateway.
- Session continuity across iOS background/foreground reconnect.

## Milestone A: Session-Mode UX (Done)

- Hide top launch controls after entering a session.
- Keep bottom composer docked to bottom.
- Use single transcript view (remove Raw Terminal toggle).
- Replace close text button with compact icon.

## Milestone B: Tool Call Visibility (Done)

- Parse tool calls from Codex persisted history (`~/.codex/sessions/*.jsonl`).
- Replay `tool_started` / `tool_completed` / `tool_output_delta`.
- Render tool calls as folded blocks in chat.
- Merge continuous tool events to reduce transcript noise.

## Milestone C: Stability and Verification (Ongoing)

- Keep reconnect behavior robust after page suspend/resume.
- Keep deterministic tests for history parsing, WebSocket replay, and UI structure.
- Keep service deployment verification (`mobilecodex.service`, `nous.service`, `/api/health`).
