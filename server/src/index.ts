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
  style: styleSchema.optional(),
});

const elementSchema = z.discriminatedUnion('type', [boxSchema, lineSchema, textSchema]);
const boardSchema = z.object({
  elements: z.array(elementSchema),
  updatedAt: z.string(),
});

type Board = z.infer<typeof boardSchema>;

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
app.use(express.json({ limit: '15mb' }));

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    cerebrasConfigured: Boolean(process.env.CEREBRAS_API_KEY),
  });
});

app.get('/api/board', (_request, response) => {
  response.json(board);
});

app.put('/api/board', (request, response) => {
  const parsed = boardSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid board payload', details: parsed.error.flatten() });
    return;
  }

  board = parsed.data;
  history.unshift({
    id: history.length + 1,
    at: board.updatedAt,
    description: `Committed ${board.elements.length} whiteboard element${board.elements.length === 1 ? '' : 's'}.`,
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
