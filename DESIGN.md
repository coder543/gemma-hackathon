# Glyph Design

Glyph is a collaborative whiteboard where a very fast AI partner can inspect, edit, and explain a shared design graph in near real time. The hackathon goal is to demonstrate responsiveness enabled by Cerebras using `gemma-4-31b` multimodal requests.

## Product Shape

- The user edits one shared whiteboard in the browser.
- The AI receives both structured board JSON and a browser-captured screenshot.
- The AI can call tools that mutate the same graph the UI edits.
- The left sidebar records committed graph changes with natural language summaries.
- The prototype supports one persistent board with an explicit clear action.

## Whiteboard Graph

The board state is an array of objects. Every element has a numeric `id` and a `type`.

```json
[
  {
    "id": 1,
    "type": "box",
    "shape": "rectangle",
    "label": "Checkout",
    "x": 120,
    "y": 160,
    "width": 180,
    "height": 96,
    "style": { "stroke": "#2563eb", "fill": "#ffffff", "strokeWidth": 2 }
  },
  {
    "id": 2,
    "type": "line",
    "lineStyle": "arrow",
    "start": { "x": 300, "y": 208 },
    "end": { "x": 460, "y": 208 },
    "startAnchor": { "elementId": 1, "side": "right" },
    "style": { "stroke": "#1f2937", "strokeWidth": 2 }
  }
]
```

Supported element types:

- `box`: `rectangle`, `oval`, or `cloud`; may have a text `label`.
- `line`: `plain`, `arrow`, or `doubleArrow`; may be anchored to box or image-box sides.
- `text`: floating editable text object.
- `image`: AI-generated SVG image box with a user `description`, generated `svg`, and render-attempt history.

Anchors override positional information for the anchored endpoint. Free endpoints keep absolute coordinates. Boxes and image boxes are anchor targets. When the user draws or drags a line endpoint, side targets appear and the endpoint snaps to the nearest target within a short distance.
Boxes, floating text, and image boxes are resizable. Box labels and floating text wrap within their visible bounds.

## Architecture

- Frontend: TypeScript React with Vite and MUI.
- Backend: minimal TypeScript Express service.
- Persistence: in-memory for the prototype, replaceable with file or database storage.
- AI proxy: backend endpoint will call Cerebras with `CEREBRAS_API_KEY`.
- LLM requests retry transient Cerebras 5xx responses after a 1 second delay, up to 3 retries.
- Multimodal context: frontend captures a cropped populated-board screenshot with `html2canvas` and sends it with serialized graph state.

## Interactive AI

The current AI direction prioritizes bounded interactive use cases instead of a continuous assistant loop.

Implemented use cases:

- History summaries: each committed edit sends before/after graph state and screenshots to `gemma-4-31b` for a 2 to 5 word label.
- AI image boxes: the user drags the desired image frame, describes the image, the backend asks `gemma-4-31b` for standalone SVG, and the browser renders it as a resizable board element.
- Chat-directed board edits: the user can ask Glyph to change the whiteboard, the backend gives `gemma-4-31b` the current graph plus mutation tools, and the final tool-call result is committed as one board edit.

SVG image generation asks for clean vector composition and at least one subtle declarative animation by default, using native SVG animation or inline CSS keyframes. The image box expands by the minimum amount needed to match the generated SVG aspect ratio. If generated SVG fails browser parsing or loading, the frontend sends the error plus the full prior render-attempt history back to the backend so the model can repair the element. Selected image boxes expose refresh and refine controls for regenerating from the description or applying a follow-up instruction.
When an image box description changes, either from the inspector or from an LLM `update_element` tool call, Glyph regenerates the SVG if the new description differs from the previous one.

The full assistant loop remains deferred until more focused interactive workflows prove useful.

## LLM Tools

The model-facing tool layer should mirror UI capabilities:

- Create box, line, or text.
- Update element geometry, label/text, style, shape, or line style.
- Delete element.
- Clear board.
- Anchor or unanchor line endpoints.

Tool results should return the updated board JSON and enough metadata for the history summarizer.

The backend exposes this layer through:

- `GET /api/tools`: returns model-facing function tool metadata.
- `POST /api/tools/execute`: validates and applies one board mutation tool call.
- `POST /api/ai/chat`: lets the model execute a bounded sequence of board mutation tools from a user instruction, then commits the final graph once.

The initial tool set is:

- `create_box`
- `create_line`
- `create_text`
- `create_image`
- `update_element`
- `delete_element`
- `clear_board`
- `anchor_line_endpoint`

Each execution validates the resulting graph against the shared board schema and returns `{ added, removed, updated }` element ID arrays.

## Current Prototype

The first implementation includes:

- SVG whiteboard surface.
- Zoom controls for changing the visible board scale without changing graph coordinates.
- Draw box, line, and text.
- Select, drag, inspect, edit, erase, and clear.
- Backspace/Delete removes the selected element when focus is not in an editor or input.
- Double-click inline editing for box labels, line labels, and floating text.
- Inspector controls can change selected box shape and selected line style after creation.
- Side anchoring when drawing lines from or to boxes and image boxes.
- Local drag/edit previews with backend commits only when the interaction is complete.
- Resizable boxes and floating text objects.
- Independent line endpoint dragging, including anchoring by dropping an endpoint on a box or image edge.
- Undo and redo for committed board states.
- Cloud boxes rendered as cloud-shaped paths.
- AI-generated SVG image boxes with automatic render-failure repair.
- Refresh and refine controls for selected AI image boxes.
- In-memory backend persistence.
- Left-sidebar history list with AI-generated 2 to 5 word commit descriptions.
- Chat box for asking Glyph to create, update, connect, or delete whiteboard elements through model tool calls.
- Collapsed JSON state preview.
- Independently collapsible left and right sidebars so the board can use more space.

## History Summary Request

Each committed board edit sends the backend:

- Serialized board state before the edit.
- Serialized board state after the edit.
- Browser screenshot before the edit, cropped to the populated board area.
- Browser screenshot after the edit, cropped to the populated board area.

When the board is truly empty, the frontend sends a default blank board screenshot instead of a viewport capture.

The backend asks `gemma-4-31b` through Cerebras for a 2 to 5 word change description. If the model request fails, the app falls back to a deterministic short label so whiteboard commits still succeed.
