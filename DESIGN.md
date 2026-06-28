# Glyph Design

Glyph is a collaborative whiteboard where a very fast AI partner can inspect, edit, and explain a shared design graph in near real time. The hackathon goal is to demonstrate responsiveness enabled by Cerebras using `gemma-4-31b` multimodal requests.

## Product Shape

- The user edits one shared whiteboard in the browser.
- The AI receives both structured board JSON and a browser-captured screenshot.
- The AI can call tools that mutate the same graph the UI edits.
- A history sidebar records committed graph changes with natural language summaries.
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
- `line`: `plain`, `arrow`, or `doubleArrow`; may be anchored to box sides.
- `text`: floating editable text object.

Anchors override positional information for the anchored endpoint. Free endpoints keep absolute coordinates.

## Architecture

- Frontend: TypeScript React with Vite and MUI.
- Backend: minimal TypeScript Express service.
- Persistence: in-memory for the prototype, replaceable with file or database storage.
- AI proxy: backend endpoint will call Cerebras with `CEREBRAS_API_KEY`.
- Multimodal context: frontend captures a board screenshot with `html2canvas` and sends it with serialized graph state.

## AI Loop

Two invocation modes are under consideration:

- Continuous loop: send a new model request as soon as the prior request completes to approximate real-time AI presence.
- Change-triggered loop: invoke only when user edits occur, which may produce better signal and lower noise.

The prototype should support measuring both. The assistant thread needs history, and when context approaches the limit the backend should compact the conversation into a durable summary.

## LLM Tools

The model-facing tool layer should mirror UI capabilities:

- Create box, line, or text.
- Update element geometry, label/text, style, shape, or line style.
- Delete element.
- Clear board.
- Anchor or unanchor line endpoints.

Tool results should return the updated board JSON and enough metadata for the history summarizer.

## Current Prototype

The first implementation includes:

- SVG whiteboard surface.
- Draw box, line, and text.
- Select, drag, inspect, edit, erase, and clear.
- Double-click inline editing for box labels, line labels, and floating text.
- Box-side anchoring when drawing lines from or to boxes.
- Local drag/edit previews with backend commits only when the interaction is complete.
- In-memory backend persistence.
- History list with placeholder commit descriptions.
- JSON state preview and screenshot capture.
