import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { z } from 'zod';

dotenv.config({ path: '../.env' });
dotenv.config();

const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const anchorSchema = z.object({
  elementId: z.number(),
  side: z.enum(['top', 'right', 'bottom', 'left', 'center']),
});

const styleSchema = z.object({
  stroke: z.string().optional(),
  fill: z.string().optional(),
  strokeWidth: z.number().optional(),
  fontSize: z.number().optional(),
});

const boxSchema = z.object({
  id: z.number(),
  type: z.literal('box'),
  label: z.string().optional(),
  shape: z.enum(['rectangle', 'oval', 'cloud']),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  style: styleSchema.optional(),
});

const lineSchema = z.object({
  id: z.number(),
  type: z.literal('line'),
  label: z.string().optional(),
  lineStyle: z.enum(['plain', 'arrow', 'doubleArrow']),
  start: pointSchema,
  end: pointSchema,
  startAnchor: anchorSchema.optional(),
  endAnchor: anchorSchema.optional(),
  style: styleSchema.optional(),
});

const textSchema = z.object({
  id: z.number(),
  type: z.literal('text'),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number().optional(),
  style: styleSchema.optional(),
});

const elementSchema = z.discriminatedUnion('type', [boxSchema, lineSchema, textSchema]);
const boardSchema = z.object({
  elements: z.array(elementSchema),
  updatedAt: z.string(),
});

const commitSchema = boardSchema.extend({
  change: z
    .object({
      before: boardSchema,
      after: boardSchema,
      beforeScreenshot: z.string().nullable(),
      afterScreenshot: z.string().nullable(),
    })
    .optional(),
});

type Board = z.infer<typeof boardSchema>;
type CommitContext = z.infer<typeof commitSchema>['change'];
type WhiteboardElement = z.infer<typeof elementSchema>;
type BoxElement = z.infer<typeof boxSchema>;

const createBoxArgsSchema = boxSchema.omit({ id: true, type: true });
const createLineArgsSchema = lineSchema.omit({ id: true, type: true });
const createTextArgsSchema = textSchema.omit({ id: true, type: true });
const updateElementArgsSchema = z.object({
  id: z.number(),
  patch: z.record(z.string(), z.unknown()),
});
const deleteElementArgsSchema = z.object({ id: z.number() });
const anchorLineEndpointArgsSchema = z.object({
  lineId: z.number(),
  endpoint: z.enum(['start', 'end']),
  anchor: anchorSchema.nullable().optional(),
  point: pointSchema.optional(),
});
const toolCallSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('create_box'), args: createBoxArgsSchema }),
  z.object({ name: z.literal('create_line'), args: createLineArgsSchema }),
  z.object({ name: z.literal('create_text'), args: createTextArgsSchema }),
  z.object({ name: z.literal('update_element'), args: updateElementArgsSchema }),
  z.object({ name: z.literal('delete_element'), args: deleteElementArgsSchema }),
  z.object({ name: z.literal('clear_board'), args: z.object({}) }),
  z.object({ name: z.literal('anchor_line_endpoint'), args: anchorLineEndpointArgsSchema }),
]);

const app = express();
const port = Number(process.env.PORT ?? 4000);

let board: Board = {
  elements: [],
  updatedAt: new Date().toISOString(),
};

const history: Array<{ id: number; at: string; description: string; elementCount: number }> = [
  {
    id: 1,
    at: board.updatedAt,
    description: 'Created an empty Glyph board.',
    elementCount: 0,
  },
];

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/', (_request, response) => {
  response
    .type('html')
    .send('<p>Glyph API is running. Open <a href="http://localhost:5173/">http://localhost:5173/</a> for the whiteboard.</p>');
});

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    cerebrasConfigured: Boolean(process.env.CEREBRAS_API_KEY),
  });
});

app.get('/api/board', (_request, response) => {
  response.json(board);
});

app.put('/api/board', async (request, response) => {
  const parsed = commitSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid board payload', details: parsed.error.flatten() });
    return;
  }

  board = {
    elements: parsed.data.elements,
    updatedAt: parsed.data.updatedAt,
  };
  const description = await summarizeCommittedChange(parsed.data.change, board);
  history.unshift({
    id: history.length + 1,
    at: board.updatedAt,
    description,
    elementCount: board.elements.length,
  });

  response.json({ ok: true, board, history });
});

app.post('/api/board/clear', (_request, response) => {
  board = {
    elements: [],
    updatedAt: new Date().toISOString(),
  };
  history.unshift({
    id: history.length + 1,
    at: board.updatedAt,
    description: 'Cleared the board.',
    elementCount: 0,
  });

  response.json({ ok: true, board, history });
});

app.get('/api/history', (_request, response) => {
  response.json({ history });
});

app.get('/api/tools', (_request, response) => {
  response.json({ tools: toolDefinitions });
});

app.post('/api/tools/execute', async (request, response) => {
  const parsed = toolCallSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid tool call', details: parsed.error.flatten() });
    return;
  }

  const before = board;
  let nextBoard: Board;
  let diff: ReturnType<typeof graphDiff>;

  try {
    const nextElements = applyToolCall(board.elements, parsed.data);
    nextBoard = boardSchema.parse({
      elements: nextElements,
      updatedAt: new Date().toISOString(),
    });
    diff = graphDiff(before.elements, nextBoard.elements);
    board = nextBoard;
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Tool call failed' });
    return;
  }

  const description = await summarizeCommittedChange(
    {
      before,
      after: nextBoard,
      beforeScreenshot: null,
      afterScreenshot: null,
    },
    board,
  );
  history.unshift({
    id: history.length + 1,
    at: board.updatedAt,
    description,
    elementCount: board.elements.length,
  });

  response.json({ ok: true, board, diff, history });
});

app.post('/api/ai/turn', (_request, response) => {
  response.status(501).json({
    error: 'Cerebras integration is planned but not implemented yet.',
    model: 'gemma-4-31b',
  });
});

app.listen(port, () => {
  console.log(`Glyph server listening on http://localhost:${port}`);
});

async function summarizeCommittedChange(change: CommitContext, currentBoard: Board) {
  if (!process.env.CEREBRAS_API_KEY || !change) {
    return fallbackChangeDescription(change, currentBoard);
  }

  try {
    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gemma-4-31b',
        temperature: 0.1,
        max_tokens: 16,
        messages: [
          {
            role: 'system',
            content:
              'You label whiteboard edit history. Return only a concise 2 to 5 word description of the committed change. No punctuation.',
          },
          {
            role: 'user',
            content: commitMessageContent(change),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Cerebras request failed with ${response.status}`);
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = result.choices?.[0]?.message?.content ?? '';
    return normalizeHistoryLabel(raw) || fallbackChangeDescription(change, currentBoard);
  } catch (error) {
    console.warn('History summary request failed:', error);
    return fallbackChangeDescription(change, currentBoard);
  }
}

function commitMessageContent(change: NonNullable<CommitContext>) {
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [
    {
      type: 'text',
      text: `Return a 2 to 5 word label for this whiteboard edit.\n\nSerialized state before:\n${JSON.stringify(
        change.before.elements,
        null,
        2,
      )}\n\nSerialized state after:\n${JSON.stringify(change.after.elements, null, 2)}`,
    },
  ];

  if (change.beforeScreenshot) {
    content.push({ type: 'text', text: 'Screenshot before:' });
    content.push({ type: 'image_url', image_url: { url: change.beforeScreenshot } });
  }

  if (change.afterScreenshot) {
    content.push({ type: 'text', text: 'Screenshot after:' });
    content.push({ type: 'image_url', image_url: { url: change.afterScreenshot } });
  }

  return content;
}

function normalizeHistoryLabel(label: string) {
  return label
    .replace(/["'.!?]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}

function fallbackChangeDescription(change: CommitContext, currentBoard: Board) {
  if (!change) {
    return `Committed ${currentBoard.elements.length} whiteboard element${currentBoard.elements.length === 1 ? '' : 's'}`;
  }

  const beforeIds = new Set(change.before.elements.map((element) => element.id));
  const afterIds = new Set(change.after.elements.map((element) => element.id));
  const added = change.after.elements.find((element) => !beforeIds.has(element.id));
  const removed = change.before.elements.find((element) => !afterIds.has(element.id));

  if (added) return `Added ${added.type}`;
  if (removed) return `Deleted ${removed.type}`;
  if (change.before.elements.length === 0 && change.after.elements.length === 0) return 'Updated empty board';
  return 'Updated whiteboard';
}

function applyToolCall(elements: WhiteboardElement[], toolCall: z.infer<typeof toolCallSchema>) {
  switch (toolCall.name) {
    case 'create_box':
      return [...elements, { id: nextElementId(elements), type: 'box' as const, ...toolCall.args }];
    case 'create_line':
      return [...elements, { id: nextElementId(elements), type: 'line' as const, ...toolCall.args }];
    case 'create_text':
      return [...elements, { id: nextElementId(elements), type: 'text' as const, ...toolCall.args }];
    case 'update_element':
      return elements.map((element) => {
        if (element.id !== toolCall.args.id) return element;
        return elementSchema.parse({
          ...element,
          ...toolCall.args.patch,
          id: element.id,
          type: element.type,
        });
      });
    case 'delete_element':
      return elements.filter((element) => element.id !== toolCall.args.id);
    case 'clear_board':
      return [];
    case 'anchor_line_endpoint':
      return elements.map((element) => {
        if (element.type !== 'line' || element.id !== toolCall.args.lineId) return element;
        const anchor = toolCall.args.anchor ?? undefined;
        const point = anchor ? pointForAnchor(elements, anchor) : toolCall.args.point;

        if (!anchor && !point) {
          throw new Error('Unanchored line endpoints require a point');
        }

        return lineSchema.parse({
          ...element,
          [`${toolCall.args.endpoint}Anchor`]: anchor,
          [toolCall.args.endpoint]: point ?? element[toolCall.args.endpoint],
        });
      });
  }
}

function nextElementId(elements: WhiteboardElement[]) {
  return elements.reduce((maxId, element) => Math.max(maxId, element.id), 0) + 1;
}

function pointForAnchor(elements: WhiteboardElement[], anchor: z.infer<typeof anchorSchema>) {
  const box = elements.find((element): element is BoxElement => element.type === 'box' && element.id === anchor.elementId);
  if (!box) {
    throw new Error(`Anchor target ${anchor.elementId} does not exist`);
  }

  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  switch (anchor.side) {
    case 'top':
      return { x: center.x, y: box.y };
    case 'right':
      return { x: box.x + box.width, y: center.y };
    case 'bottom':
      return { x: center.x, y: box.y + box.height };
    case 'left':
      return { x: box.x, y: center.y };
    case 'center':
      return center;
  }
}

function graphDiff(before: WhiteboardElement[], after: WhiteboardElement[]) {
  const beforeById = new Map(before.map((element) => [element.id, element]));
  const afterById = new Map(after.map((element) => [element.id, element]));

  return {
    added: after.filter((element) => !beforeById.has(element.id)).map((element) => element.id),
    removed: before.filter((element) => !afterById.has(element.id)).map((element) => element.id),
    updated: after
      .filter((element) => {
        const previous = beforeById.get(element.id);
        return previous && JSON.stringify(previous) !== JSON.stringify(element);
      })
      .map((element) => element.id),
  };
}

const anchorParameterSchema = {
  type: 'object',
  properties: {
    elementId: { type: 'number' },
    side: { type: 'string', enum: ['top', 'right', 'bottom', 'left', 'center'] },
  },
  required: ['elementId', 'side'],
};

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'create_box',
      description: 'Create a rectangle, oval, or cloud box on the whiteboard.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          shape: { type: 'string', enum: ['rectangle', 'oval', 'cloud'] },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          style: { type: 'object' },
        },
        required: ['shape', 'x', 'y', 'width', 'height'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_line',
      description: 'Create a line, arrow, or double arrow, optionally anchored to boxes.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          lineStyle: { type: 'string', enum: ['plain', 'arrow', 'doubleArrow'] },
          start: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
          end: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
          startAnchor: anchorParameterSchema,
          endAnchor: anchorParameterSchema,
          style: { type: 'object' },
        },
        required: ['lineStyle', 'start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_text',
      description: 'Create a floating text object.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          style: { type: 'object' },
        },
        required: ['text', 'x', 'y', 'width'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_element',
      description: 'Update geometry, labels, text, shape, line style, anchors, or style for an existing element.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          patch: { type: 'object' },
        },
        required: ['id', 'patch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_element',
      description: 'Delete one whiteboard element.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_board',
      description: 'Delete all whiteboard elements.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'anchor_line_endpoint',
      description: 'Anchor or unanchor one endpoint of a line.',
      parameters: {
        type: 'object',
        properties: {
          lineId: { type: 'number' },
          endpoint: { type: 'string', enum: ['start', 'end'] },
          anchor: anchorParameterSchema,
          point: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        },
        required: ['lineId', 'endpoint'],
      },
    },
  },
];
