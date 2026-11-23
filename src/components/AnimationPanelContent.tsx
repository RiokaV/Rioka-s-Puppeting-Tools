import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioWaveform,
  Clipboard,
  Copy,
  Diamond,
  ExternalLink,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  SkipBack,
  SkipForward,
  Sparkles,
  Spline,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AudioTrackConfig,
  CompositionState,
  CubicBezierTuple,
  EasingCurvePreset,
  KeyframeEasing,
  RiokaPuppetEffect,
} from '../types/puppet';
import type {
  KeyframeClipboardItem,
  KeyframeSelectionItem,
} from '../engine/morphTools';
import { evaluateTrackAtFrame } from '../engine/rigging';
import { CurveEditorPopover } from './CurveEditorPopover';

interface AnimationPanelContentProps {
  composition: CompositionState;
  effect: RiokaPuppetEffect;
  selectedParamId: string;
  clipboard: KeyframeClipboardItem[];
  onSelectParam: (paramId: string) => void;
  onChangeFrame: (frame: number) => void;
  onChangeFps: (fps: number) => void;
  onToggleConnectToParameter: (enabled: boolean) => void;
  onTogglePlay: () => void;
  onAddKeyframe: (paramId: string) => void;
  onDeleteSelectedKeyframes: (selection: KeyframeSelectionItem[]) => void;
  onCopySelectedKeyframes: (
    selection: KeyframeSelectionItem[],
    cut: boolean
  ) => void;
  onPasteKeyframesAtFrame: (targetFrame: number) => void;
  onMoveSelectedKeyframes: (
    selection: KeyframeSelectionItem[],
    deltaFrames: number
  ) => void;
  onBakePhysicsKeyframes: () => void;
  onRemovePhysicsKeyframes: () => void;
  onUpdatePhysicsKeyframes: () => void;
  onToggleKeyframeTarget: () => void;
  onSendKeyframesToAfterEffects: () => void;
  curvePresets: EasingCurvePreset[];
  onApplyKeyframeEasing: (
    selection: KeyframeSelectionItem[],
    easing: KeyframeEasing,
    bezier?: CubicBezierTuple
  ) => void;
  onToggleFavoriteCurve: (presetId: string) => void;
  onSaveCurvePreset: (
    name: string,
    easing: KeyframeEasing,
    bezier: CubicBezierTuple
  ) => void;
  onDeleteCurvePreset: (presetId: string) => void;
  audioTrack: AudioTrackConfig | null;
  onImportAudioFile: (file: File) => void;
  onLoadDemoVoice: () => void;
  onGenerateLipSync: () => void;
  onClearAudioTrack: () => void;
}

export function AnimationPanelContent({
  composition,
  effect,
  selectedParamId,
  clipboard,
  onSelectParam,
  onChangeFrame,
  onChangeFps,
  onToggleConnectToParameter,
  onTogglePlay,
  onAddKeyframe,
  onDeleteSelectedKeyframes,
  onCopySelectedKeyframes,
  onPasteKeyframesAtFrame,
  onMoveSelectedKeyframes,
  onBakePhysicsKeyframes,
  onRemovePhysicsKeyframes,
  onUpdatePhysicsKeyframes,
  onToggleKeyframeTarget,
  onSendKeyframesToAfterEffects,
  curvePresets,
  onApplyKeyframeEasing,
  onToggleFavoriteCurve,
  onSaveCurvePreset,
  onDeleteCurvePreset,
  audioTrack,
  onImportAudioFile,
  onLoadDemoVoice,
  onGenerateLipSync,
  onClearAudioTrack,
}: AnimationPanelContentProps) {
  const { currentFrame, durationFrames, fps, isPlaying } = composition;
  const playheadPct = (currentFrame / Math.max(1, durationFrames)) * 100;
  const isAeMode = effect.keyframeTarget === 'after_effects';

  const containerRef = useRef<HTMLDivElement | null>(null);
  const tracksAreaRef = useRef<HTMLDivElement | null>(null);
  const trackRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const isScrubbingRef = useRef(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [showAnimatedOnly, setShowAnimatedOnly] = useState(false);

  const animatedParamCount = effect.puppet.parameters.filter(
    (p) => (effect.tracks[p.id]?.keyframes.length ?? 0) > 0
  ).length;

  const visibleParameters =
    showAnimatedOnly && animatedParamCount > 0
      ? effect.puppet.parameters.filter(
          (p) => (effect.tracks[p.id]?.keyframes.length ?? 0) > 0
        )
      : effect.puppet.parameters;

  const selectedTrackKfCount =
    effect.tracks[selectedParamId]?.keyframes.length ?? 0;

  // Automatically scroll the active/newly-keyframed parameter row into view so users
  // always see keyframes recorded on parameters below the initial 5-row fold.
  useEffect(() => {
    const rowEl = trackRowRefs.current[selectedParamId];
    if (rowEl && typeof rowEl.scrollIntoView === 'function') {
      rowEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedParamId, selectedTrackKfCount, showAnimatedOnly]);

  const [selectedKfs, setSelectedKfs] = useState<KeyframeSelectionItem[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    frame: number;
  } | null>(null);

  // Curve Editor popover state
  const [showCurveEditor, setShowCurveEditor] = useState(false);
  const [draftEasing, setDraftEasing] = useState<KeyframeEasing>('bezier');
  const [draftBezier, setDraftBezier] = useState<CubicBezierTuple>([
    0.42, 0.0, 0.58, 1.0,
  ]);

  // Dragging selected keyframes horizontally
  const kfDragRef = useRef<{
    active: boolean;
    startClientX: number;
    trackWidth: number;
    appliedDelta: number;
    selection: KeyframeSelectionItem[];
  }>({
    active: false,
    startClientX: 0,
    trackWidth: 400,
    appliedDelta: 0,
    selection: [],
  });

  // Marquee box selection across tracks
  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);
  const marqueeActiveRef = useRef(false);

  const isKfSelected = useCallback(
    (paramId: string, kfId: string) =>
      selectedKfs.some(
        (s) => s.parameterId === paramId && s.keyframeId === kfId
      ),
    [selectedKfs]
  );

  // Resolve target keyframes for Curve Editor (explicit selection, else active track's current/nearest keyframe)
  const resolveCurveTargetSelection = useCallback((): KeyframeSelectionItem[] => {
    if (selectedKfs.length > 0) return selectedKfs;
    const activeTrack = effect.tracks[selectedParamId];
    if (activeTrack && activeTrack.keyframes.length > 0) {
      const sorted = [...activeTrack.keyframes].sort((a, b) => a.frame - b.frame);
      const exactOrPrev =
        [...sorted].reverse().find((k) => k.frame <= currentFrame) ?? sorted[0];
      return [{ parameterId: selectedParamId, keyframeId: exactOrPrev.id }];
    }
    for (const param of effect.puppet.parameters) {
      const tr = effect.tracks[param.id];
      if (tr && tr.keyframes.length > 0) {
        return [{ parameterId: param.id, keyframeId: tr.keyframes[0].id }];
      }
    }
    return [];
  }, [selectedKfs, effect.tracks, effect.puppet.parameters, selectedParamId, currentFrame]);

  const openCurveEditor = useCallback(() => {
    const targets = resolveCurveTargetSelection();
    if (targets.length > 0) {
      const first = targets[0];
      const kf = effect.tracks[first.parameterId]?.keyframes.find(
        (k) => k.id === first.keyframeId
      );
      if (kf) {
        setDraftEasing(kf.easing === 'easeInOut' ? 'bezier' : kf.easing);
        setDraftBezier(kf.bezier ? [...kf.bezier] : [0.42, 0.0, 0.58, 1.0]);
      }
    }
    setShowCurveEditor(true);
  }, [resolveCurveTargetSelection, effect.tracks]);

  // Close context menu on outside click / Escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // Keyboard shortcuts (Ctrl+C, Ctrl+X, Ctrl+V, Delete) when Animation panel is focused or has selected keyframes
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      const insideAnim = containerRef.current?.contains(document.activeElement);
      if (!insideAnim && selectedKfs.length === 0) return;

      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F9') {
        e.preventDefault();
        openCurveEditor();
      } else if (mod && e.key.toLowerCase() === 'c' && selectedKfs.length > 0) {
        e.preventDefault();
        onCopySelectedKeyframes(selectedKfs, false);
      } else if (mod && e.key.toLowerCase() === 'x' && selectedKfs.length > 0) {
        e.preventDefault();
        onCopySelectedKeyframes(selectedKfs, true);
        setSelectedKfs([]);
      } else if (mod && e.key.toLowerCase() === 'v' && clipboard.length > 0) {
        e.preventDefault();
        onPasteKeyframesAtFrame(currentFrame);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedKfs.length > 0) {
          e.preventDefault();
          onDeleteSelectedKeyframes(selectedKfs);
          setSelectedKfs([]);
        } else if (insideAnim) {
          const kfHere = effect.tracks[selectedParamId]?.keyframes.find(
            (k) => k.frame === currentFrame
          );
          if (kfHere) {
            e.preventDefault();
            onDeleteSelectedKeyframes([
              { parameterId: selectedParamId, keyframeId: kfHere.id },
            ]);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedKfs,
    selectedParamId,
    effect.tracks,
    clipboard.length,
    currentFrame,
    openCurveEditor,
    onCopySelectedKeyframes,
    onPasteKeyframesAtFrame,
    onDeleteSelectedKeyframes,
  ]);

  const clientXToFrame = useCallback(
    (clientX: number) => {
      const rulerEl = rulerRef.current;
      if (!rulerEl) return currentFrame;
      const rect = rulerEl.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / width));
      return Math.round(t * durationFrames);
    },
    [currentFrame, durationFrames]
  );

  const handlePlayheadPointerDown = (
    e: React.PointerEvent<HTMLElement>
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    containerRef.current?.focus();
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    onChangeFrame(clientXToFrame(e.clientX));
  };

  const handlePlayheadPointerMove = (
    e: React.PointerEvent<HTMLElement>
  ) => {
    if (!isScrubbingRef.current) return;
    e.stopPropagation();
    onChangeFrame(clientXToFrame(e.clientX));
  };

  const handlePlayheadPointerUp = (
    e: React.PointerEvent<HTMLElement>
  ) => {
    if (!isScrubbingRef.current) return;
    e.stopPropagation();
    isScrubbingRef.current = false;
    setIsScrubbing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handlePlayheadKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChangeFrame(Math.min(durationFrames, currentFrame + step));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChangeFrame(Math.max(0, currentFrame - step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChangeFrame(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChangeFrame(durationFrames);
    }
  };

  // Start dragging selected keyframe(s) horizontally
  const handleKeyframePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    paramId: string,
    kfId: string,
    kfFrame: number
  ) => {
    if (e.button === 2) return; // right click opens context menu
    e.stopPropagation();
    containerRef.current?.focus();
    onSelectParam(paramId);

    const already = isKfSelected(paramId, kfId);
    let nextSel: KeyframeSelectionItem[];
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      nextSel = already
        ? selectedKfs.filter(
            (s) => !(s.parameterId === paramId && s.keyframeId === kfId)
          )
        : [...selectedKfs, { parameterId: paramId, keyframeId: kfId }];
      setSelectedKfs(nextSel);
      return;
    } else if (already) {
      nextSel = selectedKfs;
    } else {
      nextSel = [{ parameterId: paramId, keyframeId: kfId }];
      setSelectedKfs(nextSel);
      onChangeFrame(kfFrame);
    }

    const trackRowEl = e.currentTarget.parentElement;
    const trackWidth = trackRowEl?.getBoundingClientRect().width || 380;
    kfDragRef.current = {
      active: true,
      startClientX: e.clientX,
      trackWidth,
      appliedDelta: 0,
      selection: nextSel,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleKeyframePointerMove = (
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    const drag = kfDragRef.current;
    if (!drag.active) return;
    const dxPx = e.clientX - drag.startClientX;
    const desiredDelta = Math.round(
      (dxPx / Math.max(40, drag.trackWidth)) * durationFrames
    );
    const step = desiredDelta - drag.appliedDelta;
    if (step !== 0) {
      drag.appliedDelta = desiredDelta;
      onMoveSelectedKeyframes(drag.selection, step);
    }
  };

  const handleKeyframePointerUp = (
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    kfDragRef.current.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Marquee multi-select on empty track area
  const handleTracksPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    const area = tracksAreaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top + area.scrollTop;
    // Only start marquee if pointer is in the right-side timeline lane (past 128px label column)
    if (x < 128) return;

    marqueeActiveRef.current = true;
    setMarquee({ startX: x, startY: y, curX: x, curY: y });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleTracksPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!marqueeActiveRef.current || !marquee) return;
    const area = tracksAreaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top + area.scrollTop;
    setMarquee((prev) => (prev ? { ...prev, curX: x, curY: y } : null));
  };

  const handleTracksPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!marqueeActiveRef.current || !marquee) return;
    marqueeActiveRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const dist = Math.hypot(
      marquee.curX - marquee.startX,
      marquee.curY - marquee.startY
    );
    const area = tracksAreaRef.current;
    const rulerEl = rulerRef.current;
    if (dist > 6 && area) {
      const minX = Math.min(marquee.startX, marquee.curX);
      const maxX = Math.max(marquee.startX, marquee.curX);
      const minY = Math.min(marquee.startY, marquee.curY);
      const maxY = Math.max(marquee.startY, marquee.curY);

      const areaRect = area.getBoundingClientRect();
      const rulerRect = rulerEl?.getBoundingClientRect();
      const laneOffsetX = rulerRect ? rulerRect.left - areaRect.left : 138;
      const laneWidth = Math.max(
        1,
        rulerRect ? rulerRect.width : area.clientWidth - 148
      );
      const rowHeight = 24;
      const rulerHeight = 24 + (audioTrack ? 32 : 0);

      const hits: KeyframeSelectionItem[] = [];
      visibleParameters.forEach((param, rowIdx) => {
        const rowCenterY = rulerHeight + rowIdx * rowHeight + rowHeight * 0.5;
        if (rowCenterY < minY || rowCenterY > maxY) return;
        const track = effect.tracks[param.id];
        if (!track) return;
        for (const kf of track.keyframes) {
          const kfX =
            laneOffsetX + (kf.frame / Math.max(1, durationFrames)) * laneWidth;
          if (kfX >= minX && kfX <= maxX) {
            hits.push({ parameterId: param.id, keyframeId: kf.id });
          }
        }
      });
      setSelectedKfs(hits);
    } else if (area) {
      // Plain click on empty lane: clear selection & scrub playhead using exact ruler coordinates
      setSelectedKfs([]);
      onChangeFrame(clientXToFrame(e.clientX));
    }

    setMarquee(null);
  };

  const openTimelineContextMenu = (
    e: React.MouseEvent,
    paramId?: string,
    kfId?: string,
    kfFrame?: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (paramId && kfId && !isKfSelected(paramId, kfId)) {
      setSelectedKfs([{ parameterId: paramId, keyframeId: kfId }]);
      if (kfFrame !== undefined) onChangeFrame(kfFrame);
    }
    const targetFrame = kfFrame ?? currentFrame;
    setContextMenu({
      x: Math.min(window.innerWidth - 175, e.clientX),
      y: Math.min(window.innerHeight - 160, e.clientY),
      frame: targetFrame,
    });
  };

  const tickStep = Math.max(15, Math.round(durationFrames / 6));
  const ticks: number[] = [];
  for (let t = 0; t <= durationFrames; t += tickStep) ticks.push(t);
  if (ticks[ticks.length - 1] !== durationFrames) ticks.push(durationFrames);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="flex-1 flex flex-col min-h-0 outline-none"
    >
      {/* Top Transport, Adjustable FPS, Connect to Parameter & Add/Del Keyframe */}
      <div className="px-2 py-1 border-b border-[#363636] bg-[#212121] flex items-center justify-between gap-1.5 overflow-x-auto">
        {/* Transport + Adjustable FPS */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onChangeFrame(0)}
            aria-label="Jump to frame 0"
            className="p-1 rounded bg-[#2F2F2F] hover:bg-[#3A3A3A] text-[#DCDCDC]"
          >
            <SkipBack className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
            className="px-2 py-1 rounded bg-[#2D8CEB] hover:bg-[#1E7AD6] text-white text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3 h-3" />
                Pause
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                Play
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => onChangeFrame(durationFrames)}
            aria-label="Jump to end frame"
            className="p-1 rounded bg-[#2F2F2F] hover:bg-[#3A3A3A] text-[#DCDCDC]"
          >
            <SkipForward className="w-3 h-3" />
          </button>
          <span className="ml-1 font-mono tabular-nums text-[10px] text-[#38BDF8] whitespace-nowrap">
            F{currentFrame}
            <span className="text-[#888888]">/{durationFrames}</span>
          </span>

          {/* Adjustable FPS */}
          <label
            className="ml-1 flex items-center gap-1 text-[10px] text-[#A8A8A8]"
            title="Animation frame rate (FPS)"
          >
            <input
              type="number"
              aria-label="Animation FPS"
              min={1}
              max={120}
              value={fps}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10);
                if (Number.isFinite(parsed)) {
                  onChangeFps(Math.max(1, Math.min(120, parsed)));
                }
              }}
              className="w-10 px-1 py-0.5 rounded bg-[#141414] border border-[#424242] font-mono tabular-nums text-[10px] text-[#ECECEC] text-center"
            />
            <span>fps</span>
          </label>
        </div>

        {/* Connect to Parameter + Add / Delete Keyframe (Copy/Cut/Paste are via Right-Click or Ctrl+C/X/V) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <label
            title="When checked, clicking or moving parameters in the Parameter tab or 2D Pad automatically records keyframes at the current timestamp (including Frame 0)"
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] cursor-pointer whitespace-nowrap select-none transition-colors ${
              effect.connectToParameter
                ? 'bg-[#2D8CEB]/25 border-[#2D8CEB] text-[#E0F2FE] font-medium'
                : 'bg-[#292929] border-[#3F3F3F] text-[#E2E2E2] hover:bg-[#323232]'
            }`}
          >
            <input
              type="checkbox"
              checked={Boolean(effect.connectToParameter)}
              onChange={(e) => onToggleConnectToParameter(e.target.checked)}
              className="accent-[#2D8CEB]"
            />
            Connect to Parameter
          </label>

          <button
            type="button"
            disabled={!selectedParamId || effect.puppet.parameters.length === 0}
            onClick={() => onAddKeyframe(selectedParamId)}
            aria-label="Add keyframe at current frame"
            title="Add keyframe on active parameter at current timestamp (select keyframes and press Delete key to remove)"
            className="px-1.5 py-1 rounded bg-[#2F2F2F] hover:bg-[#3B3B3B] border border-[#424242] text-[10px] font-medium text-[#E5E5E5] flex items-center gap-1 whitespace-nowrap disabled:opacity-45"
          >
            <Diamond className="w-2.5 h-2.5 text-[#F59E0B]" />
            Add
          </button>

          <button
            type="button"
            onClick={() => setShowAnimatedOnly((v) => !v)}
            aria-pressed={showAnimatedOnly && animatedParamCount > 0}
            aria-label="Filter animated parameter tracks"
            data-testid="toggle-animated-tracks-filter"
            disabled={animatedParamCount === 0}
            title={
              animatedParamCount > 0
                ? showAnimatedOnly
                  ? 'Showing only animated parameter tracks — click to show all tracks'
                  : `Show only the ${animatedParamCount} animated parameter track(s)`
                : 'No animated tracks yet'
            }
            className={`px-1.5 py-1 rounded border text-[10px] font-medium transition-colors whitespace-nowrap disabled:opacity-45 ${
              showAnimatedOnly && animatedParamCount > 0
                ? 'bg-[#2D8CEB] border-[#52A3F5] text-white'
                : 'bg-[#2F2F2F] hover:bg-[#3B3B3B] border-[#424242] text-[#E5E5E5]'
            }`}
          >
            Animated ({animatedParamCount})
          </button>

          <button
            type="button"
            onClick={() =>
              showCurveEditor ? setShowCurveEditor(false) : openCurveEditor()
            }
            aria-label="Open Keyframe Curve Editor"
            aria-pressed={showCurveEditor}
            title="Open Keyframe Easing & Bezier Curve Editor (F9)"
            className={`px-1.5 py-1 rounded border text-[10px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              showCurveEditor
                ? 'bg-[#2D8CEB] border-[#52A3F5] text-white'
                : 'bg-[#2F2F2F] hover:bg-[#3B3B3B] border-[#424242] text-[#E5E5E5]'
            }`}
          >
            <Spline className="w-3 h-3 text-[#38BDF8]" />
            Curves
          </button>
        </div>
      </div>

      {/* Hidden Audio File Input */}
      <input
        ref={audioFileInputRef}
        type="file"
        accept="audio/*"
        aria-label="Import audio track"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImportAudioFile(file);
          e.target.value = '';
        }}
      />

      {/* Interactive Timeline Grid: Marquee Multi-Select, Drag-to-Move, Right-Click & Ctrl+C/X/V */}
      <div
        ref={tracksAreaRef}
        onPointerDown={handleTracksPointerDown}
        onPointerMove={handleTracksPointerMove}
        onPointerUp={handleTracksPointerUp}
        onContextMenu={(e) => openTimelineContextMenu(e)}
        className="relative flex-1 overflow-y-auto overflow-x-hidden bg-[#1D1D1D] select-none"
      >
        {/* Sticky Ruler Row */}
        <div className="sticky top-0 z-30 flex items-center h-6 bg-[#242424] border-b border-[#363636]">
          <div className="w-[128px] shrink-0 px-2 text-[10px] font-semibold text-[#9A9A9A] border-r border-[#363636] flex items-center justify-between">
            <span>Track</span>
            {selectedKfs.length > 0 && (
              <span className="font-mono text-[9px] text-[#38BDF8]">
                {selectedKfs.length} sel
              </span>
            )}
          </div>
          <div className="flex-1 h-full px-2.5">
            <div
              ref={rulerRef}
              data-testid="timeline-ruler"
              onPointerDown={handlePlayheadPointerDown}
              onPointerMove={handlePlayheadPointerMove}
              onPointerUp={handlePlayheadPointerUp}
              onPointerCancel={handlePlayheadPointerUp}
              title="Click or drag anywhere on the ruler to scrub timeline"
              className="relative w-full h-full cursor-ew-resize touch-none"
            >
              {ticks.map((tick) => {
                const pct = (tick / Math.max(1, durationFrames)) * 100;
                return (
                  <span
                    key={tick}
                    style={{ left: `${pct}%` }}
                    className="pointer-events-none absolute top-1 -translate-x-1/2 font-mono tabular-nums text-[9px] text-[#8A8A8A]"
                  >
                    {tick}
                  </span>
                );
              })}
              {/* Draggable Blue Playhead (Current Time Indicator) Cap + Stem */}
              <div
                role="slider"
                tabIndex={0}
                aria-label="Timeline playhead"
                aria-valuemin={0}
                aria-valuemax={durationFrames}
                aria-valuenow={currentFrame}
                data-testid="timeline-playhead-handle"
                style={{ left: `${playheadPct}%` }}
                onPointerDown={handlePlayheadPointerDown}
                onPointerMove={handlePlayheadPointerMove}
                onPointerUp={handlePlayheadPointerUp}
                onPointerCancel={handlePlayheadPointerUp}
                onKeyDown={handlePlayheadKeyDown}
                title={`Frame ${currentFrame}/${durationFrames} — Drag to scrub timeline`}
                className="group absolute top-0 bottom-0 -translate-x-1/2 w-4 flex flex-col items-center cursor-ew-resize touch-none z-20 outline-none"
              >
                <svg
                  viewBox="0 0 12 11"
                  className={`w-3 h-[11px] shrink-0 drop-shadow-sm transition-transform ${
                    isScrubbing
                      ? 'scale-110 text-[#60A5FA]'
                      : 'text-[#2D8CEB] group-hover:text-[#4CA2F6]'
                  }`}
                >
                  <path
                    d="M1 0.5H11V5.5L6 10.5L1 5.5V0.5Z"
                    fill="currentColor"
                    stroke="#93C5FD"
                    strokeWidth="0.9"
                  />
                </svg>
                <span
                  className={`w-[2px] flex-1 ${
                    isScrubbing ? 'bg-[#60A5FA]' : 'bg-[#2D8CEB]'
                  }`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Optional Audio Waveform Track Row */}
        {audioTrack && (
          <div
            data-testid="audio-waveform-track"
            className="flex items-center h-8 border-b border-[#343434] bg-[#16202A]/80"
          >
            <div className="w-[128px] shrink-0 h-full px-2 border-r border-[#333333] flex items-center justify-between gap-1 text-[10px]">
              <span className="flex items-center gap-1 text-[#38BDF8] font-medium truncate">
                <AudioWaveform className="w-3 h-3 shrink-0" />
                <span className="truncate" title={audioTrack.fileName}>
                  {audioTrack.fileName}
                </span>
              </span>
              <button
                type="button"
                onClick={onClearAudioTrack}
                aria-label="Remove audio track"
                title="Remove audio track"
                className="text-[#8A9AA8] hover:text-[#FCA5A5] shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 h-full px-2.5 overflow-hidden">
              <div className="relative w-full h-full">
                {/* Playhead indicator over waveform */}
                <div
                  style={{ left: `${playheadPct}%` }}
                  onPointerDown={handlePlayheadPointerDown}
                  onPointerMove={handlePlayheadPointerMove}
                  onPointerUp={handlePlayheadPointerUp}
                  onPointerCancel={handlePlayheadPointerUp}
                  className="absolute top-0 bottom-0 -translate-x-1/2 w-3 flex justify-center cursor-ew-resize touch-none z-10"
                >
                  <span className="w-[1.5px] h-full bg-[#38BDF8] pointer-events-none" />
                </div>
                <svg
                  viewBox={`0 0 ${Math.max(1, audioTrack.peaks.length)} 24`}
                  preserveAspectRatio="none"
                  className="w-full h-full block pointer-events-none"
                >
                  <line
                    x1={0}
                    y1={12}
                    x2={Math.max(1, audioTrack.peaks.length)}
                    y2={12}
                    stroke="#1E3A5F"
                    strokeWidth="0.6"
                  />
                  {audioTrack.peaks.map((amp, i) => {
                    const h = Math.max(1, amp * 20);
                    return (
                      <rect
                        key={i}
                        x={i}
                        y={12 - h * 0.5}
                        width={0.78}
                        height={h}
                        fill={amp > 0.25 ? '#38BDF8' : '#1E6091'}
                      />
                    );
                  })}
                </svg>
              </div>
            </div>
            <div className="shrink-0 h-full px-1.5 border-l border-[#2B3D52] bg-[#141E28] flex items-center">
              <button
                type="button"
                onClick={onGenerateLipSync}
                title="Auto-generate Mouth Open keyframes from the loaded audio waveform"
                className="px-2 py-0.5 rounded bg-[#2D8CEB] hover:bg-[#1E7AD6] border border-[#52A3F5] text-[10px] font-semibold text-white flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <Mic className="w-2.5 h-2.5" />
                Auto Lip-Sync
              </button>
            </div>
          </div>
        )}

        {/* Parameter Keyframe Rows */}
        {visibleParameters.length === 0 && (
          <div className="px-4 py-6 text-center text-[11px] text-[#8A8F9A]">
            No parameters yet — add your own parameter in the Parameter panel to create animation tracks.
          </div>
        )}
        {visibleParameters.map((param) => {
          const track = effect.tracks[param.id];
          const kfCount = track?.keyframes.length ?? 0;
          const isSel = param.id === selectedParamId;
          const valNow = evaluateTrackAtFrame(track, currentFrame, param.value);
          return (
            <div
              key={param.id}
              ref={(el) => {
                trackRowRefs.current[param.id] = el;
              }}
              data-testid={`anim-track-row-${param.id}`}
              data-keyframe-count={kfCount}
              className={`flex items-center h-6 border-b border-[#2A2A2A] ${
                isSel ? 'bg-[#2D8CEB]/18' : 'hover:bg-[#252525]'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectParam(param.id)}
                className="w-[128px] shrink-0 h-full px-2 border-r border-[#333333] flex items-center justify-between gap-1 text-[10px] text-left"
              >
                <span
                  className={`truncate flex items-center gap-1 min-w-0 ${
                    isSel
                      ? 'text-white font-semibold'
                      : kfCount > 0
                        ? 'text-[#FDE68A] font-medium'
                        : 'text-[#CCCCCC]'
                  }`}
                >
                  {kfCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="w-1.5 h-1.5 rotate-45 bg-[#F59E0B] shrink-0"
                    />
                  )}
                  <span className="truncate">{param.name}</span>
                </span>
                <span className="font-mono tabular-nums text-[9px] text-[#8E8E8E] shrink-0">
                  {valNow.toFixed(1)}
                </span>
              </button>

              <div className="flex-1 h-full px-2.5 cursor-crosshair">
                <div className="relative w-full h-full">
                  {/* Draggable Blue Playhead vertical line hit-strip */}
                  <div
                    data-testid="timeline-playhead-line"
                    style={{ left: `${playheadPct}%` }}
                    onPointerDown={handlePlayheadPointerDown}
                    onPointerMove={handlePlayheadPointerMove}
                    onPointerUp={handlePlayheadPointerUp}
                    onPointerCancel={handlePlayheadPointerUp}
                    title="Drag blue playhead line to scrub timeline"
                    className="absolute top-0 bottom-0 -translate-x-1/2 w-3 flex justify-center cursor-ew-resize touch-none z-[5]"
                  >
                    <span
                      className={`w-[1.5px] h-full pointer-events-none ${
                        isScrubbing ? 'bg-[#60A5FA]' : 'bg-[#2D8CEB]/85'
                      }`}
                    />
                  </div>

                  {/* Interactive Draggable / Multi-Selectable Keyframe Diamonds */}
                  {track?.keyframes.map((kf) => {
                    const pct = (kf.frame / Math.max(1, durationFrames)) * 100;
                    const isKfSel = isKfSelected(param.id, kf.id);
                    const isAtPlayhead = kf.frame === currentFrame;
                    return (
                      <button
                        key={kf.id}
                        type="button"
                        data-selected={isKfSel ? 'true' : 'false'}
                        onPointerDown={(e) =>
                          handleKeyframePointerDown(e, param.id, kf.id, kf.frame)
                        }
                        onPointerMove={handleKeyframePointerMove}
                        onPointerUp={handleKeyframePointerUp}
                        onContextMenu={(e) =>
                          openTimelineContextMenu(e, param.id, kf.id, kf.frame)
                        }
                        aria-label={`Keyframe ${param.name} at frame ${kf.frame}`}
                        title={`Frame ${kf.frame}: ${kf.value.toFixed(2)} (${kf.easing}${kf.bezier ? ` [${kf.bezier.map((v) => v.toFixed(2)).join(', ')}]` : ''}) · Drag to move · F9 Curves · Right-Click actions`}
                        style={{ left: `${pct}%` }}
                        className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 ${
                          kf.easing === 'hold' ? 'rotate-0 rounded-[1px]' : 'rotate-45'
                        } border cursor-ew-resize transition-transform hover:scale-125 ${
                          isKfSel
                            ? 'bg-[#2D8CEB] border-white ring-2 ring-[#60A5FA]/70 scale-125 z-20'
                            : kf.fromPhysics
                              ? isAtPlayhead
                                ? 'bg-[#38BDF8] border-white z-[15]'
                                : 'bg-[#0EA5E9] border-[#7DD3FC] z-[15]'
                              : kf.easing === 'bezier'
                                ? isAtPlayhead
                                  ? 'bg-[#38BDF8] border-white z-[15]'
                                  : 'bg-[#F59E0B] border-[#38BDF8] ring-1 ring-[#38BDF8]/70 z-[15]'
                                : isAtPlayhead
                                  ? 'bg-[#FBBF24] border-white z-[15]'
                                  : 'bg-[#F59E0B] border-[#FDE68A] z-[15]'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}

        {/* Marquee Multi-Select Box Overlay */}
        {marquee && (
          <div
            style={{
              left: `${Math.min(marquee.startX, marquee.curX)}px`,
              top: `${Math.min(marquee.startY, marquee.curY)}px`,
              width: `${Math.abs(marquee.curX - marquee.startX)}px`,
              height: `${Math.abs(marquee.curY - marquee.startY)}px`,
            }}
            className="pointer-events-none absolute z-30 border border-[#38BDF8] bg-[#2D8CEB]/20"
          />
        )}
      </div>

      {/* Right-Click Keyframe Context Menu */}
      {contextMenu && (
        <div
          role="menu"
          aria-label="Keyframe actions"
          data-testid="keyframe-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed z-[95] w-[172px] p-1 rounded-[6px] bg-[#202020] border border-[#4A4A4A] shadow-2xl space-y-0.5 text-[11px]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              openCurveEditor();
            }}
            className="w-full px-2 py-1.5 rounded text-left text-[#93C5FD] hover:bg-[#2D8CEB] hover:text-white flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <Spline className="w-3 h-3" />
              Edit Curve...
            </span>
            <span className="text-[9px] opacity-70 font-mono">F9</span>
          </button>
          <div className="my-0.5 border-t border-[#363636]" />
          <button
            type="button"
            role="menuitem"
            disabled={selectedKfs.length === 0}
            onClick={() => {
              onCopySelectedKeyframes(selectedKfs, false);
              setContextMenu(null);
            }}
            className="w-full px-2 py-1.5 rounded text-left text-[#E5E5E5] hover:bg-[#2D8CEB] hover:text-white disabled:opacity-40 flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <Copy className="w-3 h-3" />
              Copy ({selectedKfs.length})
            </span>
            <span className="text-[9px] opacity-70 font-mono">Ctrl+C</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={selectedKfs.length === 0}
            onClick={() => {
              onCopySelectedKeyframes(selectedKfs, true);
              setSelectedKfs([]);
              setContextMenu(null);
            }}
            className="w-full px-2 py-1.5 rounded text-left text-[#E5E5E5] hover:bg-[#2D8CEB] hover:text-white disabled:opacity-40 flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <Scissors className="w-3 h-3" />
              Cut ({selectedKfs.length})
            </span>
            <span className="text-[9px] opacity-70 font-mono">Ctrl+X</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={clipboard.length === 0}
            onClick={() => {
              onPasteKeyframesAtFrame(contextMenu.frame);
              setContextMenu(null);
            }}
            className="w-full px-2 py-1.5 rounded text-left text-[#E5E5E5] hover:bg-[#2D8CEB] hover:text-white disabled:opacity-40 flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <Clipboard className="w-3 h-3" />
              Paste @ F{contextMenu.frame}
            </span>
            <span className="text-[9px] opacity-70 font-mono">Ctrl+V</span>
          </button>
          <div className="my-0.5 border-t border-[#363636]" />
          <button
            type="button"
            role="menuitem"
            disabled={selectedKfs.length === 0}
            onClick={() => {
              onDeleteSelectedKeyframes(selectedKfs);
              setSelectedKfs([]);
              setContextMenu(null);
            }}
            className="w-full px-2 py-1.5 rounded text-left text-[#FCA5A5] hover:bg-[#7F1D1D] hover:text-white disabled:opacity-40 flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <Trash2 className="w-3 h-3" />
              Delete Selected
            </span>
            <span className="text-[9px] opacity-70 font-mono">Del</span>
          </button>
        </div>
      )}

      {/* Keyframe Curve Editor Popover (Bezier Graph + Presets + Favorites) */}
      {showCurveEditor && (() => {
        const targets = resolveCurveTargetSelection();
        const summary =
          selectedKfs.length > 0
            ? `${selectedKfs.length} selected kf`
            : targets.length > 0
              ? `${
                  effect.puppet.parameters.find(
                    (p) => p.id === targets[0].parameterId
                  )?.name ?? targets[0].parameterId
                }`
              : 'No keyframes';
        return (
          <CurveEditorPopover
            presets={curvePresets}
            activeEasing={draftEasing}
            activeBezier={draftBezier}
            targetSummary={summary}
            onChangeCurve={(easing, bezier) => {
              setDraftEasing(easing);
              setDraftBezier(bezier);
            }}
            onApplyCurve={(easing, bezier) => {
              const targetSel = resolveCurveTargetSelection();
              if (targetSel.length > 0) {
                onApplyKeyframeEasing(targetSel, easing, bezier);
              }
            }}
            onToggleFavorite={onToggleFavoriteCurve}
            onSavePreset={onSaveCurvePreset}
            onDeletePreset={onDeleteCurvePreset}
            onClose={() => setShowCurveEditor(false)}
          />
        );
      })()}

      {/* Bottom Action Bar: Physics Baking + Audio / Demo Voice + Keyframe in After Effects */}
      <div className="px-2 py-1 border-t border-[#363636] bg-[#1F1F1F] flex items-center justify-between gap-1 overflow-x-auto">
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onBakePhysicsKeyframes}
            className="px-1.5 py-1 rounded bg-[#2F2F2F] hover:bg-[#3C3C3C] border border-[#454545] text-[10px] font-medium text-[#E8E8E8] flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3 h-3 text-[#38BDF8]" />
            Add Physics
          </button>
          <button
            type="button"
            onClick={onRemovePhysicsKeyframes}
            className="px-1.5 py-1 rounded bg-[#2F2F2F] hover:bg-[#4A2525] border border-[#454545] text-[10px] font-medium text-[#E8E8E8] transition-colors whitespace-nowrap"
          >
            Remove Physics
          </button>
          <button
            type="button"
            onClick={onUpdatePhysicsKeyframes}
            className="px-1.5 py-1 rounded bg-[#2F2F2F] hover:bg-[#3C3C3C] border border-[#454545] text-[10px] font-medium text-[#E8E8E8] flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-2.5 h-2.5 text-[#38BDF8]" />
            Update Physics
          </button>

          <span className="mx-0.5 h-3.5 w-px bg-[#3C3C3C]" />

          {/* Audio Import & Demo Voice — always visible so user can load, swap, or toggle anytime */}
          <button
            type="button"
            onClick={() => audioFileInputRef.current?.click()}
            title="Import .mp3, .wav, or .ogg audio track for waveform & auto lip-sync"
            className={`px-1.5 py-1 rounded border text-[10px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              audioTrack && !audioTrack.isDemo
                ? 'bg-[#2D8CEB] border-[#52A3F5] text-white'
                : 'bg-[#2B2B2B] hover:bg-[#383838] border-[#454545] text-[#E0E0E0]'
            }`}
          >
            <Upload className="w-2.5 h-2.5" />
            Audio
          </button>
          <button
            type="button"
            aria-pressed={Boolean(audioTrack?.isDemo)}
            onClick={() => {
              if (audioTrack?.isDemo) {
                onClearAudioTrack();
              } else {
                onLoadDemoVoice();
              }
            }}
            title={
              audioTrack?.isDemo
                ? 'Click to remove Demo Voice track'
                : 'Load a built-in synthesized demo voice clip to test Waveform + Auto Lip-Sync'
            }
            className={`px-1.5 py-1 rounded border text-[10px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              audioTrack?.isDemo
                ? 'bg-[#2D8CEB] border-[#52A3F5] text-white'
                : 'bg-[#2B2B2B] hover:bg-[#383838] border-[#454545] text-[#38BDF8]'
            }`}
          >
            <AudioWaveform className="w-2.5 h-2.5" />
            Demo Voice
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleKeyframeTarget}
            aria-pressed={isAeMode}
            title="Switch between animating inside Rioka plugin timeline or directly inside After Effects"
            className={`px-1.5 py-1 rounded border text-[10px] font-medium transition-colors whitespace-nowrap ${
              isAeMode
                ? 'bg-[#2D8CEB] border-[#52A3F5] text-white'
                : 'bg-[#2B2B2B] border-[#454545] text-[#D4D4D4] hover:bg-[#383838]'
            }`}
          >
            {isAeMode ? 'AE Keyframes: ON' : 'Keyframe in After Effects'}
          </button>
          {isAeMode && (
            <button
              type="button"
              onClick={onSendKeyframesToAfterEffects}
              title="Export runnable After Effects ExtendScript (.jsx) to apply keyframes directly onto your AE Solid Layer"
              className="px-1.5 py-1 rounded bg-[#2D8CEB] hover:bg-[#1E7AD6] border border-[#52A3F5] text-white text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              Export AE (.jsx)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
