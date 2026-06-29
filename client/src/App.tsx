import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode, RefObject } from 'react'
import html2canvas from 'html2canvas'
import {
  Box,
  Button,
  ButtonGroup,
  Collapse,
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  ImagePlus,
  MousePointer2,
  PenLine,
  Redo2,
  RefreshCw,
  Send,
  Square,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
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
  height?: number
  style?: ElementStyle
}

type SvgAttempt = {
  role: 'user' | 'assistant'
  content: string
}

type ImageElement = {
  id: number
  type: 'image'
  description: string
  svg: string
  x: number
  y: number
  width: number
  height: number
  renderAttempts?: SvgAttempt[]
}

type WhiteboardElement = BoxElement | LineElement | TextElement | ImageElement
type Board = { elements: WhiteboardElement[]; updatedAt: string }
type Tool = 'select' | 'line' | 'box' | 'text' | 'image' | 'erase'
type HistoryEntry = { id: number; at: string; description: string; elementCount: number }
type HistoryPoint = { board: Board; historyId: number | null }
type ChatMessage = { role: 'user' | 'assistant'; content: string }
type GraphDiff = { added: number[]; removed: number[]; updated: number[] }
type Draft = { tool: 'line' | 'box' | 'image'; start: Point; current: Point; startAnchor?: Anchor }
type Drag = { id: number; origin: Point; element: WhiteboardElement }
type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw'
type Resize = { id: number; origin: Point; element: BoxElement | TextElement | ImageElement; handle: ResizeHandle }
type LineEndpoint = 'start' | 'end'
type EndpointDrag = { id: number; endpoint: LineEndpoint; line: LineElement }
type InlineEdit = { id: number; value: string }

const defaultBoard: Board = { elements: [], updatedAt: new Date().toISOString() }
const colors = ['#1f2937', '#2563eb', '#e11d48', '#16a34a', '#f59e0b']
const anchorSnapDistance = 28
const boardWidth = 1600
const boardHeight = 1000
const minZoom = 0.5
const maxZoom = 2
const zoomStep = 0.1

function App() {
  const [board, setBoard] = useState<Board>(defaultBoard)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [currentHistoryId, setCurrentHistoryId] = useState<number | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [boxShape, setBoxShape] = useState<BoxElement['shape']>('rectangle')
  const [lineStyle, setLineStyle] = useState<LineElement['lineStyle']>('plain')
  const [stroke, setStroke] = useState(colors[0])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [resize, setResize] = useState<Resize | null>(null)
  const [endpointDrag, setEndpointDrag] = useState<EndpointDrag | null>(null)
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [llmStateOpen, setLlmStateOpen] = useState(false)
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  const [boardZoom, setBoardZoom] = useState(1)
  const [undoDepth, setUndoDepth] = useState(0)
  const [redoDepth, setRedoDepth] = useState(0)
  const [repairingImageIds, setRepairingImageIds] = useState<Set<number>>(() => new Set())
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<number>>(() => new Set())
  const chatLogRef = useRef<HTMLDivElement | null>(null)
  const lastCommittedBoardRef = useRef<Board>(defaultBoard)
  const beforeScreenshotRef = useRef<Promise<string | null> | null>(null)
  const undoStackRef = useRef<HistoryPoint[]>([])
  const redoStackRef = useRef<HistoryPoint[]>([])
  const currentHistoryIdRef = useRef<number | null>(null)

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
      lastCommittedBoardRef.current = nextBoard
      setHistory(nextHistory.history)
      const latestHistoryId = nextHistory.history[0]?.id ?? null
      setCurrentHistoryId(latestHistoryId)
      currentHistoryIdRef.current = latestHistoryId
    })
  }, [])

  const commitBoard = useCallback(async (elements: WhiteboardElement[], options: { recordUndo?: boolean; beforeBoard?: Board } = {}) => {
    const beforeBoard = options.beforeBoard ?? lastCommittedBoardRef.current
    if (!elementsChanged(beforeBoard.elements, elements)) {
      beforeScreenshotRef.current = null
      return
    }
    const beforeScreenshot = beforeScreenshotRef.current ? await beforeScreenshotRef.current : await captureBoardScreenshot(beforeBoard.elements)
    beforeScreenshotRef.current = null
    const nextBoard = { elements, updatedAt: new Date().toISOString() }
    setBoard(nextBoard)
    await nextPaint()
    const afterScreenshot = await captureBoardScreenshot(nextBoard.elements)
    const response = await fetch('/api/board', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...nextBoard,
        change: {
          before: beforeBoard,
          after: nextBoard,
          beforeScreenshot,
          afterScreenshot,
        },
        discardHistoryAfterId: currentHistoryIdRef.current,
      }),
    })
    const result = await response.json()
    if (options.recordUndo !== false && boardChanged(beforeBoard, result.board)) {
      undoStackRef.current.push({ board: beforeBoard, historyId: currentHistoryIdRef.current })
      redoStackRef.current = []
      setUndoDepth(undoStackRef.current.length)
      setRedoDepth(redoStackRef.current.length)
    }
    lastCommittedBoardRef.current = result.board
    setHistory(result.history)
    const latestHistoryId = result.history[0]?.id ?? currentHistoryIdRef.current
    setCurrentHistoryId(latestHistoryId)
    currentHistoryIdRef.current = latestHistoryId
  }, [])

  const syncBoardWithoutHistory = useCallback(async (point: HistoryPoint) => {
    const nextBoard = point.board
    setBoard(nextBoard)
    lastCommittedBoardRef.current = nextBoard
    beforeScreenshotRef.current = null
    setSelectedId((current) => nextBoard.elements.some((element) => element.id === current) ? current : null)
    setInlineEdit(null)
    const response = await fetch('/api/board/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextBoard),
    })
    const result = await response.json()
    lastCommittedBoardRef.current = result.board
    setBoard(result.board)
    setHistory(result.history)
    setCurrentHistoryId(point.historyId)
    currentHistoryIdRef.current = point.historyId
  }, [])

  const nextId = useMemo(
    () => board.elements.reduce((maxId, element) => Math.max(maxId, element.id), 0) + 1,
    [board.elements],
  )

  const pointFromSvgEvent = (event: PointerEvent<SVGSVGElement>): Point => {
    return svgPointFromClient(event.currentTarget, event.clientX, event.clientY)
  }

  const pointFromElementEvent = (event: PointerEvent<SVGGElement>): Point => {
    const svg = event.currentTarget.ownerSVGElement
    return svg ? svgPointFromClient(svg, event.clientX, event.clientY) : { x: 0, y: 0 }
  }

  const pointFromOwnedSvgEvent = (event: PointerEvent<SVGElement>): Point => {
    const svg = event.currentTarget.ownerSVGElement
    return svg ? svgPointFromClient(svg, event.clientX, event.clientY) : { x: 0, y: 0 }
  }

  const commitSelectedPatch = (patch: Partial<WhiteboardElement>) => {
    if (selectedId === null) return
    const element = board.elements.find((candidate) => candidate.id === selectedId)
    const nextDescription = 'description' in patch ? patch.description : undefined
    if (element?.type === 'image' && typeof nextDescription === 'string' && nextDescription !== element.description) {
      void regenerateImageDescription(element, nextDescription)
      return
    }

    void commitBoard(board.elements.map((candidate) => (
      candidate.id === selectedId ? ({ ...candidate, ...patch } as WhiteboardElement) : candidate
    )))
  }

  const zoomBoard = (direction: -1 | 1) => {
    setBoardZoom((current) => clampZoom(current + direction * zoomStep))
  }

  const deleteSelectedElement = useCallback(() => {
    if (selectedId === null) return
    const element = board.elements.find((candidate) => candidate.id === selectedId)
    if (!element) return
    captureBeforeSnapshot()
    void commitBoard(board.elements.filter((candidate) => candidate.id !== selectedId))
    setSelectedId(null)
    setInlineEdit(null)
  }, [board.elements, commitBoard, selectedId])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return
      if (inlineEdit) return
      const target = event.target
      if (isEditableEventTarget(target)) return
      if (selectedId === null) return
      event.preventDefault()
      deleteSelectedElement()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelectedElement, inlineEdit, selectedId])

  useEffect(() => {
    if (!chatLogRef.current) return
    chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight
  }, [chatMessages, chatBusy])

  const startLineDraft = (point: Point, startAnchor?: Anchor, svg?: SVGSVGElement | null, pointerId?: number) => {
    captureBeforeSnapshot()
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

    if (tool === 'line' || tool === 'box' || tool === 'image') {
      captureBeforeSnapshot()
      setDraft({ tool, start: point, current: point })
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    if (tool === 'text') {
      const text = window.prompt('Text')
      if (!text) return
      captureBeforeSnapshot()
      void commitBoard([
        ...board.elements,
        {
          id: nextId,
          type: 'text',
          text,
          x: point.x,
          y: point.y,
          width: 180,
          height: 120,
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

    if (endpointDrag) {
      setBoard((current) => ({
        ...current,
        elements: current.elements.map((element) => moveLineEndpoint(element, endpointDrag, point)),
      }))
      return
    }

    if (resize) {
      const dx = point.x - resize.origin.x
      const dy = point.y - resize.origin.y
      setBoard((current) => ({
        ...current,
        elements: current.elements.map((element) => resizeElement(element, resize, dx, dy)),
      }))
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
      if (draft.tool === 'image' && width > 8 && height > 8) {
        const description = window.prompt('Describe the image')
        if (description) {
          void createImageElement(description, {
            x: Math.min(draft.start.x, current.x),
            y: Math.min(draft.start.y, current.y),
            width,
            height,
          })
        } else {
          beforeScreenshotRef.current = null
        }
      }
      setDraft(null)
      setTool('select')
      if (width <= 8 && height <= 8) {
        beforeScreenshotRef.current = null
      }
    }

    if (endpointDrag) {
      const anchor = anchorAtPoint(board.elements.filter((element) => element.id !== endpointDrag.id), point)
      const finalPoint = anchor ? pointForAnchor(board.elements, anchor) : point
      const finalElements = board.elements.map((element) => moveLineEndpoint(element, endpointDrag, finalPoint, anchor))
      if (elementsChanged(lastCommittedBoardRef.current.elements, finalElements)) {
        void commitBoard(finalElements)
      } else {
        beforeScreenshotRef.current = null
      }
      setEndpointDrag(null)
    }

    if (resize) {
      const dx = point.x - resize.origin.x
      const dy = point.y - resize.origin.y
      const finalElements = board.elements.map((element) => resizeElement(element, resize, dx, dy))
      if (elementsChanged(lastCommittedBoardRef.current.elements, finalElements)) {
        void commitBoard(finalElements)
      } else {
        beforeScreenshotRef.current = null
      }
      setResize(null)
    }

    if (drag) {
      const dx = point.x - drag.origin.x
      const dy = point.y - drag.origin.y
      const finalElements = board.elements.map((element) => moveElement(element, drag, dx, dy))
      if (elementsChanged(lastCommittedBoardRef.current.elements, finalElements)) {
        void commitBoard(finalElements)
      } else {
        beforeScreenshotRef.current = null
      }
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
      const startAnchor = isAnchorableElement(element) ? anchorForElementPoint(element, point) : undefined
      startLineDraft(
        startAnchor ? pointForAnchor(board.elements, startAnchor) : point,
        startAnchor,
        event.currentTarget.ownerSVGElement,
        event.pointerId,
      )
      return
    }

    if (tool !== 'select') return

    captureBeforeSnapshot()
    setSelectedId(element.id)
    setDrag({ id: element.id, origin: pointFromElementEvent(event), element })
  }

  const startInlineEdit = (element: WhiteboardElement, event: MouseEvent<SVGGElement>) => {
    event.stopPropagation()
    if (element.type === 'image') return
    captureBeforeSnapshot()
    setTool('select')
    setSelectedId(element.id)
    setDrag(null)
    setResize(null)
    setEndpointDrag(null)
    setDraft(null)
    setInlineEdit({ id: element.id, value: editableText(element) })
  }

  const startResize = (element: BoxElement | TextElement | ImageElement, handle: ResizeHandle, event: PointerEvent<SVGRectElement>) => {
    event.stopPropagation()
    captureBeforeSnapshot()
    setTool('select')
    setSelectedId(element.id)
    setInlineEdit(null)
    setDrag(null)
    setEndpointDrag(null)
    setResize({ id: element.id, origin: pointFromOwnedSvgEvent(event), element, handle })
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
  }

  const startEndpointDrag = (line: LineElement, endpoint: LineEndpoint, event: PointerEvent<SVGCircleElement>) => {
    event.stopPropagation()
    captureBeforeSnapshot()
    setTool('select')
    setSelectedId(line.id)
    setInlineEdit(null)
    setDrag(null)
    setResize(null)
    setEndpointDrag({ id: line.id, endpoint, line })
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
  }

  const finishInlineEdit = (commit: boolean) => {
    if (!inlineEdit) return
    const element = board.elements.find((candidate) => candidate.id === inlineEdit.id)
    setInlineEdit(null)
    if (!commit || !element || element.type === 'image' || editableText(element) === inlineEdit.value) {
      beforeScreenshotRef.current = null
      return
    }
    const patch = element.type === 'text' ? { text: inlineEdit.value } : { label: inlineEdit.value }
    void commitBoard(
      board.elements.map((candidate) =>
        candidate.id === inlineEdit.id ? ({ ...candidate, ...patch } as WhiteboardElement) : candidate,
      ),
    )
  }

  const clearBoard = async () => {
    captureBeforeSnapshot()
    await commitBoard([])
    setSelectedId(null)
    setInlineEdit(null)
    beforeScreenshotRef.current = null
  }

  const undoBoard = () => {
    const previous = undoStackRef.current.pop()
    if (!previous) return
    const current = lastCommittedBoardRef.current
    redoStackRef.current.push({ board: current, historyId: currentHistoryIdRef.current })
    setUndoDepth(undoStackRef.current.length)
    setRedoDepth(redoStackRef.current.length)
    void syncBoardWithoutHistory(previous)
  }

  const redoBoard = () => {
    const next = redoStackRef.current.pop()
    if (!next) return
    const current = lastCommittedBoardRef.current
    undoStackRef.current.push({ board: current, historyId: currentHistoryIdRef.current })
    setUndoDepth(undoStackRef.current.length)
    setRedoDepth(redoStackRef.current.length)
    void syncBoardWithoutHistory(next)
  }

  const captureBeforeSnapshot = () => {
    beforeScreenshotRef.current = captureBoardScreenshot(lastCommittedBoardRef.current.elements)
  }

  const createImageElement = async (description: string, frame: { x: number; y: number; width: number; height: number }) => {
    const response = await fetch('/api/ai/image-svg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    })
    const result = await response.json()
    const fitted = fitFrameToSvg(frame, result.svg)
    const element: ImageElement = {
      id: nextId,
      type: 'image',
      description,
      svg: result.svg,
      renderAttempts: result.renderAttempts,
      x: frame.x,
      y: frame.y,
      width: fitted.width,
      height: fitted.height,
    }
    void commitBoard([...board.elements, element])
    setSelectedId(element.id)
  }

  const repairImageElement = async (element: ImageElement, error: string) => {
    if (repairingImageIds.has(element.id) || (element.renderAttempts?.length ?? 0) >= 8) return

    setRepairingImageIds((current) => new Set(current).add(element.id))
    try {
      captureBeforeSnapshot()
      const response = await fetch('/api/ai/image-svg/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: element.description,
          svg: element.svg,
          error,
          renderAttempts: element.renderAttempts ?? [],
        }),
      })
      const result = await response.json()
      const elements = board.elements.map((candidate) =>
        candidate.id === element.id
          ? ({ ...element, svg: result.svg, renderAttempts: result.renderAttempts } satisfies ImageElement)
          : candidate,
      )
      void commitBoard(elements)
    } finally {
      setRepairingImageIds((current) => {
        const next = new Set(current)
        next.delete(element.id)
        return next
      })
    }
  }

  const updateGeneratedImage = async (element: ImageElement, mode: 'regenerate' | 'refine') => {
    const instruction = mode === 'refine' ? window.prompt('How should Glyph refine this image?', element.description) : null
    if (mode === 'refine' && !instruction) return

    setGeneratingImageIds((current) => new Set(current).add(element.id))
    try {
      captureBeforeSnapshot()
      const response = await fetch(mode === 'regenerate' ? '/api/ai/image-svg' : '/api/ai/image-svg/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'regenerate'
            ? { description: element.description }
            : {
                description: element.description,
                instruction,
                svg: element.svg,
                renderAttempts: element.renderAttempts ?? [],
              },
        ),
      })
      const result = await response.json()
      const nextDescription = mode === 'refine' ? `${element.description}; ${instruction}` : element.description
      const fitted = fitFrameToSvg(element, result.svg)
      const elements = board.elements.map((candidate) =>
        candidate.id === element.id
          ? ({ ...element, description: nextDescription, svg: result.svg, renderAttempts: result.renderAttempts, width: fitted.width, height: fitted.height } satisfies ImageElement)
          : candidate,
      )
      void commitBoard(elements)
    } finally {
      setGeneratingImageIds((current) => {
        const next = new Set(current)
        next.delete(element.id)
        return next
      })
    }
  }

  const regenerateImageDescription = async (element: ImageElement, description: string) => {
    const nextDescription = description.trim()
    if (!nextDescription || nextDescription === element.description) return

    setGeneratingImageIds((current) => new Set(current).add(element.id))
    try {
      const response = await fetch('/api/ai/image-svg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: nextDescription }),
      })
      const result = await response.json()
      const fitted = fitFrameToSvg(element, result.svg)
      const elements = board.elements.map((candidate) =>
        candidate.id === element.id
          ? ({ ...element, description: nextDescription, svg: result.svg, renderAttempts: result.renderAttempts, width: fitted.width, height: fitted.height } satisfies ImageElement)
          : candidate,
      )
      void commitBoard(elements)
    } finally {
      setGeneratingImageIds((current) => {
        const next = new Set(current)
        next.delete(element.id)
        return next
      })
    }
  }

  const submitChatEdit = async () => {
    const message = chatInput.trim()
    if (!message || chatBusy) return

    const beforeBoard = lastCommittedBoardRef.current
    const beforeHistoryId = currentHistoryIdRef.current
    setChatInput('')
    setChatMessages((current) => [...current, { role: 'user', content: message }])
    setChatBusy(true)

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, discardHistoryAfterId: beforeHistoryId }),
      })
      const result = (await response.json()) as {
        ok?: boolean
        error?: string
        board?: Board
        history?: HistoryEntry[]
        diff?: GraphDiff
        message?: string
      }

      if (!response.ok || !result.board || !result.history || !result.diff) {
        throw new Error(result.error ?? 'AI edit failed')
      }

      const changed = result.diff.added.length > 0 || result.diff.removed.length > 0 || result.diff.updated.length > 0
      if (changed) {
        undoStackRef.current.push({ board: beforeBoard, historyId: beforeHistoryId })
        redoStackRef.current = []
        setUndoDepth(undoStackRef.current.length)
        setRedoDepth(redoStackRef.current.length)
      }

      setBoard(result.board)
      lastCommittedBoardRef.current = result.board
      setHistory(result.history)
      const latestHistoryId = changed ? (result.history[0]?.id ?? beforeHistoryId) : beforeHistoryId
      setCurrentHistoryId(latestHistoryId)
      currentHistoryIdRef.current = latestHistoryId
      setSelectedId((current) => result.board?.elements.some((element) => element.id === current) ? current : null)
      setChatMessages((current) => [...current, { role: 'assistant', content: result.message ?? (changed ? 'Updated the whiteboard.' : 'No board changes were needed.') }])
    } catch (error) {
      setChatMessages((current) => [...current, { role: 'assistant', content: error instanceof Error ? error.message : 'AI edit failed' }])
    } finally {
      setChatBusy(false)
    }
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
            <ToolButton active={tool === 'image'} label="AI image" onClick={() => setTool('image')} icon={<ImagePlus size={17} />} />
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
          <ButtonGroup size="small" variant="outlined">
            <Tooltip title="Zoom out">
              <span>
                <IconButton onClick={() => zoomBoard(-1)} disabled={boardZoom <= minZoom}>
                  <ZoomOut size={18} />
                </IconButton>
              </span>
            </Tooltip>
            <Typography className="zoom-readout" variant="caption">{Math.round(boardZoom * 100)}%</Typography>
            <Tooltip title="Zoom in">
              <span>
                <IconButton onClick={() => zoomBoard(1)} disabled={boardZoom >= maxZoom}>
                  <ZoomIn size={18} />
                </IconButton>
              </span>
            </Tooltip>
          </ButtonGroup>
          <Tooltip title="Undo">
            <span>
              <IconButton onClick={undoBoard} disabled={undoDepth === 0}><Undo2 size={18} /></IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Redo">
            <span>
              <IconButton onClick={redoBoard} disabled={redoDepth === 0}><Redo2 size={18} /></IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Clear board">
            <IconButton onClick={clearBoard}><Trash2 size={18} /></IconButton>
          </Tooltip>
        </Stack>
      </Paper>

      <Box className={`workspace ${leftSidebarOpen ? '' : 'left-collapsed'} ${rightSidebarOpen ? '' : 'right-collapsed'}`}>
        {leftSidebarOpen ? (
        <Paper className="left-panel" elevation={0}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="overline">Controls</Typography>
            <Tooltip title="Collapse left sidebar">
              <IconButton size="small" onClick={() => setLeftSidebarOpen(false)}>
                <ChevronLeft size={16} />
              </IconButton>
            </Tooltip>
          </Stack>
          {(tool === 'box' || tool === 'line') && (
            <>
              <Typography variant="overline">Tool Options</Typography>
              {tool === 'box' && (
                <FormControl size="small" fullWidth>
                  <InputLabel>Box</InputLabel>
                  <Select label="Box" value={boxShape} onChange={(event) => setBoxShape(event.target.value as BoxElement['shape'])}>
                    <MenuItem value="rectangle">Rectangle</MenuItem>
                    <MenuItem value="oval">Oval</MenuItem>
                    <MenuItem value="cloud">Cloud</MenuItem>
                  </Select>
                </FormControl>
              )}
              {tool === 'line' && (
                <FormControl size="small" fullWidth>
                  <InputLabel>Line</InputLabel>
                  <Select label="Line" value={lineStyle} onChange={(event) => setLineStyle(event.target.value as LineElement['lineStyle'])}>
                    <MenuItem value="plain">Plain</MenuItem>
                    <MenuItem value="arrow">Arrow</MenuItem>
                    <MenuItem value="doubleArrow">Double arrow</MenuItem>
                  </Select>
                </FormControl>
              )}
              <Divider />
            </>
          )}
          <Typography variant="overline">Selected</Typography>
          {selected ? (
            <Inspector
              element={selected}
              busy={selected.type === 'image' && generatingImageIds.has(selected.id)}
              onBeginEdit={captureBeforeSnapshot}
              onCommit={commitSelectedPatch}
              onRegenerateImage={(element) => void updateGeneratedImage(element, 'regenerate')}
              onRefineImage={(element) => void updateGeneratedImage(element, 'refine')}
            />
          ) : <Typography color="text.secondary">No element selected.</Typography>}
          <Divider />
          <Typography variant="overline">History</Typography>
          <Stack spacing={1} className="history-list">
            {history.map((entry) => (
              <Box key={entry.id} className={currentHistoryId !== null && entry.id > currentHistoryId ? 'history-entry future' : 'history-entry'}>
                <Typography variant="body2">{entry.description}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(entry.at).toLocaleTimeString()} - {entry.elementCount} objects
                </Typography>
              </Box>
            ))}
          </Stack>
        </Paper>
        ) : (
          <Box className="sidebar-rail left-rail">
            <Tooltip title="Expand left sidebar">
              <IconButton size="small" onClick={() => setLeftSidebarOpen(true)}>
                <ChevronRight size={16} />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        <Box className="board-wrap">
          <svg
            className="board"
            viewBox={`0 0 ${boardWidth} ${boardHeight}`}
            style={{ width: boardWidth * boardZoom, height: boardHeight * boardZoom }}
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
                onImageError={(image, error) => void repairImageElement(image, error)}
              />
            ))}
            {selected && !inlineEdit && (selected.type === 'box' || selected.type === 'text' || selected.type === 'image') && (
              <ResizeHandles element={selected} onPointerDown={startResize} />
            )}
            {selected && !inlineEdit && selected.type === 'line' && (
              <LineEndpointHandles line={selected} elements={board.elements} onPointerDown={startEndpointDrag} />
            )}
            {(draft?.tool === 'line' || endpointDrag) && (
              <AnchorTargets elements={board.elements} activeAnchor={anchorAtPoint(board.elements.filter((element) => element.id !== endpointDrag?.id), draft?.current ?? pointForEndpointDrag(endpointDrag, board.elements))} />
            )}
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

        {rightSidebarOpen ? (
        <Paper className="right-panel" elevation={0}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="overline">AI</Typography>
            <Tooltip title="Collapse right sidebar">
              <IconButton size="small" onClick={() => setRightSidebarOpen(false)}>
                <ChevronRight size={16} />
              </IconButton>
            </Tooltip>
          </Stack>
          <Typography variant="overline">Chat</Typography>
          <Stack spacing={1} className="chat-panel">
            <Stack spacing={0.75} className="chat-log" ref={chatLogRef}>
              {chatMessages.map((message, index) => (
                <Box key={`${message.role}-${index}`} className={`chat-message ${message.role}`}>
                  <Typography variant="body2">{message.content}</Typography>
                </Box>
              ))}
              {chatBusy && (
                <Box className="chat-message assistant">
                  <Typography variant="body2">Working...</Typography>
                </Box>
              )}
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                placeholder="Ask Glyph to edit the board"
                value={chatInput}
                disabled={chatBusy}
                fullWidth
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void submitChatEdit()
                  }
                }}
              />
              <Tooltip title="Send">
                <span>
                  <IconButton onClick={() => void submitChatEdit()} disabled={chatBusy || !chatInput.trim()}>
                    <Send size={18} />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>
          <Divider />
          <Button
            className="llm-state-toggle"
            size="small"
            variant="text"
            startIcon={llmStateOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            onClick={() => setLlmStateOpen((current) => !current)}
          >
            LLM State
          </Button>
          <Collapse in={llmStateOpen} timeout="auto" unmountOnExit>
            <pre className="json-preview">{JSON.stringify(board.elements, null, 2)}</pre>
          </Collapse>
        </Paper>
        ) : (
          <Box className="sidebar-rail right-rail">
            <Tooltip title="Expand right sidebar">
              <IconButton size="small" onClick={() => setRightSidebarOpen(true)}>
                <ChevronLeft size={16} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  )
}

function editableText(element: Exclude<WhiteboardElement, ImageElement>) {
  return element.type === 'text' ? element.text : (element.label ?? '')
}

async function captureBoardScreenshot(elements: WhiteboardElement[]) {
  const bounds = populatedBoardBounds(elements)
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = `${bounds.width}px`
  container.style.height = `${bounds.height}px`
  container.style.overflow = 'hidden'
  container.style.background = '#f8fafc'
  container.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" class="board screenshot-board">
    <defs>
      <marker id="screenshot-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
      </marker>
    </defs>
    ${elements.map((element) => screenshotElementSvg(element, elements)).join('')}
  </svg>`
  document.body.appendChild(container)
  const canvas = await html2canvas(container, { backgroundColor: '#f8fafc', scale: 0.8 })
  document.body.removeChild(container)
  return canvas.toDataURL('image/png')
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function boardChanged(before: Board, after: Board) {
  return elementsChanged(before.elements, after.elements)
}

function elementsChanged(before: WhiteboardElement[], after: WhiteboardElement[]) {
  return JSON.stringify(before) !== JSON.stringify(after)
}

function clampZoom(value: number) {
  return Math.min(maxZoom, Math.max(minZoom, Number(value.toFixed(2))))
}

function svgPointFromClient(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const point = svg.createSVGPoint()
  point.x = clientX
  point.y = clientY
  const matrix = svg.getScreenCTM()
  if (!matrix) return { x: 0, y: 0 }
  const transformed = point.matrixTransform(matrix.inverse())
  return { x: transformed.x, y: transformed.y }
}

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function svgParseError(svg: string) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const parserError = document.querySelector('parsererror')
  if (parserError) {
    return parserError.textContent?.trim() || 'SVG parser error'
  }
  if (!document.documentElement || document.documentElement.tagName.toLowerCase() !== 'svg') {
    return 'Response did not contain an SVG root element'
  }
  return null
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function populatedBoardBounds(elements: WhiteboardElement[]) {
  if (elements.length === 0) {
    return { x: 0, y: 0, width: 640, height: 400 }
  }

  const padding = 48
  const boxes = elements.map((element) => elementBounds(element, elements))
  const minX = Math.min(...boxes.map((bounds) => bounds.x))
  const minY = Math.min(...boxes.map((bounds) => bounds.y))
  const maxX = Math.max(...boxes.map((bounds) => bounds.x + bounds.width))
  const maxY = Math.max(...boxes.map((bounds) => bounds.y + bounds.height))
  const x = Math.max(0, minX - padding)
  const y = Math.max(0, minY - padding)
  return {
    x,
    y,
    width: Math.max(240, maxX - x + padding),
    height: Math.max(180, maxY - y + padding),
  }
}

function elementBounds(element: WhiteboardElement, elements: WhiteboardElement[]) {
  if (element.type === 'line') {
    const points = linePoints(element, elements)
    const minX = Math.min(points.start.x, points.end.x)
    const minY = Math.min(points.start.y, points.end.y)
    const maxX = Math.max(points.start.x, points.end.x)
    const maxY = Math.max(points.start.y, points.end.y)
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
  }
  return { x: element.x, y: element.y, width: element.width, height: elementHeight(element) }
}

function screenshotElementSvg(element: WhiteboardElement, elements: WhiteboardElement[]) {
  const style = 'style' in element ? element.style : undefined
  const stroke = escapeXml(style?.stroke ?? '#1f2937')
  const strokeWidth = style?.strokeWidth ?? 2

  if (element.type === 'box') {
    const fill = escapeXml(element.style?.fill ?? '#ffffff')
    const label = element.label ? screenshotText(element.label, element.x + element.width / 2, element.y + element.height / 2, element.width - 16) : ''
    if (element.shape === 'cloud') {
      return `<path d="${cloudPath(element.x, element.y, element.width, element.height)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>${label}`
    }
    if (element.shape === 'oval') {
      return `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>${label}`
    }
    return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>${label}`
  }

  if (element.type === 'line') {
    const points = linePoints(element, elements)
    const label = element.label ? screenshotText(element.label, (points.start.x + points.end.x) / 2, (points.start.y + points.end.y) / 2 - 8, 160, 14) : ''
    const markerEnd = element.lineStyle === 'arrow' || element.lineStyle === 'doubleArrow' ? ' marker-end="url(#screenshot-arrow)"' : ''
    const markerStart = element.lineStyle === 'doubleArrow' ? ' marker-start="url(#screenshot-arrow)"' : ''
    return `<line x1="${points.start.x}" y1="${points.start.y}" x2="${points.end.x}" y2="${points.end.y}" stroke="${stroke}" stroke-width="${strokeWidth}"${markerStart}${markerEnd}/>${label}`
  }

  if (element.type === 'text') {
    return `<foreignObject x="${element.x}" y="${element.y}" width="${element.width}" height="${elementHeight(element)}"><div xmlns="http://www.w3.org/1999/xhtml" class="text-node">${escapeXml(element.text)}</div></foreignObject>`
  }

  return `<foreignObject x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}"><img xmlns="http://www.w3.org/1999/xhtml" class="image-node" src="${escapeXml(svgDataUrl(element.svg))}" style="width:100%;height:100%;object-fit:contain;"/></foreignObject>`
}

function screenshotText(text: string, x: number, y: number, width: number, fontSize = 16) {
  return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, system-ui, sans-serif" font-size="${fontSize}" fill="#111827">${escapeXml(text.slice(0, Math.max(12, Math.floor(width / 7))))}</text>`
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function fitFrameToSvg(frame: { width: number; height: number }, svg: string) {
  const ratio = svgAspectRatio(svg)
  if (!ratio || frame.width <= 0 || frame.height <= 0) {
    return { width: frame.width, height: frame.height }
  }

  const frameRatio = frame.width / frame.height
  if (Math.abs(frameRatio - ratio) < 0.01) {
    return { width: frame.width, height: frame.height }
  }

  if (frameRatio < ratio) {
    return { width: frame.height * ratio, height: frame.height }
  }

  return { width: frame.width, height: frame.width / ratio }
}

function svgAspectRatio(svg: string) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = document.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') return null

  const viewBox = root.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return parts[2] / parts[3]
    }
  }

  const width = svgLength(root.getAttribute('width'))
  const height = svgLength(root.getAttribute('height'))
  if (width && height) {
    return width / height
  }

  return null
}

function svgLength(value: string | null) {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
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

function moveLineEndpoint(element: WhiteboardElement, endpointDrag: EndpointDrag, point: Point, anchor?: Anchor): WhiteboardElement {
  if (element.id !== endpointDrag.id || element.type !== 'line') return element
  if (endpointDrag.endpoint === 'start') {
    return { ...endpointDrag.line, start: point, startAnchor: anchor, end: element.end, endAnchor: element.endAnchor }
  }
  return { ...endpointDrag.line, end: point, endAnchor: anchor, start: element.start, startAnchor: element.startAnchor }
}

function resizeElement(element: WhiteboardElement, resize: Resize, dx: number, dy: number): WhiteboardElement {
  if (element.id !== resize.id) return element

  const minWidth = element.type === 'text' ? 96 : 64
  const minHeight = 44
  const original = resize.element
  let x = original.x
  let y = original.y
  let width = original.width
  let height = elementHeight(original)

  if (resize.handle.includes('e')) {
    width = Math.max(minWidth, original.width + dx)
  }
  if (resize.handle.includes('s')) {
    height = Math.max(minHeight, elementHeight(original) + dy)
  }
  if (resize.handle.includes('w')) {
    const nextWidth = Math.max(minWidth, original.width - dx)
    x = original.x + original.width - nextWidth
    width = nextWidth
  }
  if (resize.handle.includes('n')) {
    const nextHeight = Math.max(minHeight, elementHeight(original) - dy)
    y = original.y + elementHeight(original) - nextHeight
    height = nextHeight
  }

  return { ...original, x, y, width, height }
}

function elementHeight(element: BoxElement | TextElement | ImageElement) {
  return element.type === 'text' ? (element.height ?? 120) : element.height
}

function resizeHandlePoints(element: BoxElement | TextElement | ImageElement): Array<{ handle: ResizeHandle; x: number; y: number }> {
  const height = elementHeight(element)
  return [
    { handle: 'nw', x: element.x, y: element.y },
    { handle: 'ne', x: element.x + element.width, y: element.y },
    { handle: 'se', x: element.x + element.width, y: element.y + height },
    { handle: 'sw', x: element.x, y: element.y + height },
  ]
}

type AnchorableElement = BoxElement | ImageElement

function isAnchorableElement(element: WhiteboardElement): element is AnchorableElement {
  return element.type === 'box' || element.type === 'image'
}

function anchorableElements(elements: WhiteboardElement[]) {
  return elements.filter(isAnchorableElement)
}

function anchorAtPoint(elements: WhiteboardElement[], point: Point): Anchor | undefined {
  let nearest: { anchor: Anchor; distance: number } | null = null

  for (const element of anchorableElements(elements)) {
    for (const anchor of anchorsForElement(element)) {
      const anchorPoint = pointForAnchor(elements, anchor)
      const distance = Math.hypot(anchorPoint.x - point.x, anchorPoint.y - point.y)
      if (distance <= anchorSnapDistance && (!nearest || distance < nearest.distance)) {
        nearest = { anchor, distance }
      }
    }
  }

  return nearest?.anchor
}

function anchorForElementPoint(element: AnchorableElement, point: Point): Anchor {
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const dx = (point.x - center.x) / Math.max(element.width, 1)
  const dy = (point.y - center.y) / Math.max(element.height, 1)
  const side: AnchorSide = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
  return { elementId: element.id, side }
}

function anchorsForElement(element: AnchorableElement): Anchor[] {
  return [
    { elementId: element.id, side: 'top' },
    { elementId: element.id, side: 'right' },
    { elementId: element.id, side: 'bottom' },
    { elementId: element.id, side: 'left' },
  ]
}

function pointForAnchor(elements: WhiteboardElement[], anchor: Anchor): Point {
  const element = elements.find((candidate): candidate is AnchorableElement => isAnchorableElement(candidate) && candidate.id === anchor.elementId)
  if (!element) return { x: 0, y: 0 }
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  switch (anchor.side) {
    case 'top':
      return { x: center.x, y: element.y }
    case 'right':
      return { x: element.x + element.width, y: center.y }
    case 'bottom':
      return { x: center.x, y: element.y + element.height }
    case 'left':
      return { x: element.x, y: center.y }
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

function pointForEndpointDrag(endpointDrag: EndpointDrag | null, elements: WhiteboardElement[]) {
  if (!endpointDrag) return { x: -9999, y: -9999 }
  const line = elements.find((element): element is LineElement => element.type === 'line' && element.id === endpointDrag.id) ?? endpointDrag.line
  const points = linePoints(line, elements)
  return endpointDrag.endpoint === 'start' ? points.start : points.end
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

function Inspector({
  element,
  busy = false,
  onBeginEdit,
  onCommit,
  onRegenerateImage,
  onRefineImage,
}: {
  element: WhiteboardElement
  busy?: boolean
  onBeginEdit: () => void
  onCommit: (patch: Partial<WhiteboardElement>) => void
  onRegenerateImage: (element: ImageElement) => void
  onRefineImage: (element: ImageElement) => void
}) {
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

  const commitSelect = (field: string, value: string) => {
    const initial = inspectorValues(element)
    setValues({ ...values, [field]: value })
    if (value === initial[field]) return
    onBeginEdit()
    onCommit({ [field]: value } as Partial<WhiteboardElement>)
  }

  const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.currentTarget.blur()
  }

  if (element.type === 'box') {
    return (
      <Stack spacing={1.5}>
        <FormControl size="small" fullWidth>
          <InputLabel>Shape</InputLabel>
          <Select label="Shape" value={values.shape} onChange={(event) => commitSelect('shape', event.target.value)}>
            <MenuItem value="rectangle">Rectangle</MenuItem>
            <MenuItem value="oval">Oval</MenuItem>
            <MenuItem value="cloud">Cloud</MenuItem>
          </Select>
        </FormControl>
        <TextField label="Label" size="small" value={values.label} onFocus={onBeginEdit} onChange={(event) => setValues({ ...values, label: event.target.value })} onBlur={() => commit('label')} onKeyDown={blurOnEnter} />
        <TextField label="Width" size="small" type="number" value={values.width} onFocus={onBeginEdit} onChange={(event) => setValues({ ...values, width: event.target.value })} onBlur={() => commit('width')} onKeyDown={blurOnEnter} />
        <TextField label="Height" size="small" type="number" value={values.height} onFocus={onBeginEdit} onChange={(event) => setValues({ ...values, height: event.target.value })} onBlur={() => commit('height')} onKeyDown={blurOnEnter} />
      </Stack>
    )
  }
  if (element.type === 'text') {
    return (
      <Stack spacing={1.5}>
        <TextField label="Text" size="small" multiline minRows={3} value={values.text} onFocus={onBeginEdit} onChange={(event) => setValues({ ...values, text: event.target.value })} onBlur={() => commit('text')} />
        <TextField label="Width" size="small" type="number" value={values.width} onFocus={onBeginEdit} onChange={(event) => setValues({ ...values, width: event.target.value })} onBlur={() => commit('width')} onKeyDown={blurOnEnter} />
        <TextField label="Height" size="small" type="number" value={values.height} onFocus={onBeginEdit} onChange={(event) => setValues({ ...values, height: event.target.value })} onBlur={() => commit('height')} onKeyDown={blurOnEnter} />
      </Stack>
    )
  }
  if (element.type === 'image') {
    return (
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<RefreshCw size={16} />} disabled={busy} onClick={() => onRegenerateImage(element)}>
            Refresh
          </Button>
          <Button size="small" variant="outlined" disabled={busy} onClick={() => onRefineImage(element)}>
            Refine
          </Button>
        </Stack>
        <TextField label="Description" size="small" multiline minRows={3} value={values.description} onFocus={onBeginEdit} onChange={(event) => setValues({ ...values, description: event.target.value })} onBlur={() => commit('description')} />
        <TextField label="Width" size="small" type="number" value={values.width} onFocus={onBeginEdit} onChange={(event) => setValues({ ...values, width: event.target.value })} onBlur={() => commit('width')} onKeyDown={blurOnEnter} />
        <TextField label="Height" size="small" type="number" value={values.height} onFocus={onBeginEdit} onChange={(event) => setValues({ ...values, height: event.target.value })} onBlur={() => commit('height')} onKeyDown={blurOnEnter} />
        <Typography variant="caption" color="text.secondary">SVG render failures are sent back to the model for repair.</Typography>
      </Stack>
    )
  }
  return (
    <Stack spacing={1.5}>
      <FormControl size="small" fullWidth>
        <InputLabel>Line</InputLabel>
        <Select label="Line" value={values.lineStyle} onChange={(event) => commitSelect('lineStyle', event.target.value)}>
          <MenuItem value="plain">Plain</MenuItem>
          <MenuItem value="arrow">Arrow</MenuItem>
          <MenuItem value="doubleArrow">Double arrow</MenuItem>
        </Select>
      </FormControl>
      <TextField label="Label" size="small" value={values.label} onFocus={onBeginEdit} onChange={(event) => setValues({ ...values, label: event.target.value })} onBlur={() => commit('label')} onKeyDown={blurOnEnter} />
      <Typography variant="caption" color="text.secondary">Double-click the line label to edit inline. Anchored endpoints follow their boxes.</Typography>
    </Stack>
  )
}

function inspectorValues(element: WhiteboardElement): Record<string, string> {
  if (element.type === 'box') {
    return { shape: element.shape, label: element.label ?? '', width: String(Math.round(element.width)), height: String(Math.round(element.height)) }
  }
  if (element.type === 'text') {
    return { text: element.text, width: String(Math.round(element.width)), height: String(Math.round(elementHeight(element))) }
  }
  if (element.type === 'image') {
    return { description: element.description, width: String(Math.round(element.width)), height: String(Math.round(element.height)) }
  }
  return { lineStyle: element.lineStyle, label: element.label ?? '' }
}

function ElementView({
  element,
  elements,
  selected,
  editing,
  onPointerDown,
  onDoubleClick,
  onImageError,
}: {
  element: WhiteboardElement
  elements: WhiteboardElement[]
  selected: boolean
  editing: boolean
  onPointerDown: (event: PointerEvent<SVGGElement>) => void
  onDoubleClick: (event: MouseEvent<SVGGElement>) => void
  onImageError: (element: ImageElement, error: string) => void
}) {
  const style = 'style' in element ? element.style : undefined
  const stroke = style?.stroke ?? '#1f2937'
  const strokeWidth = style?.strokeWidth ?? 2
  if (element.type === 'box') {
    return (
      <g onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} className={selected ? 'element selected' : 'element'}>
        {element.shape === 'cloud' ? (
          <path d={cloudPath(element.x, element.y, element.width, element.height)} fill={element.style?.fill ?? '#fff'} stroke={stroke} strokeWidth={strokeWidth} />
        ) : element.shape === 'oval' ? (
          <ellipse cx={element.x + element.width / 2} cy={element.y + element.height / 2} rx={element.width / 2} ry={element.height / 2} fill={element.style?.fill ?? '#fff'} stroke={stroke} strokeWidth={strokeWidth} />
        ) : (
          <rect x={element.x} y={element.y} width={element.width} height={element.height} rx="4" fill={element.style?.fill ?? '#fff'} stroke={stroke} strokeWidth={strokeWidth} />
        )}
        {element.label && !editing && <WrappedBoxLabel box={element} />}
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
  if (element.type === 'image') {
    return (
      <g onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} className={selected ? 'element selected' : 'element'}>
        <rect x={element.x} y={element.y} width={element.width} height={element.height} rx="4" fill="#ffffff" stroke={selected ? '#2563eb' : '#cbd5e1'} strokeWidth="2" />
        <ImageSvgView element={element} onError={onImageError} />
      </g>
    )
  }
  return (
    <g onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} className={selected ? 'element selected' : 'element'}>
      {!editing && (
        <foreignObject className="text-foreign-object" x={element.x} y={element.y} width={element.width} height={elementHeight(element)}>
          <div className="text-node" style={{ color: element.style?.stroke, fontSize: element.style?.fontSize }}>{element.text}</div>
        </foreignObject>
      )}
    </g>
  )
}

function ImageSvgView({ element, onError }: { element: ImageElement; onError: (element: ImageElement, error: string) => void }) {
  const reportedSvgRef = useRef<string | null>(null)
  const parseError = svgParseError(element.svg)

  useEffect(() => {
    if (!parseError || reportedSvgRef.current === element.svg) return
    reportedSvgRef.current = element.svg
    onError(element, parseError)
  }, [element, onError, parseError])

  if (parseError) {
    return (
      <foreignObject x={element.x} y={element.y} width={element.width} height={element.height} className="image-error-foreign-object">
        <div className="image-error">Repairing SVG...</div>
      </foreignObject>
    )
  }

  return (
    <image
      className="image-node"
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      preserveAspectRatio="xMidYMid meet"
      href={svgDataUrl(element.svg)}
      onError={() => onError(element, 'SVG image failed to load in the browser')}
    />
  )
}

function WrappedBoxLabel({ box }: { box: BoxElement }) {
  return (
    <foreignObject x={box.x + 10} y={box.y + 10} width={Math.max(1, box.width - 20)} height={Math.max(1, box.height - 20)} className="label-foreign-object">
      <div className="box-label">{box.label}</div>
    </foreignObject>
  )
}

function ResizeHandles({
  element,
  onPointerDown,
}: {
  element: BoxElement | TextElement | ImageElement
  onPointerDown: (element: BoxElement | TextElement | ImageElement, handle: ResizeHandle, event: PointerEvent<SVGRectElement>) => void
}) {
  return (
    <g className="resize-handles">
      {resizeHandlePoints(element).map((point) => (
        <rect
          key={point.handle}
          className={`resize-handle ${point.handle}`}
          x={point.x - 5}
          y={point.y - 5}
          width="10"
          height="10"
          rx="2"
          onPointerDown={(event) => onPointerDown(element, point.handle, event)}
        />
      ))}
    </g>
  )
}

function LineEndpointHandles({
  line,
  elements,
  onPointerDown,
}: {
  line: LineElement
  elements: WhiteboardElement[]
  onPointerDown: (line: LineElement, endpoint: LineEndpoint, event: PointerEvent<SVGCircleElement>) => void
}) {
  const points = linePoints(line, elements)
  return (
    <g className="line-endpoint-handles">
      <circle className="line-endpoint-handle" cx={points.start.x} cy={points.start.y} r="7" onPointerDown={(event) => onPointerDown(line, 'start', event)} />
      <circle className="line-endpoint-handle" cx={points.end.x} cy={points.end.y} r="7" onPointerDown={(event) => onPointerDown(line, 'end', event)} />
    </g>
  )
}

function AnchorTargets({ elements, activeAnchor }: { elements: WhiteboardElement[]; activeAnchor?: Anchor }) {
  const targets = anchorableElements(elements).flatMap((element) =>
    anchorsForElement(element).map((anchor) => ({
      anchor,
      point: pointForAnchor(elements, anchor),
    })),
  )

  return (
    <g className="anchor-targets">
      {targets.map((target) => {
        const active = activeAnchor?.elementId === target.anchor.elementId && activeAnchor.side === target.anchor.side
        return (
          <circle
            key={`${target.anchor.elementId}-${target.anchor.side}`}
            className={active ? 'anchor-target active' : 'anchor-target'}
            cx={target.point.x}
            cy={target.point.y}
            r={active ? 7 : 5}
          />
        )
      })}
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
  const isMultiline = element.type !== 'line'

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      onCancel()
      return
    }
    if (!isMultiline && event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  const placement = editorPlacement(element, elements)

  return (
    <foreignObject x={placement.x} y={placement.y} width={placement.width} height={placement.height}>
      {isMultiline ? (
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
      y: element.y + 12,
      width: Math.max(72, element.width - 24),
      height: Math.max(38, element.height - 24),
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
    height: elementHeight(element),
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
  if (draft.tool === 'image') {
    return <rect x={x} y={y} width={width} height={height} rx="4" fill="#fff" stroke={stroke} strokeWidth="2" strokeDasharray="6 5" />
  }
  if (boxShape === 'oval') {
    return <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} fill="#fff" stroke={stroke} strokeWidth="2" strokeDasharray="6 5" />
  }
  if (boxShape === 'cloud') {
    return <path d={cloudPath(x, y, width, height)} fill="#fff" stroke={stroke} strokeWidth="2" strokeDasharray="6 5" />
  }
  return <rect x={x} y={y} width={width} height={height} rx="4" fill="#fff" stroke={stroke} strokeWidth="2" strokeDasharray="6 5" />
}

function cloudPath(x: number, y: number, width: number, height: number) {
  const w = Math.max(width, 32)
  const h = Math.max(height, 32)
  return [
    `M ${x + w * 0.22} ${y + h * 0.78}`,
    `C ${x + w * 0.08} ${y + h * 0.78}, ${x + w * 0.02} ${y + h * 0.62}, ${x + w * 0.12} ${y + h * 0.52}`,
    `C ${x + w * 0.03} ${y + h * 0.38}, ${x + w * 0.16} ${y + h * 0.24}, ${x + w * 0.31} ${y + h * 0.30}`,
    `C ${x + w * 0.36} ${y + h * 0.10}, ${x + w * 0.62} ${y + h * 0.10}, ${x + w * 0.67} ${y + h * 0.30}`,
    `C ${x + w * 0.84} ${y + h * 0.22}, ${x + w * 0.98} ${y + h * 0.38}, ${x + w * 0.88} ${y + h * 0.54}`,
    `C ${x + w * 1.02} ${y + h * 0.66}, ${x + w * 0.92} ${y + h * 0.82}, ${x + w * 0.75} ${y + h * 0.78}`,
    `C ${x + w * 0.62} ${y + h * 0.92}, ${x + w * 0.38} ${y + h * 0.92}, ${x + w * 0.22} ${y + h * 0.78}`,
    'Z',
  ].join(' ')
}

export default App
