# Glyph

A collaborative AI whiteboard prototype where a fast AI partner can inspect, edit, and explain a shared design graph in near real time. Built for a hackathon to demonstrate the responsiveness enabled by Cerebras using `gemma-4-31b` multimodal requests.

## Features

- SVG whiteboard surface with boxes, lines, text, and AI-generated SVG image boxes.
- Draw, select, drag, resize, inline-edit, erase, and clear interactions.
- Box-side anchoring for line endpoints, including image boxes, with proximity snapping.
- Undo/redo as a timeline: future history entries are greyed out and deleted when a new edit branches the timeline.
- AI-generated SVG image boxes with automatic render-failure repair using prior attempt history.
- Refresh and refine controls for selected AI image boxes.
- Edit history sidebar with AI-generated 2 to 5 word commit descriptions.
- JSON state preview and browser screenshot capture.

## Architecture

- **Frontend**: TypeScript React with Vite and MUI.
- **Backend**: minimal TypeScript Express service with in-memory persistence.
- **AI proxy**: backend endpoint calls Cerebras with `CEREBRAS_API_KEY`.
- **Multimodal context**: the frontend captures a board screenshot with `html2canvas` and sends it with serialized graph state.

## Getting started

### Prerequisites

- Node.js
- A `CEREBRAS_API_KEY` environment variable (set in `.env`, which is gitignored).

### Install

```bash
npm install
```

### Run in development

```bash
npm run dev
```

This starts the backend (default `http://localhost:4000`) and the Vite frontend (`http://localhost:5173/`) concurrently.

### Build

```bash
npm run build
```

### Verify

```bash
npm run typecheck
npm run lint
```

## Documentation

- `DESIGN.md` describes the product shape, graph schema, AI loop, and tool contract.
- `PLAN.md` tracks implementation progress across phases.
- `AGENTS.md` documents the agent workflow and verification steps.

## Notes

Persistence is in-memory and resets when the server restarts. The full continuous assistant loop is intentionally deferred until the focused interactive use cases prove useful.
