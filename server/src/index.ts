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

const svgAttemptSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const imageSchema = z.object({
  id: z.number(),
  type: z.literal('image'),
  description: z.string(),
  svg: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  renderAttempts: z.array(svgAttemptSchema).optional(),
});

const elementSchema = z.discriminatedUnion('type', [boxSchema, lineSchema, textSchema, imageSchema]);
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
type ImageElement = z.infer<typeof imageSchema>;
type AnchorableElement = BoxElement | ImageElement;
type SvgAttempt = z.infer<typeof svgAttemptSchema>;

const createBoxArgsSchema = boxSchema.omit({ id: true, type: true });
const createLineArgsSchema = lineSchema.omit({ id: true, type: true });
const createTextArgsSchema = textSchema.omit({ id: true, type: true });
const createImageArgsSchema = imageSchema.omit({ id: true, type: true });
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
  z.object({ name: z.literal('create_image'), args: createImageArgsSchema }),
  z.object({ name: z.literal('update_element'), args: updateElementArgsSchema }),
  z.object({ name: z.literal('delete_element'), args: deleteElementArgsSchema }),
  z.object({ name: z.literal('clear_board'), args: z.object({}) }),
  z.object({ name: z.literal('anchor_line_endpoint'), args: anchorLineEndpointArgsSchema }),
]);

const generateImageSvgSchema = z.object({
  description: z.string().min(1),
});

const repairImageSvgSchema = z.object({
  description: z.string().min(1),
  svg: z.string(),
  error: z.string(),
  renderAttempts: z.array(svgAttemptSchema).optional(),
});

const refineImageSvgSchema = z.object({
  description: z.string().min(1),
  svg: z.string(),
  instruction: z.string().min(1),
  renderAttempts: z.array(svgAttemptSchema).optional(),
});

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

app.post('/api/ai/image-svg', async (request, response) => {
  const parsed = generateImageSvgSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid image description', details: parsed.error.flatten() });
    return;
  }

  const result = await generateImageSvg(parsed.data.description);
  response.json(result);
});

app.post('/api/ai/image-svg/repair', async (request, response) => {
  const parsed = repairImageSvgSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid SVG repair payload', details: parsed.error.flatten() });
    return;
  }

  const result = await repairImageSvg(parsed.data);
  response.json(result);
});

app.post('/api/ai/image-svg/refine', async (request, response) => {
  const parsed = refineImageSvgSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid SVG refine payload', details: parsed.error.flatten() });
    return;
  }

  const result = await refineImageSvg(parsed.data);
  response.json(result);
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

async function generateImageSvg(description: string) {
  const attempts: SvgAttempt[] = [
    {
      role: 'user' as const,
      content: imageSvgPrompt(description),
    },
  ];

  const svg = process.env.CEREBRAS_API_KEY
    ? await requestSvgFromCerebras(attempts)
    : fallbackSvg(description);

  attempts.push({ role: 'assistant' as const, content: svg });
  return { svg, renderAttempts: attempts };
}

async function repairImageSvg(payload: z.infer<typeof repairImageSvgSchema>) {
  const attempts: SvgAttempt[] = [
    ...(payload.renderAttempts ?? []),
    {
      role: 'user' as const,
      content: `The previous SVG failed to render.\n\nBrowser/render error:\n${payload.error}\n\nBroken SVG:\n${payload.svg}\n\nReturn a corrected standalone SVG only. Preserve the requested image: ${payload.description}`,
    },
  ];

  const svg = process.env.CEREBRAS_API_KEY
    ? await requestSvgFromCerebras(attempts)
    : fallbackSvg(payload.description);

  attempts.push({ role: 'assistant' as const, content: svg });
  return { svg, renderAttempts: attempts };
}

async function refineImageSvg(payload: z.infer<typeof refineImageSvgSchema>) {
  const attempts: SvgAttempt[] = [
    ...(payload.renderAttempts ?? []),
    {
      role: 'user' as const,
      content: `Refine this SVG image box.\n\nOriginal description:\n${payload.description}\n\nUser refinement instruction:\n${payload.instruction}\n\nCurrent SVG:\n${payload.svg}\n\nReturn an updated standalone SVG only. Preserve useful existing visual structure unless the instruction asks otherwise. Keep or improve subtle animation when appropriate.`,
    },
  ];

  const svg = process.env.CEREBRAS_API_KEY
    ? await requestSvgFromCerebras(attempts)
    : fallbackSvg(`${payload.description} ${payload.instruction}`);

  attempts.push({ role: 'assistant' as const, content: svg });
  return { svg, renderAttempts: attempts };
}

async function requestSvgFromCerebras(attempts: SvgAttempt[]) {
  try {
    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gemma-4-31b',
        temperature: 0.7,
        max_tokens: 2400,
        messages: [
          {
            role: 'system',
            content:
              'You create compact standalone animated SVG illustrations for a whiteboard app. Return only raw SVG markup. No markdown fences, explanations, external assets, scripts, or event handlers. Include at least one subtle declarative animation using inline CSS keyframes or native SVG animate/animateTransform unless the user explicitly asks for a static image.',
          },
          ...attempts.map((attempt) => ({
            role: attempt.role,
            content: attempt.content,
          })),
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Cerebras request failed with ${response.status}`);
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return cleanSvgMarkup(result.choices?.[0]?.message?.content ?? '');
  } catch (error) {
    console.warn('SVG generation request failed:', error);
    return fallbackSvg('Generated image');
  }
}

function imageSvgPrompt(description: string) {
  return `Create an expressive SVG image for this whiteboard image box: ${description}

Requirements:
- Return only a single complete <svg>...</svg> document.
- Include viewBox, width, and height.
- Prefer clean vector shapes and readable composition.
- Include at least one subtle animation with SVG animate/animateTransform or inline CSS keyframes. Good defaults include pulsing glow, drifting detail, blinking indicator, moving dash, or rotating accent.
- Keep animation tasteful and loop smoothly.
- Do not use JavaScript, external references, remote images, or markdown fences.`;
}

function cleanSvgMarkup(markup: string) {
  const withoutFences = markup
    .trim()
    .replace(/^```(?:svg)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = withoutFences.indexOf('<svg');
  const end = withoutFences.lastIndexOf('</svg>');
  if (start === -1 || end === -1) {
    return fallbackSvg('Generated image');
  }
  return withoutFences.slice(start, end + '</svg>'.length);
}

function fallbackSvg(description: string) {
  const escaped = escapeXml(description).slice(0, 120);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
  <style>
    @keyframes pulse { 0%, 100% { opacity: .72; transform: scale(1); } 50% { opacity: 1; transform: scale(1.04); } }
    .orb { transform-origin: 160px 96px; animation: pulse 2.4s ease-in-out infinite; }
  </style>
  <rect width="320" height="220" rx="18" fill="#f8fafc"/>
  <circle class="orb" cx="160" cy="92" r="54" fill="#bfdbfe" stroke="#2563eb" stroke-width="4"/>
  <path d="M114 150c24-18 68-18 92 0" fill="none" stroke="#16a34a" stroke-width="10" stroke-linecap="round"/>
  <text x="160" y="192" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="16" fill="#111827">${escaped}</text>
</svg>`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function applyToolCall(elements: WhiteboardElement[], toolCall: z.infer<typeof toolCallSchema>) {
  switch (toolCall.name) {
    case 'create_box':
      return [...elements, { id: nextElementId(elements), type: 'box' as const, ...toolCall.args }];
    case 'create_line':
      return [...elements, { id: nextElementId(elements), type: 'line' as const, ...toolCall.args }];
    case 'create_text':
      return [...elements, { id: nextElementId(elements), type: 'text' as const, ...toolCall.args }];
    case 'create_image':
      return [...elements, { id: nextElementId(elements), type: 'image' as const, ...toolCall.args }];
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
  const element = elements.find((candidate): candidate is AnchorableElement => isAnchorableElement(candidate) && candidate.id === anchor.elementId);
  if (!element) {
    throw new Error(`Anchor target ${anchor.elementId} does not exist`);
  }

  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  switch (anchor.side) {
    case 'top':
      return { x: center.x, y: element.y };
    case 'right':
      return { x: element.x + element.width, y: center.y };
    case 'bottom':
      return { x: center.x, y: element.y + element.height };
    case 'left':
      return { x: element.x, y: center.y };
    case 'center':
      return center;
  }
}

function isAnchorableElement(element: WhiteboardElement): element is AnchorableElement {
  return element.type === 'box' || element.type === 'image';
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
      description: 'Create a line, arrow, or double arrow, optionally anchored to boxes or image boxes.',
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
      name: 'create_image',
      description: 'Create an AI-generated SVG image box from a description.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          svg: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          renderAttempts: { type: 'array', items: { type: 'object' } },
        },
        required: ['description', 'svg', 'x', 'y', 'width', 'height'],
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
      description: 'Anchor or unanchor one endpoint of a line to a box or image box.',
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
