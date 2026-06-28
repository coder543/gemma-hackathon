# Glyph Plan

## Phase 1: Project Foundation

- [x] Initialize TypeScript React frontend.
- [x] Initialize minimal TypeScript backend.
- [x] Add MUI-based application shell.
- [x] Add `DESIGN.md`, `PLAN.md`, and `AGENTS.md`.
- [x] Implement first-pass whiteboard drawing and editing UI.
- [x] Serialize board state as LLM-readable JSON.
- [x] Add one-board backend persistence and clear action.

## Phase 2: Whiteboard Graph Quality

- [x] Add double-click inline editing for labels and floating text.
- [x] Commit drag and text-edit interactions only when the interaction is complete.
- [x] Add first-pass box-side anchors for line endpoints.
- [x] Add robust resize handles for boxes and text.
- [x] Add line endpoint editing.
- [x] Render cloud boxes with a better cloud shape.
- [x] Add undo/redo.
- [x] Replace placeholder history descriptions with generated summaries.

## Phase 3: AI Tool Layer

- [x] Define server-side tool schemas for board mutations.
- [x] Expose create/update/delete/clear/anchor tools to the assistant loop.
- [x] Validate every tool call against the same board schema used by the UI.
- [x] Return normalized graph diffs for history and debugging.

## Phase 4: Cerebras Integration

- [ ] Implement Cerebras proxy endpoint using `CEREBRAS_API_KEY`.
- [ ] Send board JSON and browser screenshot in multimodal requests.
- [ ] Maintain assistant conversation history.
- [ ] Add context compaction when the history approaches the model limit.
- [x] Add separate summary request for history sidebar descriptions.

## Phase 5: Real-Time Experiment

- [ ] Implement continuous mode.
- [ ] Implement change-triggered mode.
- [ ] Measure effective model loop rate and UI latency.
- [ ] Decide which interaction model creates better collaboration.
- [ ] Add visible AI status, latest action, and pause/resume controls.

## Notes

- Current persistence is in-memory and will reset when the server restarts.
- The current `/api/ai/turn` endpoint is a placeholder.
- History descriptions are deterministic placeholders until the summary request is implemented.
