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
- [x] Expose create/update/delete/clear/anchor tools for interactive AI flows.
- [x] Validate every tool call against the same board schema used by the UI.
- [x] Return normalized graph diffs for history and debugging.

## Phase 4: Interactive AI Use Cases

- [x] Implement Cerebras-backed history summary requests using `CEREBRAS_API_KEY`.
- [x] Add separate summary request for history sidebar descriptions.
- [x] Add AI-generated SVG image boxes from user descriptions.
- [x] Encourage animated SVG output for generated image boxes.
- [x] Detect SVG render failures and automatically ask the model to repair using previous render-attempt history.
- [ ] Add regenerate/refine controls for AI image boxes.
- [ ] Add more focused interactive AI commands for selected board elements.

## Deferred: Assistant Loop

- [ ] Implement `/api/ai/turn` assistant loop only after interactive use cases justify it.
- [ ] Send board JSON and browser screenshot in assistant-loop multimodal requests.
- [ ] Maintain assistant conversation history.
- [ ] Add context compaction when the history approaches the model limit.
- [ ] Revisit continuous mode versus change-triggered mode later.

## Notes

- Current persistence is in-memory and will reset when the server restarts.
- The current `/api/ai/turn` endpoint is intentionally deferred.
- Live API smoke tests should not mutate the active in-memory board unless they clean up after themselves.
