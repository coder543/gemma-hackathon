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
