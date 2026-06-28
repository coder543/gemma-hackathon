import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode, RefObject } from 'react'
import html2canvas from 'html2canvas'
import {
  Box,
  Button,
  ButtonGroup,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Camera,
  Eraser,
  MousePointer2,
  PenLine,
  Square,
  Trash2,
  Type,
} from 'lucide-react'
import './App.css'

type Point = { x: number; y: number }
type AnchorSide = 'top' | 'right' | 'bottom' | 'left' | 'center'
type Anchor = { elementId: number; side: AnchorSide }
type ElementStyle = {
  stroke?: string
  fill?: string
  strokeWidth?: number
  fontSize?: number
}

type BoxElement = {
  id: number
  type: 'box'
  label?: string
  shape: 'rectangle' | 'oval' | 'cloud'
  x: number
  y: number
  width: number
  height: number
  style?: ElementStyle
}

type LineElement = {
  id: number
  type: 'line'
  label?: string
  lineStyle: 'plain' | 'arrow' | 'doubleArrow'
  start: Point
  end: Point
  startAnchor?: Anchor
  endAnchor?: Anchor
  style?: ElementStyle
}

type TextElement = {
  id: number
  type: 'text'
  text: string
  x: number
  y: number
  width: number
  style?: ElementStyle
}

type WhiteboardElement = BoxElement | LineElement | TextElement
type Board = { elements: WhiteboardElement[]; updatedAt: string }
type Tool = 'select' | 'line' | 'box' | 'text' | 'erase'
type HistoryEntry = { id: number; at: string; description: string; elementCount: number }
type Draft = { tool: 'line' | 'box'; start: Point; current: Point; startAnchor?: Anchor }
type Drag = { id: number; origin: Point; element: WhiteboardElement }
type InlineEdit = { id: number; value: string }

const defaultBoard: Board = { elements: [], updatedAt: new Date().toISOString() }
const colors = ['#1f2937', '#2563eb', '#e11d48', '#16a34a', '#f59e0b']

function App() {
  const [board, setBoard] = useState<Board>(defaultBoard)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [boxShape, setBoxShape] = useState<BoxElement['shape']>('rectangle')
  const [lineStyle, setLineStyle] = useState<LineElement['lineStyle']>('plain')
  const [stroke, setStroke] = useState(colors[0])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)

  const selected = useMemo(
    () => board.elements.find((element) => element.id === selectedId) ?? null,
    [board.elements, selectedId],
  )

  useEffect(() => {
    void Promise.all([
      fetch('/api/board').then((response) => response.json()),
      fetch('/api/history').then((response) => response.json()),
    ]).then(([nextBoard, nextHistory]) => {
      setBoard(nextBoard)
      setHistory(nextHistory.history)
    })
  }, [])

  const commitBoard = useCallback(async (elements: WhiteboardElement[]) => {
    const nextBoard = { elements, updatedAt: new Date().toISOString() }
    setBoard(nextBoard)
    const response = await fetch('/api/board', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextBoard),
    })
    const result = await response.json()
    setHistory(result.history)
  }, [])

  const nextId = useMemo(
    () => board.elements.reduce((maxId, element) => Math.max(maxId, element.id), 0) + 1,
    [board.elements],
  )

  const pointFromSvgEvent = (event: PointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const pointFromElementEvent = (event: PointerEvent<SVGGElement>): Point => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const commitSelectedPatch = (patch: Partial<BoxElement> | Partial<LineElement> | Partial<TextElement>) => {
    if (selectedId === null) return
    void commitBoard(
      board.elements.map((element) =>
        element.id === selectedId ? ({ ...element, ...patch } as WhiteboardElement) : element,
      ),
    )
  }

  const startLineDraft = (point: Point, startAnchor?: Anchor, svg?: SVGSVGElement | null, pointerId?: number) => {
    setSelectedId(null)
    setInlineEdit(null)
    setDraft({ tool: 'line', start: point, current: point, startAnchor })
    if (svg && pointerId !== undefined) {
      svg.setPointerCapture(pointerId)
    }
  }

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return
    const point = pointFromSvgEvent(event)
    setSelectedId(null)
    setInlineEdit(null)

    if (tool === 'line' || tool === 'box') {
      setDraft({ tool, start: point, current: point })
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    if (tool === 'text') {
      const text = window.prompt('Text')
      if (!text) return
      void commitBoard([
        ...board.elements,
        {
          id: nextId,
          type: 'text',
          text,
          x: point.x,
          y: point.y,
          width: 180,
          style: { stroke, fontSize: 18 },
        },
      ])
      setSelectedId(nextId)
      setTool('select')
    }
  }

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const point = pointFromSvgEvent(event)
    if (draft) {
      setDraft({ ...draft, current: point })
      return
    }

    if (drag) {
      const dx = point.x - drag.origin.x
      const dy = point.y - drag.origin.y
      setBoard((current) => ({
        ...current,
        elements: current.elements.map((element) => moveElement(element, drag, dx, dy)),
      }))
    }
  }

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const point = pointFromSvgEvent(event)

    if (draft) {
      const current = point
      const width = Math.abs(current.x - draft.start.x)
      const height = Math.abs(current.y - draft.start.y)
      if (draft.tool === 'box' && width > 8 && height > 8) {
        const element: BoxElement = {
          id: nextId,
          type: 'box',
          shape: boxShape,
          label: 'Label',
          x: Math.min(draft.start.x, current.x),
          y: Math.min(draft.start.y, current.y),
          width,
          height,
          style: { stroke, fill: '#ffffff', strokeWidth: 2 },
        }
        void commitBoard([...board.elements, element])
        setSelectedId(element.id)
      }
      if (draft.tool === 'line' && (width > 8 || height > 8)) {
        const endAnchor = anchorAtPoint(board.elements, current)
        const end = endAnchor ? pointForAnchor(board.elements, endAnchor) : current
        const element: LineElement = {
          id: nextId,
          type: 'line',
          lineStyle,
          start: draft.start,
          end,
          startAnchor: draft.startAnchor,
          endAnchor,
          style: { stroke, strokeWidth: 2 },
        }
        void commitBoard([...board.elements, element])
        setSelectedId(element.id)
      }
      setDraft(null)
      setTool('select')
    }

    if (drag) {
      const dx = point.x - drag.origin.x
      const dy = point.y - drag.origin.y
      const finalElements = board.elements.map((element) => moveElement(element, drag, dx, dy))
      void commitBoard(finalElements)
      setDrag(null)
    }
  }

  const handleElementPointerDown = (element: WhiteboardElement, event: PointerEvent<SVGGElement>) => {
    event.stopPropagation()
    setInlineEdit(null)

    if (tool === 'erase') {
      void commitBoard(board.elements.filter((candidate) => candidate.id !== element.id))
      setSelectedId(null)
      return
    }

    if (tool === 'line') {
      const point = pointFromElementEvent(event)
      const startAnchor = element.type === 'box' ? anchorForBoxPoint(element, point) : undefined
      startLineDraft(
        startAnchor ? pointForAnchor(board.elements, startAnchor) : point,
        startAnchor,
        event.currentTarget.ownerSVGElement,
        event.pointerId,
      )
      return
    }

    if (tool !== 'select') return

    setSelectedId(element.id)
    setDrag({ id: element.id, origin: pointFromElementEvent(event), element })
  }

  const startInlineEdit = (element: WhiteboardElement, event: MouseEvent<SVGGElement>) => {
    event.stopPropagation()
    setTool('select')
    setSelectedId(element.id)
    setDrag(null)
    setDraft(null)
    setInlineEdit({ id: element.id, value: editableText(element) })
  }

  const finishInlineEdit = (commit: boolean) => {
    if (!inlineEdit) return
    const element = board.elements.find((candidate) => candidate.id === inlineEdit.id)
    setInlineEdit(null)
    if (!commit || !element || editableText(element) === inlineEdit.value) return
    const patch = element.type === 'text' ? { text: inlineEdit.value } : { label: inlineEdit.value }
    void commitBoard(
      board.elements.map((candidate) =>
        candidate.id === inlineEdit.id ? ({ ...candidate, ...patch } as WhiteboardElement) : candidate,
      ),
    )
  }

  const clearBoard = async () => {
    const response = await fetch('/api/board/clear', { method: 'POST' })
    const result = await response.json()
    setBoard(result.board)
    setHistory(result.history)
    setSelectedId(null)
    setInlineEdit(null)
  }

  const captureScreenshot = async () => {
    if (!boardRef.current) return
    const canvas = await html2canvas(boardRef.current, { backgroundColor: '#f8fafc' })
    setScreenshot(canvas.toDataURL('image/png'))
  }

  return (
    <Box className="app-shell">
      <Paper className="topbar" elevation={0}>
        <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1.5}>
          <Typography variant="h5" className="brand">Glyph</Typography>
          <ButtonGroup variant="outlined" size="small">
            <ToolButton active={tool === 'select'} label="Select" onClick={() => setTool('select')} icon={<MousePointer2 size={17} />} />
            <ToolButton active={tool === 'line'} label="Line" onClick={() => setTool('line')} icon={<PenLine size={17} />} />
            <ToolButton active={tool === 'box'} label="Box" onClick={() => setTool('box')} icon={<Square size={17} />} />
            <ToolButton active={tool === 'text'} label="Text" onClick={() => setTool('text')} icon={<Type size={17} />} />
            <ToolButton active={tool === 'erase'} label="Erase" onClick={() => setTool('erase')} icon={<Eraser size={17} />} />
          </ButtonGroup>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <ButtonGroup size="small" variant="outlined">
            {colors.map((color) => (
              <Tooltip title={color} key={color}>
                <IconButton className={stroke === color ? 'swatch active' : 'swatch'} onClick={() => setStroke(color)}>
                  <span style={{ backgroundColor: color }} />
                </IconButton>
              </Tooltip>
            ))}
          </ButtonGroup>
          <Tooltip title="Capture board screenshot">
            <IconButton onClick={captureScreenshot}><Camera size={18} /></IconButton>
          </Tooltip>
          <Tooltip title="Clear board">
            <IconButton onClick={clearBoard}><Trash2 size={18} /></IconButton>
          </Tooltip>
        </Stack>
      </Paper>

      <Box className="workspace">
        <Paper className="left-panel" elevation={0}>
          <Typography variant="overline">Tool Options</Typography>
          <FormControl size="small" fullWidth>
            <InputLabel>Box</InputLabel>
            <Select label="Box" value={boxShape} onChange={(event) => setBoxShape(event.target.value as BoxElement['shape'])}>
              <MenuItem value="rectangle">Rectangle</MenuItem>
              <MenuItem value="oval">Oval</MenuItem>
              <MenuItem value="cloud">Cloud</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>Line</InputLabel>
            <Select label="Line" value={lineStyle} onChange={(event) => setLineStyle(event.target.value as LineElement['lineStyle'])}>
              <MenuItem value="plain">Plain</MenuItem>
              <MenuItem value="arrow">Arrow</MenuItem>
              <MenuItem value="doubleArrow">Double arrow</MenuItem>
            </Select>
          </FormControl>
          <Divider />
          <Typography variant="overline">Selected</Typography>
          {selected ? <Inspector element={selected} onCommit={commitSelectedPatch} /> : <Typography color="text.secondary">No element selected.</Typography>}
        </Paper>

        <Box className="board-wrap" ref={boardRef}>
          <svg
            className="board"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {board.elements.map((element) => (
              <ElementView
                key={element.id}
                element={element}
                elements={board.elements}
                selected={element.id === selectedId}
                editing={inlineEdit?.id === element.id}
                onPointerDown={(event) => handleElementPointerDown(element, event)}
                onDoubleClick={(event) => startInlineEdit(element, event)}
              />
            ))}
            {inlineEdit && selected && (
              <InlineEditor
                element={selected}
                elements={board.elements}
                value={inlineEdit.value}
                onChange={(value) => setInlineEdit({ ...inlineEdit, value })}
                onCommit={() => finishInlineEdit(true)}
                onCancel={() => finishInlineEdit(false)}
              />
            )}
            {draft && <DraftView draft={draft} elements={board.elements} stroke={stroke} boxShape={boxShape} lineStyle={lineStyle} />}
          </svg>
        </Box>

        <Paper className="right-panel" elevation={0}>
          <Typography variant="overline">History</Typography>
          <Stack spacing={1} className="history-list">
            {history.map((entry) => (
              <Box key={entry.id} className="history-entry">
                <Typography variant="body2">{entry.description}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(entry.at).toLocaleTimeString()} - {entry.elementCount} objects
                </Typography>
              </Box>
            ))}
          </Stack>
          <Divider />
          <Typography variant="overline">LLM State</Typography>
          <pre className="json-preview">{JSON.stringify(board.elements, null, 2)}</pre>
          {screenshot && <img className="screenshot-preview" src={screenshot} alt="Latest whiteboard screenshot" />}
        </Paper>
      </Box>
    </Box>
  )
}

function editableText(element: WhiteboardElement) {
  return element.type === 'text' ? element.text : (element.label ?? '')
}

function moveElement(element: WhiteboardElement, drag: Drag, dx: number, dy: number): WhiteboardElement {
  if (element.id !== drag.id) return element
  if (drag.element.type === 'line') {
    const start = drag.element.startAnchor ? drag.element.start : { x: drag.element.start.x + dx, y: drag.element.start.y + dy }
    const end = drag.element.endAnchor ? drag.element.end : { x: drag.element.end.x + dx, y: drag.element.end.y + dy }
    return { ...drag.element, start, end }
  }
  return { ...drag.element, x: drag.element.x + dx, y: drag.element.y + dy }
}

function boxAtPoint(elements: WhiteboardElement[], point: Point): BoxElement | undefined {
  return elements
    .filter((element): element is BoxElement => element.type === 'box')
    .toReversed()
    .find((box) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height)
}

function anchorAtPoint(elements: WhiteboardElement[], point: Point): Anchor | undefined {
  const box = boxAtPoint(elements, point)
  return box ? anchorForBoxPoint(box, point) : undefined
}

function anchorForBoxPoint(box: BoxElement, point: Point): Anchor {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const dx = (point.x - center.x) / Math.max(box.width, 1)
  const dy = (point.y - center.y) / Math.max(box.height, 1)
  const side: AnchorSide = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
  return { elementId: box.id, side }
}

function pointForAnchor(elements: WhiteboardElement[], anchor: Anchor): Point {
  const box = elements.find((element): element is BoxElement => element.type === 'box' && element.id === anchor.elementId)
  if (!box) return { x: 0, y: 0 }
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  switch (anchor.side) {
    case 'top':
      return { x: center.x, y: box.y }
    case 'right':
      return { x: box.x + box.width, y: center.y }
    case 'bottom':
      return { x: center.x, y: box.y + box.height }
    case 'left':
      return { x: box.x, y: center.y }
    case 'center':
      return center
  }
}

function linePoints(line: LineElement, elements: WhiteboardElement[]) {
  return {
    start: line.startAnchor ? pointForAnchor(elements, line.startAnchor) : line.start,
    end: line.endAnchor ? pointForAnchor(elements, line.endAnchor) : line.end,
  }
}

function ToolButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip title={label}>
      <Button className={active ? 'tool-active' : ''} onClick={onClick} aria-label={label}>
        {icon}
      </Button>
    </Tooltip>
  )
}

function Inspector({ element, onCommit }: { element: WhiteboardElement; onCommit: (patch: Partial<WhiteboardElement>) => void }) {
  const [values, setValues] = useState(() => inspectorValues(element))

  useEffect(() => {
    setValues(inspectorValues(element))
  }, [element])

  const commit = (field: string) => {
    const initial = inspectorValues(element)
    if (values[field] === initial[field]) return
    const rawValue = values[field]
    const value = field === 'width' || field === 'height' ? Number(rawValue) : rawValue
    onCommit({ [field]: value } as Partial<WhiteboardElement>)
  }

  const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.currentTarget.blur()
  }

  if (element.type === 'box') {
    return (
      <Stack spacing={1.5}>
        <TextField label="Label" size="small" value={values.label} onChange={(event) => setValues({ ...values, label: event.target.value })} onBlur={() => commit('label')} onKeyDown={blurOnEnter} />
        <TextField label="Width" size="small" type="number" value={values.width} onChange={(event) => setValues({ ...values, width: event.target.value })} onBlur={() => commit('width')} onKeyDown={blurOnEnter} />
        <TextField label="Height" size="small" type="number" value={values.height} onChange={(event) => setValues({ ...values, height: event.target.value })} onBlur={() => commit('height')} onKeyDown={blurOnEnter} />
      </Stack>
    )
  }
  if (element.type === 'text') {
    return (
      <Stack spacing={1.5}>
        <TextField label="Text" size="small" multiline minRows={3} value={values.text} onChange={(event) => setValues({ ...values, text: event.target.value })} onBlur={() => commit('text')} />
        <TextField label="Width" size="small" type="number" value={values.width} onChange={(event) => setValues({ ...values, width: event.target.value })} onBlur={() => commit('width')} onKeyDown={blurOnEnter} />
      </Stack>
    )
  }
  return (
    <Stack spacing={1.5}>
      <TextField label="Label" size="small" value={values.label} onChange={(event) => setValues({ ...values, label: event.target.value })} onBlur={() => commit('label')} onKeyDown={blurOnEnter} />
      <Typography variant="caption" color="text.secondary">Double-click the line label to edit inline. Anchored endpoints follow their boxes.</Typography>
    </Stack>
  )
}

function inspectorValues(element: WhiteboardElement): Record<string, string> {
  if (element.type === 'box') {
    return { label: element.label ?? '', width: String(Math.round(element.width)), height: String(Math.round(element.height)) }
  }
  if (element.type === 'text') {
    return { text: element.text, width: String(Math.round(element.width)) }
  }
  return { label: element.label ?? '' }
}

function ElementView({
  element,
  elements,
  selected,
  editing,
  onPointerDown,
  onDoubleClick,
}: {
  element: WhiteboardElement
  elements: WhiteboardElement[]
  selected: boolean
  editing: boolean
  onPointerDown: (event: PointerEvent<SVGGElement>) => void
  onDoubleClick: (event: MouseEvent<SVGGElement>) => void
}) {
  const stroke = element.style?.stroke ?? '#1f2937'
  const strokeWidth = element.style?.strokeWidth ?? 2
  if (element.type === 'box') {
    return (
      <g onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} className={selected ? 'element selected' : 'element'}>
        {element.shape === 'oval' ? (
          <ellipse cx={element.x + element.width / 2} cy={element.y + element.height / 2} rx={element.width / 2} ry={element.height / 2} fill={element.style?.fill ?? '#fff'} stroke={stroke} strokeWidth={strokeWidth} />
        ) : (
          <rect x={element.x} y={element.y} width={element.width} height={element.height} rx={element.shape === 'cloud' ? 22 : 4} fill={element.style?.fill ?? '#fff'} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={element.shape === 'cloud' ? '8 5' : undefined} />
        )}
        {element.label && !editing && <text x={element.x + element.width / 2} y={element.y + element.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize="16" fill="#111827">{element.label}</text>}
      </g>
    )
  }
  if (element.type === 'line') {
    const points = linePoints(element, elements)
    return (
      <g onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} className={selected ? 'element selected' : 'element'}>
        <line x1={points.start.x} y1={points.start.y} x2={points.end.x} y2={points.end.y} stroke={stroke} strokeWidth={strokeWidth} markerEnd={element.lineStyle === 'arrow' || element.lineStyle === 'doubleArrow' ? 'url(#arrow)' : undefined} markerStart={element.lineStyle === 'doubleArrow' ? 'url(#arrow)' : undefined} />
        {element.label && !editing && <text x={(points.start.x + points.end.x) / 2} y={(points.start.y + points.end.y) / 2 - 8} textAnchor="middle" fontSize="14" fill="#111827">{element.label}</text>}
      </g>
    )
  }
  return (
    <g onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} className={selected ? 'element selected' : 'element'}>
      {!editing && (
        <foreignObject x={element.x} y={element.y} width={element.width} height="120">
          <div className="text-node" style={{ color: element.style?.stroke, fontSize: element.style?.fontSize }}>{element.text}</div>
        </foreignObject>
      )}
    </g>
  )
}

function InlineEditor({
  element,
  elements,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  element: WhiteboardElement
  elements: WhiteboardElement[]
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      onCancel()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  const placement = editorPlacement(element, elements)
  const isText = element.type === 'text'

  return (
    <foreignObject x={placement.x} y={placement.y} width={placement.width} height={placement.height}>
      {isText ? (
        <textarea
          ref={inputRef as RefObject<HTMLTextAreaElement>}
          className="inline-editor textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <input
          ref={inputRef as RefObject<HTMLInputElement>}
          className="inline-editor"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKeyDown}
        />
      )}
    </foreignObject>
  )
}

function editorPlacement(element: WhiteboardElement, elements: WhiteboardElement[]) {
  if (element.type === 'box') {
    return {
      x: element.x + 12,
      y: element.y + element.height / 2 - 18,
      width: Math.max(72, element.width - 24),
      height: 38,
    }
  }
  if (element.type === 'line') {
    const points = linePoints(element, elements)
    return {
      x: (points.start.x + points.end.x) / 2 - 90,
      y: (points.start.y + points.end.y) / 2 - 30,
      width: 180,
      height: 38,
    }
  }
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: 120,
  }
}

function DraftView({
  draft,
  elements,
  stroke,
  boxShape,
  lineStyle,
}: {
  draft: Draft
  elements: WhiteboardElement[]
  stroke: string
  boxShape: BoxElement['shape']
  lineStyle: LineElement['lineStyle']
}) {
  if (draft.tool === 'line') {
    const start = draft.startAnchor ? pointForAnchor(elements, draft.startAnchor) : draft.start
    return <line x1={start.x} y1={start.y} x2={draft.current.x} y2={draft.current.y} stroke={stroke} strokeWidth="2" strokeDasharray="6 5" markerEnd={lineStyle === 'arrow' || lineStyle === 'doubleArrow' ? 'url(#arrow)' : undefined} markerStart={lineStyle === 'doubleArrow' ? 'url(#arrow)' : undefined} />
  }
  const x = Math.min(draft.start.x, draft.current.x)
  const y = Math.min(draft.start.y, draft.current.y)
  const width = Math.abs(draft.current.x - draft.start.x)
  const height = Math.abs(draft.current.y - draft.start.y)
  if (boxShape === 'oval') {
    return <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} fill="#fff" stroke={stroke} strokeWidth="2" strokeDasharray="6 5" />
  }
  return <rect x={x} y={y} width={width} height={height} rx={boxShape === 'cloud' ? 22 : 4} fill="#fff" stroke={stroke} strokeWidth="2" strokeDasharray={boxShape === 'cloud' ? '8 5' : '6 5'} />
}

export default App
