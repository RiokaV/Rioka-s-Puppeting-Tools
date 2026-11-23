import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Star, Trash2, X } from 'lucide-react';
import type {
  CubicBezierTuple,
  EasingCurvePreset,
  KeyframeEasing,
} from '../types/puppet';

interface CurveEditorPopoverProps {
  presets: EasingCurvePreset[];
  activeEasing: KeyframeEasing;
  activeBezier: CubicBezierTuple;
  targetSummary: string;
  onChangeCurve: (easing: KeyframeEasing, bezier: CubicBezierTuple) => void;
  onApplyCurve: (easing: KeyframeEasing, bezier: CubicBezierTuple) => void;
  onToggleFavorite: (presetId: string) => void;
  onSavePreset: (
    name: string,
    easing: KeyframeEasing,
    bezier: CubicBezierTuple
  ) => void;
  onDeletePreset: (presetId: string) => void;
  onClose: () => void;
}

const SVG_W = 196;
const SVG_H = 148;
const PAD_X = 18;
const PAD_Y = 26;
const GRAPH_W = SVG_W - PAD_X * 2;
const GRAPH_H = SVG_H - PAD_Y * 2;

function toSvgX(nx: number): number {
  return PAD_X + nx * GRAPH_W;
}

function toSvgY(ny: number): number {
  return PAD_Y + (1 - ny) * GRAPH_H;
}

function renderMiniCurvePath(
  easing: KeyframeEasing,
  b: CubicBezierTuple
): string {
  if (easing === 'hold') {
    return 'M 4 24 L 28 24 L 28 4';
  }
  if (easing === 'linear') {
    return 'M 4 24 L 28 4';
  }
  const x1 = 4 + b[0] * 24;
  const y1 = 24 - Math.max(-0.3, Math.min(1.3, b[1])) * 20;
  const x2 = 4 + b[2] * 24;
  const y2 = 24 - Math.max(-0.3, Math.min(1.3, b[3])) * 20;
  return `M 4 24 C ${x1.toFixed(1)} ${y1.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}, 28 4`;
}

export function CurveEditorPopover({
  presets,
  activeEasing,
  activeBezier,
  targetSummary,
  onChangeCurve,
  onApplyCurve,
  onToggleFavorite,
  onSavePreset,
  onDeletePreset,
  onClose,
}: CurveEditorPopoverProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingHandleRef = useRef<'p1' | 'p2' | null>(null);
  const [filterTab, setFilterTab] = useState<'all' | 'favorites'>('all');
  const [newPresetName, setNewPresetName] = useState('');

  const updateHandleFromPointer = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const handle = draggingHandleRef.current;
    if (!svg || !handle) return;
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / Math.max(1, rect.width)) * SVG_W;
    const sy = ((clientY - rect.top) / Math.max(1, rect.height)) * SVG_H;

    const nx = Math.max(0, Math.min(1, (sx - PAD_X) / GRAPH_W));
    const ny = Math.max(-0.45, Math.min(1.45, 1 - (sy - PAD_Y) / GRAPH_H));
    const rx = Math.round(nx * 100) / 100;
    const ry = Math.round(ny * 100) / 100;

    const nextBezier: CubicBezierTuple =
      handle === 'p1'
        ? [rx, ry, activeBezier[2], activeBezier[3]]
        : [activeBezier[0], activeBezier[1], rx, ry];
    onChangeCurve('bezier', nextBezier);
  };

  const visiblePresets =
    filterTab === 'favorites'
      ? presets.filter((p) => p.favorite)
      : [...presets].sort((a, b) => Number(b.favorite) - Number(a.favorite));

  const [x1, y1, x2, y2] = activeBezier;
  const p0x = toSvgX(0);
  const p0y = toSvgY(0);
  const p1x = toSvgX(x1);
  const p1y = toSvgY(y1);
  const p2x = toSvgX(x2);
  const p2y = toSvgY(y2);
  const p3x = toSvgX(1);
  const p3y = toSvgY(1);

  const mainPath =
    activeEasing === 'hold'
      ? `M ${p0x} ${p0y} L ${p3x} ${p0y} L ${p3x} ${p3y}`
      : activeEasing === 'linear'
        ? `M ${p0x} ${p0y} L ${p3x} ${p3y}`
        : `M ${p0x} ${p0y} C ${p1x} ${p1y}, ${p2x} ${p2y}, ${p3x} ${p3y}`;

  const popoverContent = (
    <div
      data-testid="curve-editor-popover"
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed left-1/2 -translate-x-1/2 bottom-[298px] z-[120] w-[492px] rounded-[7px] bg-[#1E1E1E]/98 border border-[#494949] shadow-[0_16px_42px_rgba(0,0,0,0.75)] overflow-hidden text-[11px] select-none"
    >
      {/* Header */}
      <div className="px-2.5 py-1.5 bg-[#171717] border-b border-[#343434] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-[#F0F0F0]">
            Keyframe Curve Editor
          </span>
          <span className="font-mono text-[9.5px] text-[#38BDF8] truncate">
            {targetSummary}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Curve Editor"
          className="text-[#9A9A9A] hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Split: Interactive Bezier Graph (Left) + Presets & Favorites (Right) */}
      <div className="grid grid-cols-[208px_1fr] divide-x divide-[#323232]">
        {/* Left: Draggable SVG Bezier Graph */}
        <div className="p-2 bg-[#1A1A1A] flex flex-col gap-1.5">
          {/* Quick Easing Mode Tabs */}
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            {(
              [
                { id: 'bezier', label: 'Bezier' },
                { id: 'linear', label: 'Linear' },
                { id: 'hold', label: 'Hold' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onChangeCurve(m.id, activeBezier)}
                className={`py-0.5 rounded border font-medium transition-colors ${
                  activeEasing === m.id ||
                  (m.id === 'bezier' && activeEasing === 'easeInOut')
                    ? 'bg-[#2D8CEB] border-[#52A3F5] text-white'
                    : 'bg-[#262626] border-[#3C3C3C] text-[#BDBDBD] hover:bg-[#323232]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            data-testid="curve-editor-svg"
            onPointerMove={(e) => {
              if (draggingHandleRef.current) {
                updateHandleFromPointer(e.clientX, e.clientY);
              }
            }}
            onPointerUp={(e) => {
              draggingHandleRef.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
            className="w-full h-[148px] rounded bg-[#121212] border border-[#383838] touch-none"
          >
            {/* Subtle 4x4 Grid inside 0..1 box */}
            {[0, 0.25, 0.5, 0.75, 1].map((g) => (
              <g key={g}>
                <line
                  x1={toSvgX(g)}
                  y1={toSvgY(0)}
                  x2={toSvgX(g)}
                  y2={toSvgY(1)}
                  stroke={g === 0 || g === 1 ? '#3A3A3A' : '#242424'}
                  strokeWidth={1}
                />
                <line
                  x1={toSvgX(0)}
                  y1={toSvgY(g)}
                  x2={toSvgX(1)}
                  y2={toSvgY(g)}
                  stroke={g === 0 || g === 1 ? '#3A3A3A' : '#242424'}
                  strokeWidth={1}
                />
              </g>
            ))}

            {/* Linear Diagonal Reference */}
            <line
              x1={p0x}
              y1={p0y}
              x2={p3x}
              y2={p3y}
              stroke="#2E2E2E"
              strokeDasharray="3 3"
              strokeWidth={1}
            />

            {/* Tangent Handle Arms (only in Bezier mode) */}
            {activeEasing !== 'linear' && activeEasing !== 'hold' && (
              <>
                <line
                  x1={p0x}
                  y1={p0y}
                  x2={p1x}
                  y2={p1y}
                  stroke="#F59E0B"
                  strokeWidth={1.4}
                  opacity={0.85}
                />
                <line
                  x1={p3x}
                  y1={p3y}
                  x2={p2x}
                  y2={p2y}
                  stroke="#38BDF8"
                  strokeWidth={1.4}
                  opacity={0.85}
                />
              </>
            )}

            {/* Main Curve Path */}
            <path
              d={mainPath}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={2.3}
              strokeLinecap="round"
            />

            {/* Endpoints */}
            <circle cx={p0x} cy={p0y} r={3.5} fill="#A3A3A3" />
            <circle cx={p3x} cy={p3y} r={3.5} fill="#A3A3A3" />

            {/* Draggable Control Handles P1 & P2 */}
            {activeEasing !== 'linear' && activeEasing !== 'hold' && (
              <>
                <circle
                  cx={p1x}
                  cy={p1y}
                  r={6}
                  fill="#F59E0B"
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                  data-testid="bezier-handle-p1"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    draggingHandleRef.current = 'p1';
                    svgRef.current?.setPointerCapture(e.pointerId);
                  }}
                  className="cursor-grab active:cursor-grabbing"
                />
                <circle
                  cx={p2x}
                  cy={p2y}
                  r={6}
                  fill="#38BDF8"
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                  data-testid="bezier-handle-p2"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    draggingHandleRef.current = 'p2';
                    svgRef.current?.setPointerCapture(e.pointerId);
                  }}
                  className="cursor-grab active:cursor-grabbing"
                />
              </>
            )}
          </svg>

          {/* Numeric Cubic-Bezier Readout + Apply Button */}
          <div className="flex items-center justify-between gap-1.5">
            <span
              data-testid="curve-bezier-readout"
              className="font-mono tabular-nums text-[9px] text-[#9E9E9E] whitespace-nowrap"
            >
              {x1.toFixed(2)},{y1.toFixed(2)},{x2.toFixed(2)},{y2.toFixed(2)}
            </span>
            <button
              type="button"
              onClick={() => onApplyCurve(activeEasing, activeBezier)}
              className="px-2 py-1 rounded bg-[#2D8CEB] hover:bg-[#1E7AD6] text-white text-[10px] font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Apply Curve
            </button>
          </div>
        </div>

        {/* Right: Presets + Favorites + Save Custom Curve */}
        <div className="p-2 bg-[#202020] flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  filterTab === 'all'
                    ? 'bg-[#353535] text-white'
                    : 'text-[#9A9A9A] hover:text-white'
                }`}
              >
                All ({presets.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('favorites')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors ${
                  filterTab === 'favorites'
                    ? 'bg-[#353535] text-[#FBBF24]'
                    : 'text-[#9A9A9A] hover:text-[#FBBF24]'
                }`}
              >
                <Star className="w-2.5 h-2.5 fill-current" />
                Favs ({presets.filter((p) => p.favorite).length})
              </button>
            </div>
          </div>

          {/* Preset Cards Grid */}
          <div className="grid grid-cols-2 gap-1 max-h-[122px] overflow-y-auto pr-0.5">
            {visiblePresets.map((preset) => (
              <div
                key={preset.id}
                className="group relative flex items-center gap-1.5 p-1 rounded bg-[#282828] hover:bg-[#323232] border border-[#3B3B3B] transition-colors"
              >
                <button
                  type="button"
                  onClick={() => {
                    onChangeCurve(preset.easing, preset.bezier);
                    onApplyCurve(preset.easing, preset.bezier);
                  }}
                  title={`Apply ${preset.name}`}
                  className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                >
                  <svg
                    width="24"
                    height="22"
                    viewBox="0 0 32 28"
                    className="shrink-0 rounded bg-[#141414] border border-[#343434]"
                  >
                    <path
                      d={renderMiniCurvePath(preset.easing, preset.bezier)}
                      fill="none"
                      stroke={preset.favorite ? '#38BDF8' : '#D4D4D4'}
                      strokeWidth="2.1"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="truncate text-[10px] text-[#E6E6E6] font-medium">
                    {preset.name}
                  </span>
                </button>

                <div className="flex flex-col items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(preset.id)}
                    aria-label={
                      preset.favorite
                        ? `Unfavorite ${preset.name}`
                        : `Favorite ${preset.name}`
                    }
                    className={`p-0.5 rounded transition-colors ${
                      preset.favorite
                        ? 'text-[#FBBF24]'
                        : 'text-[#6A6A6A] hover:text-[#FBBF24]'
                    }`}
                  >
                    <Star
                      className={`w-2.5 h-2.5 ${preset.favorite ? 'fill-current' : ''}`}
                    />
                  </button>
                  {!preset.builtIn && (
                    <button
                      type="button"
                      onClick={() => onDeletePreset(preset.id)}
                      aria-label={`Delete curve preset ${preset.name}`}
                      className="p-0.5 rounded text-[#8A8A8A] hover:text-[#FCA5A5]"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Save Current Curve as Custom Preset */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = newPresetName.trim();
              if (!clean) return;
              onSavePreset(clean, activeEasing, activeBezier);
              setNewPresetName('');
            }}
            className="mt-auto pt-1 border-t border-[#323232] flex items-center gap-1"
          >
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="Save curve preset..."
              aria-label="New curve preset name"
              className="flex-1 min-w-0 px-1.5 py-1 rounded bg-[#141414] border border-[#3E3E3E] text-[10px] text-[#ECECEC] placeholder:text-[#737373]"
            />
            <button
              type="submit"
              disabled={!newPresetName.trim()}
              aria-label="Save curve preset"
              className="px-2 py-1 rounded bg-[#2F2F2F] hover:bg-[#2D8CEB] disabled:opacity-40 text-white text-[10px] font-medium flex items-center gap-0.5 transition-colors shrink-0"
            >
              <Plus className="w-3 h-3" />
              Save
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(popoverContent, document.body)
    : popoverContent;
}
