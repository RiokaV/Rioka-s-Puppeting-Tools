import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FlipHorizontal2,
  FolderPlus,
  MinusCircle,
  Palette,
  Plus,
  RotateCcw,
  Smile,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ExpressionPreset,
  ParameterFolder,
  PuppetDocument,
  RigParameter,
} from '../types/puppet';
import {
  getParameterKeyformStatus,
  parseClampedParameterInput,
} from '../engine/morphTools';

interface ParameterPanelContentProps {
  puppet: PuppetDocument;
  selectedParamId: string;
  selectedLayerId: string;
  physicsParamOffsets: Record<string, number>;
  showLinkedPad: boolean;
  expressions: ExpressionPreset[];
  onToggleLinkedPad: () => void;
  onSelectParam: (paramId: string) => void;
  onChangeParamValue: (paramId: string, value: number) => void;
  onTouchParamForConnect?: (paramId: string, currentValue: number) => void;
  onApplyKeyformPreset: (
    paramId: string,
    preset: '2point' | '3point' | 'clear'
  ) => void;
  onAddKeyformPoint: (paramId: string, value: number) => void;
  onDeleteKeyformPoint: (paramId: string, value: number) => void;
  onSwapKeyformPoints: (paramId: string, valA: number, valB: number) => void;
  onResetKeyformPoint: (paramId: string, val: number) => void;
  onReflectKeyform: (paramId: string, direction: 'minToMax' | 'maxToMin') => void;
  onApplyExpression: (expr: ExpressionPreset) => void;
  onSaveCustomExpression: (name: string) => void;
  onDeleteCustomExpression: (id: string) => void;
  onGenerateAutoBlink: () => void;
  onUpdateParameterMeta: (
    paramId: string,
    patch: Partial<Pick<RigParameter, 'name' | 'min' | 'max' | 'defaultValue' | 'folderId'>>
  ) => void;
  onDeleteParameter: (paramId: string) => void;
  onAddParameter: () => void;
  onAddFolder: () => void;
  onToggleFolderCollapse: (folderId: string) => void;
  onChangeFolderColor: (folderId: string, color: string) => void;
}

const FOLDER_COLORS = [
  '#2D8CEB',
  '#22C55E',
  '#F59E0B',
  '#EF4444',
  '#A855F7',
  '#14B8A6',
];

export function ParameterPanelContent({
  puppet,
  selectedParamId,
  selectedLayerId,
  physicsParamOffsets,
  showLinkedPad,
  expressions,
  onToggleLinkedPad,
  onSelectParam,
  onChangeParamValue,
  onTouchParamForConnect,
  onApplyKeyformPreset,
  onAddKeyformPoint,
  onDeleteKeyformPoint,
  onSwapKeyformPoints,
  onResetKeyformPoint,
  onReflectKeyform,
  onApplyExpression,
  onSaveCustomExpression,
  onDeleteCustomExpression,
  onGenerateAutoBlink,
  onUpdateParameterMeta,
  onDeleteParameter,
  onAddParameter,
  onAddFolder,
  onToggleFolderCollapse,
  onChangeFolderColor,
}: ParameterPanelContentProps) {
  const [openMenuParamId, setOpenMenuParamId] = useState<string | null>(null);
  const [showExpressions, setShowExpressions] = useState(false);
  const [newExprName, setNewExprName] = useState('');
  const [editingParamId, setEditingParamId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    min: number;
    max: number;
    folderId: string;
  }>({ name: '', min: -1, max: 1, folderId: '' });
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string>(
    puppet.parameterFolders[0]?.id ?? ''
  );
  const [editingValueParamId, setEditingValueParamId] = useState<string | null>(
    null
  );
  const [valueInputDraft, setValueInputDraft] = useState<string>('');
  const openMenuRef = useRef<HTMLDivElement | null>(null);
  const valueInputRef = useRef<HTMLInputElement | null>(null);

  const beginInlineValueEdit = (param: RigParameter) => {
    onSelectParam(param.id);
    setEditingValueParamId(param.id);
    setValueInputDraft(Number(param.value.toFixed(2)).toString());
    requestAnimationFrame(() => {
      valueInputRef.current?.focus();
      valueInputRef.current?.select();
    });
  };

  const commitInlineValueEdit = (param: RigParameter) => {
    const parsed = parseClampedParameterInput(
      valueInputDraft,
      param.min,
      param.max
    );
    setEditingValueParamId(null);
    if (parsed !== null) {
      onSelectParam(param.id);
      onChangeParamValue(param.id, parsed);
    } else {
      onTouchParamForConnect?.(param.id, param.value);
    }
  };

  const cancelInlineValueEdit = () => {
    setEditingValueParamId(null);
  };

  // Close right-click context menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!openMenuParamId) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        openMenuRef.current &&
        !openMenuRef.current.contains(e.target as Node)
      ) {
        setOpenMenuParamId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuParamId(null);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuParamId]);

  const selectedParam =
    puppet.parameters.find((p) => p.id === selectedParamId) ??
    puppet.parameters[0];
  const selectedLayer = puppet.layers.find((l) => l.id === selectedLayerId);

  const openChangeParamModal = (p: RigParameter) => {
    setEditingParamId(p.id);
    setEditDraft({
      name: p.name,
      min: p.min,
      max: p.max,
      folderId: p.folderId ?? '',
    });
    setOpenMenuParamId(null);
  };

  const renderParamRow = (param: RigParameter) => {
    const isSelected = param.id === selectedParamId;
    const physOffset = physicsParamOffsets[param.id] ?? 0;
    const effectiveVal = Math.max(
      param.min,
      Math.min(param.max, param.value + physOffset)
    );
    const isMenuOpen = openMenuParamId === param.id;
    const span = Math.max(0.0001, param.max - param.min);

    // Closest existing keyform for Delete / Swap / Reset (prefers merged display points)
    const sortedKfs = [...param.keyforms].sort((a, b) => a - b);
    const kfStatus = getParameterKeyformStatus(
      puppet.keyforms,
      selectedLayer,
      param
    );
    const allPointValues = kfStatus.displayPoints.map((pt) => pt.value);
    const nearestKf =
      allPointValues.length > 0
        ? allPointValues.reduce(
            (best, kf) =>
              Math.abs(kf - param.value) < Math.abs(best - param.value)
                ? kf
                : best,
            allPointValues[0]
          )
        : param.defaultValue;
    const nearestPointObj = kfStatus.displayPoints.find(
      (pt) => Math.abs(pt.value - nearestKf) < 1e-3
    );
    const swapTarget =
      sortedKfs.find((k) => Math.abs(k - nearestKf) > 0.001) ??
      param.defaultValue;
    const isOnBoundPoint = kfStatus.boundValues.some(
      (bv) => Math.abs(param.value - bv) < span * 0.03
    );

    return (
      <div
        key={param.id}
        data-param-id={param.id}
        data-has-keyform={kfStatus.hasAnyKeyform ? 'true' : 'false'}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelectParam(param.id);
          setOpenMenuParamId(isMenuOpen ? null : param.id);
        }}
        className={`relative px-2 py-1.5 transition-colors ${
          isSelected || isMenuOpen ? 'bg-[#2D8CEB]/20' : 'hover:bg-[#2F2F2F]'
        }`}
      >
        <div className="flex items-center gap-1.5">
          {/* Parameter Name + Keyform Point Status Dot (AE Blue when has points, Gray when empty) */}
          <button
            type="button"
            onClick={() => onSelectParam(param.id)}
            className={`w-[96px] shrink-0 text-left text-[11px] flex items-center gap-1.5 min-w-0 transition-colors ${
              kfStatus.hasAnyKeyform
                ? isSelected
                  ? 'text-white font-semibold'
                  : 'text-[#93C5FD] font-medium'
                : isSelected
                  ? 'text-[#D1D5DB] font-semibold'
                  : 'text-[#868B96] font-normal'
            }`}
            title={
              kfStatus.hasAnyKeyform
                ? `${param.name} · ${kfStatus.boundValues.length} keyform point(s) · Right-click for options`
                : `${param.name} · No points yet · Right-click to Add Point`
            }
          >
            <span
              aria-hidden="true"
              className={`w-[6px] h-[6px] rounded-full shrink-0 transition-colors ${
                kfStatus.hasAnyKeyform
                  ? 'bg-[#2D8CEB] shadow-[0_0_5px_rgba(45,140,235,0.65)]'
                  : 'bg-transparent border border-[#525660]'
              }`}
            />
            <span className="truncate">{param.name}</span>
          </button>

          {/* Slider Track with Per-Point Bound (AE Blue) vs Unbound/Empty (Gray) Indicators */}
          <div className="relative flex-1 flex items-center h-5">
            {/* Custom rail + keyform dots cleanly aligned with native thumb travel (inset-x-[5px]) */}
            <div
              className={`pointer-events-none absolute inset-x-[5px] top-1/2 -translate-y-1/2 h-[2px] rounded-full transition-colors ${
                kfStatus.hasAnyKeyform ? 'bg-[#2D8CEB]/70' : 'bg-[#3C414E]'
              }`}
            >
              {kfStatus.displayPoints.map((pt) => {
                const pct = ((pt.value - param.min) / span) * 100;
                const isNear = Math.abs(param.value - pt.value) < span * 0.03;
                return (
                  <span
                    key={pt.value}
                    data-keyform-value={pt.value}
                    data-keyform-bound={pt.isBound ? 'true' : 'false'}
                    style={{ left: `${pct}%` }}
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all ${
                      pt.isBound
                        ? isNear
                          ? 'w-[9px] h-[9px] bg-[#60A5FA] border-[1.5px] border-white shadow-[0_0_6px_rgba(45,140,235,0.85)]'
                          : 'w-[8px] h-[8px] bg-[#2D8CEB] border border-[#BAE6FD] shadow-[0_0_4px_rgba(45,140,235,0.5)]'
                        : isNear
                          ? 'w-[7px] h-[7px] bg-[#262A33] border-[1.5px] border-[#9CA3AF]'
                          : 'w-[7px] h-[7px] bg-[#1A1C21] border-[1.5px] border-[#5D6370]'
                    }`}
                  />
                );
              })}
            </div>
            <input
              type="range"
              aria-label={param.name}
              min={param.min}
              max={param.max}
              step={span / 100}
              value={effectiveVal}
              onPointerDown={() => {
                onSelectParam(param.id);
                onTouchParamForConnect?.(param.id, param.value);
              }}
              onChange={(e) =>
                onChangeParamValue(param.id, parseFloat(e.target.value))
              }
              title={
                kfStatus.hasAnyKeyform
                  ? `${param.name}: ${effectiveVal.toFixed(2)} (Blue = has keyform points · Right-click for options)`
                  : `${param.name}: ${effectiveVal.toFixed(2)} (Gray = no points · Right-click to Add Point)`
              }
              className={`relative z-10 w-full studio-slider studio-slider-keyform bg-transparent ${
                kfStatus.hasAnyKeyform ? 'studio-slider-has-keyform' : ''
              } ${isOnBoundPoint ? 'studio-slider-on-keyform' : ''}`}
            />
          </div>

          {/* Live Numeric Value (Click or Double-Click to type exact value) */}
          {editingValueParamId === param.id ? (
            <input
              ref={valueInputRef}
              type="text"
              inputMode="decimal"
              aria-label={`Edit ${param.name} value`}
              value={valueInputDraft}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onDoubleClick={(e) => e.currentTarget.select()}
              onChange={(e) => setValueInputDraft(e.target.value)}
              onBlur={() => commitInlineValueEdit(param)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitInlineValueEdit(param);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelInlineValueEdit();
                }
              }}
              className="w-11 px-1 py-0.5 rounded bg-[#141414] border border-[#2D8CEB] text-right font-mono tabular-nums text-[10px] text-white outline-none shadow-[0_0_0_1px_rgba(45,140,235,0.45)] shrink-0"
            />
          ) : (
            <button
              type="button"
              aria-label={`${param.name} value ${effectiveVal.toFixed(1)}`}
              onClick={() => beginInlineValueEdit(param)}
              onDoubleClick={() => beginInlineValueEdit(param)}
              className={`w-11 px-1 py-0.5 rounded text-right font-mono tabular-nums text-[10px] shrink-0 cursor-text transition-colors hover:bg-[#333333] hover:text-[#60A5FA] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2D8CEB] ${
                Math.abs(physOffset) > 0.02
                  ? 'text-[#38BDF8]'
                  : kfStatus.hasAnyKeyform
                    ? 'text-[#93C5FD]'
                    : 'text-[#828791]'
              }`}
              title={
                Math.abs(physOffset) > 0.02
                  ? 'Click or double-click to type value · Driven live by Physics · Right-click for options'
                  : 'Click or double-click to type exact value · Right-click for options'
              }
            >
              {effectiveVal.toFixed(1)}
            </button>
          )}
        </div>

        {/* Right-Click Context Menu: Add Point, Delete Point, Edit Point (Swap / Reset / Reflect), Change Parameter, Delete Parameter */}
        {isMenuOpen && (
          <div
            ref={openMenuRef}
            role="menu"
            aria-label={`${param.name} actions`}
            className="mt-1.5 ml-3 p-1.5 rounded bg-[#1E1E1E] border border-[#454545] shadow-xl text-[11px] space-y-1 z-30"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onAddKeyformPoint(param.id, Number(param.value.toFixed(2)));
                setOpenMenuParamId(null);
              }}
              className="w-full px-2 py-1 rounded text-left text-[#E5E5E5] hover:bg-[#2D8CEB] hover:text-white flex items-center justify-between transition-colors"
            >
              <span>Add Point</span>
              <span className="font-mono text-[10px] opacity-80">
                @ {param.value.toFixed(1)}
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              disabled={!nearestPointObj}
              onClick={() => {
                onDeleteKeyformPoint(param.id, nearestKf);
                setOpenMenuParamId(null);
              }}
              className="w-full px-2 py-1 rounded text-left text-[#FCA5A5] hover:bg-[#7F1D1D] hover:text-white disabled:opacity-40 flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <MinusCircle className="w-3 h-3" />
                Delete Point
              </span>
              <span className="font-mono text-[10px] opacity-80">
                @ {nearestKf.toFixed(1)}
              </span>
            </button>

            <div className="px-2 py-1 rounded bg-[#262626] space-y-1">
              <div className="text-[10px] font-semibold text-[#9E9E9E]">
                Edit Point ({nearestKf.toFixed(1)})
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSwapKeyformPoints(param.id, nearestKf, swapTarget);
                    setOpenMenuParamId(null);
                  }}
                  className="px-1.5 py-1 rounded bg-[#333333] hover:bg-[#2D8CEB] text-[#E8E8E8] hover:text-white text-[10px] text-center transition-colors"
                >
                  Swap ↔ {swapTarget.toFixed(1)}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onResetKeyformPoint(param.id, nearestKf);
                    setOpenMenuParamId(null);
                  }}
                  className="px-1.5 py-1 rounded bg-[#333333] hover:bg-[#3F3F3F] text-[#E8E8E8] text-[10px] flex items-center justify-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Reset Point
                </button>
              </div>
              {/* Reflect / Mirror Keyform (Live2D Time-Saver) */}
              <div className="grid grid-cols-2 gap-1 pt-0.5">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onReflectKeyform(param.id, 'minToMax');
                    setOpenMenuParamId(null);
                  }}
                  title="Mirror left/min deformation onto right/max side"
                  className="px-1.5 py-1 rounded bg-[#2B3542] hover:bg-[#2D8CEB] text-[#BAE6FD] hover:text-white text-[10px] flex items-center justify-center gap-1 transition-colors"
                >
                  <FlipHorizontal2 className="w-2.5 h-2.5" />
                  Reflect L→R
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onReflectKeyform(param.id, 'maxToMin');
                    setOpenMenuParamId(null);
                  }}
                  title="Mirror right/max deformation onto left/min side"
                  className="px-1.5 py-1 rounded bg-[#2B3542] hover:bg-[#2D8CEB] text-[#BAE6FD] hover:text-white text-[10px] flex items-center justify-center gap-1 transition-colors"
                >
                  <FlipHorizontal2 className="w-2.5 h-2.5" />
                  Reflect R→L
                </button>
              </div>
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={() => openChangeParamModal(param)}
              className="w-full px-2 py-1 rounded text-left text-[#E5E5E5] hover:bg-[#2D8CEB] hover:text-white"
            >
              Change Parameter...
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDeleteParameter(param.id);
                setOpenMenuParamId(null);
              }}
              className="w-full px-2 py-1 rounded text-left text-[#FCA5A5] hover:bg-[#7F1D1D] hover:text-white flex items-center gap-1.5"
            >
              <Trash2 className="w-3 h-3" />
              Delete Parameter
            </button>
          </div>
        )}
      </div>
    );
  };

  const ungroupedParams = puppet.parameters.filter(
    (p) =>
      !p.folderId || !puppet.parameterFolders.some((f) => f.id === p.folderId)
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top Toolbar: 3 Keyform Presets (2-keyform, 3-keyform, Clear) + 2D Linked Blend Sync Button */}
      <div className="px-2 py-1.5 border-b border-[#363636] bg-[#212121] flex items-center justify-between gap-1.5">
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Parameter keyform presets"
        >
          {/* 2 Keyforms Preset */}
          <button
            type="button"
            disabled={!selectedParam}
            onClick={() =>
              selectedParam && onApplyKeyformPreset(selectedParam.id, '2point')
            }
            aria-label="Add 2 Keyforms preset"
            title={`Set 2 keyforms (${selectedParam?.min}, ${selectedParam?.max}) on ${selectedParam?.name ?? 'parameter'}`}
            className="h-6 px-1 rounded bg-[#2D2D2D] hover:bg-[#3A3A3A] border border-[#444444] flex items-center justify-center text-[#DCDCDC] transition-colors"
          >
            <svg width="20" height="10" viewBox="0 0 26 10" aria-hidden="true">
              <line x1="4" y1="5" x2="22" y2="5" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="4" cy="5" r="2.5" fill="#2D8CEB" stroke="#BAE6FD" strokeWidth="0.9" />
              <circle cx="22" cy="5" r="2.5" fill="#2D8CEB" stroke="#BAE6FD" strokeWidth="0.9" />
            </svg>
          </button>

          {/* 3 Keyforms Preset */}
          <button
            type="button"
            disabled={!selectedParam}
            onClick={() =>
              selectedParam && onApplyKeyformPreset(selectedParam.id, '3point')
            }
            aria-label="Add 3 Keyforms preset"
            title={`Set 3 keyforms (${selectedParam?.min}, ${selectedParam?.defaultValue}, ${selectedParam?.max}) on ${selectedParam?.name ?? 'parameter'}`}
            className="h-6 px-1 rounded bg-[#2D2D2D] hover:bg-[#3A3A3A] border border-[#444444] flex items-center justify-center text-[#DCDCDC] transition-colors"
          >
            <svg width="22" height="10" viewBox="0 0 28 10" aria-hidden="true">
              <line x1="4" y1="5" x2="24" y2="5" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="4" cy="5" r="2.3" fill="#2D8CEB" stroke="#BAE6FD" strokeWidth="0.9" />
              <circle cx="14" cy="5" r="2.3" fill="#2D8CEB" stroke="#BAE6FD" strokeWidth="0.9" />
              <circle cx="24" cy="5" r="2.3" fill="#2D8CEB" stroke="#BAE6FD" strokeWidth="0.9" />
            </svg>
          </button>

          {/* Clear Keyforms */}
          <button
            type="button"
            disabled={!selectedParam}
            onClick={() =>
              selectedParam && onApplyKeyformPreset(selectedParam.id, 'clear')
            }
            aria-label="Clear keyform points"
            title={`Clear all keyform points on ${selectedParam?.name ?? 'parameter'}`}
            className="h-6 px-1 rounded bg-[#2D2D2D] hover:bg-[#4A2525] border border-[#444444] flex items-center justify-center text-[#DCDCDC] transition-colors"
          >
            <svg width="20" height="10" viewBox="0 0 26 10" aria-hidden="true">
              <line x1="4" y1="5" x2="22" y2="5" stroke="#888888" strokeWidth="1.2" />
              <circle cx="4" cy="5" r="2" fill="#555555" />
              <circle cx="13" cy="5" r="2" fill="#555555" />
              <circle cx="22" cy="5" r="2" fill="#555555" />
              <line x1="8" y1="1.5" x2="18" y2="8.5" stroke="#EF4444" strokeWidth="1.4" />
            </svg>
          </button>

          {/* Reflect Keyform L -> R Quick Action */}
          <button
            type="button"
            disabled={!selectedParam}
            onClick={() =>
              selectedParam && onReflectKeyform(selectedParam.id, 'minToMax')
            }
            aria-label="Reflect keyform left to right"
            title={`Reflect / Mirror keyform L→R on ${selectedParam?.name ?? 'parameter'}`}
            className="h-6 px-1 rounded bg-[#2D2D2D] hover:bg-[#2D8CEB] border border-[#444444] flex items-center justify-center text-[#BAE6FD] hover:text-white transition-colors"
          >
            <FlipHorizontal2 className="w-3 h-3" />
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Expressions & Auto-Blink Drawer Toggle */}
          <button
            type="button"
            onClick={() => setShowExpressions((v) => !v)}
            aria-pressed={showExpressions}
            aria-label="Toggle Expressions and Auto-Blink"
            title="1-click Expression Presets & Auto-Blink generator"
            className={`h-6 px-1.5 rounded border text-[10px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              showExpressions
                ? 'bg-[#2D8CEB] border-[#4CA0F4] text-white'
                : 'bg-[#2D2D2D] border-[#444444] text-[#D4D4D4] hover:bg-[#3A3A3A]'
            }`}
          >
            <Smile className="w-3 h-3" />
            Expr
          </button>

          {/* Synchronize Parameter (2D Linked Blend) Button */}
          <button
            type="button"
            disabled={puppet.parameters.length === 0}
            onClick={onToggleLinkedPad}
            aria-pressed={showLinkedPad}
            aria-label="Toggle 2D Linked Blend parameter synchronizer"
            title={
              puppet.parameters.length === 0
                ? 'Add parameters first to use 2D Linked Blend'
                : 'Synchronize two parameters in 2D Linked Blend grid'
            }
            className={`h-6 px-1.5 rounded border text-[10px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap disabled:opacity-40 ${
              showLinkedPad
                ? 'bg-[#2D8CEB] border-[#4CA0F4] text-white'
                : 'bg-[#2D2D2D] border-[#444444] text-[#D4D4D4] hover:bg-[#3A3A3A]'
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
              <rect
                x="1"
                y="1"
                width="10"
                height="10"
                rx="1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
              />
              <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
              <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
              <circle cx="6" cy="6" r="1.8" fill="#2D8CEB" />
            </svg>
            2D
          </button>
        </div>
      </div>

      {/* Compact Parameter Keyform Legend Strip */}
      <div
        data-testid="param-keyform-legend"
        title="Blue parameters have keyform points; gray parameters have none. Right-click any parameter row to Add/Delete points."
        className="px-2 py-1 border-b border-[#303030] bg-[#1B1B1B] flex items-center justify-between gap-2 text-[10px] text-[#9A9A9A]"
      >
        <span className="truncate" title={`Active layer: ${selectedLayer?.name ?? 'None'} · Right-click any parameter row to Add/Delete points`}>
          Layer:{' '}
          <span className="text-[#DCDCDC] font-medium">
            {selectedLayer?.name ?? 'None'}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-[#93C5FD]">
            <span className="w-[7px] h-[7px] rounded-full bg-[#2D8CEB] border border-[#BAE6FD]" />
            Has Point
          </span>
          <span className="inline-flex items-center gap-1 text-[#8A8F9A]">
            <span className="w-[7px] h-[7px] rounded-full bg-[#1A1C21] border-[1.5px] border-[#5D6370]" />
            No Point
          </span>
        </span>
      </div>

      {/* Collapsible Expression Presets + Auto-Blink Drawer */}
      {showExpressions && (
        <div
          data-testid="expressions-drawer"
          className="p-2 border-b border-[#363636] bg-[#1C1C1C] space-y-1.5 text-[10px]"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="font-semibold text-[#D8D8D8]">
              Expressions
            </span>
            <button
              type="button"
              onClick={onGenerateAutoBlink}
              aria-label="Generate Auto-Blink keyframes"
              title="Insert natural periodic Eye L/R blink keyframes across the timeline"
              className="px-1.5 py-0.5 rounded bg-[#2B3A4D] hover:bg-[#2D8CEB] border border-[#3B5978] text-[#BAE6FD] hover:text-white font-medium flex items-center gap-1 transition-colors"
            >
              <Eye className="w-2.5 h-2.5" />
              Auto-Blink
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {expressions.map((expr) => (
              <div
                key={expr.id}
                className="inline-flex items-center rounded bg-[#2A2A2A] border border-[#3E3E3E] overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => onApplyExpression(expr)}
                  className="px-2 py-0.5 text-[#E5E5E5] hover:bg-[#2D8CEB] hover:text-white transition-colors"
                >
                  {expr.name}
                </button>
                {!expr.builtIn && (
                  <button
                    type="button"
                    onClick={() => onDeleteCustomExpression(expr.id)}
                    aria-label={`Delete expression ${expr.name}`}
                    className="px-1 py-0.5 text-[#8E8E8E] hover:text-[#FCA5A5] hover:bg-[#4A2525]"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = newExprName.trim();
              if (!clean) return;
              onSaveCustomExpression(clean);
              setNewExprName('');
            }}
            className="flex items-center gap-1"
          >
            <input
              type="text"
              value={newExprName}
              onChange={(e) => setNewExprName(e.target.value)}
              placeholder="Save current pose..."
              aria-label="Custom expression name"
              className="flex-1 min-w-0 px-1.5 py-0.5 rounded bg-[#141414] border border-[#3C3C3C] text-[#ECECEC] placeholder:text-[#707070]"
            />
            <button
              type="submit"
              disabled={!newExprName.trim()}
              className="px-2 py-0.5 rounded bg-[#2F2F2F] hover:bg-[#2D8CEB] disabled:opacity-40 text-white font-medium transition-colors"
            >
              + Save
            </button>
          </form>
        </div>
      )}

      {/* Inline Change Parameter Editor */}
      {editingParamId && (
        <div className="p-2.5 border-b border-[#3A3A3A] bg-[#1E1E1E] space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#E8E8E8]">
              Edit Parameter
            </span>
            <button
              type="button"
              onClick={() => setEditingParamId(null)}
              aria-label="Close parameter editor"
              className="text-[#9A9A9A] hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            type="text"
            aria-label="Parameter name"
            value={editDraft.name}
            onChange={(e) =>
              setEditDraft((d) => ({ ...d, name: e.target.value }))
            }
            className="w-full px-2 py-1 rounded bg-[#141414] border border-[#3E3E3E] text-[#ECECEC] text-[11px]"
          />
          <div className="grid grid-cols-3 gap-1.5">
            <label className="text-[10px] text-[#9A9A9A]">
              Min
              <input
                type="number"
                value={editDraft.min}
                onChange={(e) =>
                  setEditDraft((d) => ({
                    ...d,
                    min: parseFloat(e.target.value) || 0,
                  }))
                }
                className="mt-0.5 w-full px-1.5 py-0.5 rounded bg-[#141414] border border-[#3E3E3E] text-[#ECECEC] font-mono"
              />
            </label>
            <label className="text-[10px] text-[#9A9A9A]">
              Max
              <input
                type="number"
                value={editDraft.max}
                onChange={(e) =>
                  setEditDraft((d) => ({
                    ...d,
                    max: parseFloat(e.target.value) || 1,
                  }))
                }
                className="mt-0.5 w-full px-1.5 py-0.5 rounded bg-[#141414] border border-[#3E3E3E] text-[#ECECEC] font-mono"
              />
            </label>
            <label className="text-[10px] text-[#9A9A9A]">
              Folder
              <select
                value={editDraft.folderId}
                onChange={(e) =>
                  setEditDraft((d) => ({ ...d, folderId: e.target.value }))
                }
                className="mt-0.5 w-full px-1 py-0.5 rounded bg-[#141414] border border-[#3E3E3E] text-[#ECECEC] text-[10px]"
              >
                <option value="">None</option>
                {puppet.parameterFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => {
              onUpdateParameterMeta(editingParamId, {
                name: editDraft.name.trim() || 'Parameter',
                min: Math.min(editDraft.min, editDraft.max - 0.1),
                max: Math.max(editDraft.max, editDraft.min + 0.1),
                folderId: editDraft.folderId || null,
              });
              setEditingParamId(null);
            }}
            className="w-full py-1 rounded bg-[#2D8CEB] hover:bg-[#1E7AD6] text-white font-medium text-[11px]"
          >
            Save Parameter
          </button>
        </div>
      )}

      {/* Folders + Parameter Sliders List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#303030]">
        {puppet.parameters.length === 0 && puppet.parameterFolders.length === 0 ? (
          <div
            data-testid="empty-parameters-state"
            className="h-full min-h-[180px] px-4 py-6 flex flex-col items-center justify-center text-center gap-2.5"
          >
            <p className="text-[12px] font-medium text-[#DCDCDC]">
              No parameters yet
            </p>
            <p className="text-[10.5px] leading-relaxed text-[#8E939E] max-w-[200px]">
              Add your own parameters to rig and animate this PSD.
            </p>
            <button
              type="button"
              onClick={onAddParameter}
              className="mt-0.5 px-3 py-1.5 rounded bg-[#2D8CEB] hover:bg-[#1E7AD6] text-white text-[11px] font-medium flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Parameter
            </button>
          </div>
        ) : (
          <>
            {puppet.parameterFolders.map((folder: ParameterFolder) => {
              const folderParams = puppet.parameters.filter(
                (p) => p.folderId === folder.id
              );
              return (
                <div key={folder.id} className="bg-[#232323]">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFolderId(folder.id);
                      onToggleFolderCollapse(folder.id);
                    }}
                    style={{ borderLeftColor: folder.color }}
                    className="w-full px-2 py-1.5 border-l-[3px] flex items-center justify-between text-[11px] font-semibold text-[#E8E8E8] bg-[#2D2D2D] hover:bg-[#343434] transition-colors"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {folder.collapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-[#A0A0A0]" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-[#A0A0A0]" />
                      )}
                      <span className="truncate">{folder.name}</span>
                    </span>
                    <span className="font-mono tabular-nums text-[10px] text-[#9A9A9A]">
                      {folderParams.length}
                    </span>
                  </button>

                  {!folder.collapsed && (
                    <div
                      style={{ borderLeftColor: folder.color }}
                      className="border-l-[3px] divide-y divide-[#2E2E2E] bg-[#252525]"
                    >
                      {folderParams.map(renderParamRow)}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Ungrouped Parameters */}
            <div className="divide-y divide-[#2E2E2E]">
              {ungroupedParams.map(renderParamRow)}
            </div>
          </>
        )}
      </div>

      {/* Footer Icons: Add Parameter, Add Folder, Folder Color (matching 3.png) */}
      <div className="relative px-2 py-1.5 border-t border-[#363636] bg-[#1F1F1F] flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onAddParameter}
            aria-label="Add Parameter"
            title="Add new parameter"
            className="px-2 py-1 rounded bg-[#2D2D2D] hover:bg-[#3A3A3A] text-[10px] font-medium text-[#E0E0E0] flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3 h-3 text-[#2D8CEB]" />
            Param
          </button>
          <button
            type="button"
            onClick={onAddFolder}
            aria-label="Add Folder"
            title="Add parameter folder"
            className="px-2 py-1 rounded bg-[#2D2D2D] hover:bg-[#3A3A3A] text-[10px] font-medium text-[#E0E0E0] flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <FolderPlus className="w-3 h-3 text-[#2D8CEB]" />
            Folder
          </button>
          <button
            type="button"
            onClick={() => setShowColorPicker((v) => !v)}
            aria-label="Change Folder Color"
            title="Change active folder color"
            className="px-2 py-1 rounded bg-[#2D2D2D] hover:bg-[#3A3A3A] text-[10px] font-medium text-[#E0E0E0] flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <Palette className="w-3 h-3 text-[#F59E0B]" />
            Color
          </button>
        </div>

        {showColorPicker && puppet.parameterFolders.length > 0 && (
          <div className="absolute left-2 bottom-9 p-2 rounded bg-[#1B1B1B] border border-[#444444] shadow-xl flex items-center gap-1.5 z-40">
            {FOLDER_COLORS.map((col) => (
              <button
                key={col}
                type="button"
                aria-label={`Set folder color ${col}`}
                onClick={() => {
                  const target =
                    activeFolderId || puppet.parameterFolders[0]?.id;
                  if (target) onChangeFolderColor(target, col);
                  setShowColorPicker(false);
                }}
                style={{ backgroundColor: col }}
                className="w-4 h-4 rounded-full border border-white/40 hover:scale-110 transition-transform"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Floating 2D Linked Blend Pad matching the Cubism widget in 3.png
 */
interface LinkedBlendPadProps {
  parameters: RigParameter[];
  paramXId: string;
  paramYId: string;
  onChangeAxisParams: (xId: string, yId: string) => void;
  onChangeValues: (xVal: number, yVal: number) => void;
  onClose: () => void;
}

export function LinkedBlendPad({
  parameters,
  paramXId,
  paramYId,
  onChangeAxisParams,
  onChangeValues,
  onClose,
}: LinkedBlendPadProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const px = parameters.find((p) => p.id === paramXId) ?? parameters[0];
  const py =
    parameters.find((p) => p.id === paramYId) ?? parameters[1] ?? parameters[0];

  if (!px || !py) return null;

  const normX = (px.value - px.min) / Math.max(0.0001, px.max - px.min);
  const normY = 1 - (py.value - py.min) / Math.max(0.0001, py.max - py.min);

  const updateFromClientPoint = (clientX: number, clientY: number) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ux = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const uy = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const newX = px.min + ux * (px.max - px.min);
    const newY = py.min + (1 - uy) * (py.max - py.min);
    onChangeValues(Number(newX.toFixed(2)), Number(newY.toFixed(2)));
  };

  return (
    <div
      data-testid="linked-blend-pad"
      className="fixed left-[524px] top-[134px] z-[80] w-[236px] rounded-[6px] bg-[#1F1F1F]/95 border border-[#444444] shadow-[0_12px_32px_rgba(0,0,0,0.65)] overflow-hidden select-none"
    >
      <div className="px-2.5 py-1.5 bg-[#181818] border-b border-[#343434] flex items-center justify-between text-[11px]">
        <span className="font-semibold text-[#E8E8E8]">2D Linked Blend</span>
        <div className="flex items-center gap-2">
          <span className="font-mono tabular-nums text-[10px] text-[#A0A0A0]">
            X {px.value.toFixed(1)} · Y {py.value.toFixed(1)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close 2D Linked Blend"
            className="text-[#9A9A9A] hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Parameter X <-> Parameter Y selectors */}
      <div className="px-2.5 py-1.5 flex items-center justify-between gap-1 text-[10px] bg-[#232323] border-b border-[#343434]">
        <select
          aria-label="2D Blend X Parameter"
          value={px.id}
          onChange={(e) => onChangeAxisParams(e.target.value, py.id)}
          className="w-[84px] px-1 py-0.5 rounded bg-[#161616] border border-[#3E3E3E] text-[#E6E6E6]"
        >
          {parameters.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="text-[#888888] shrink-0">connect to</span>
        <select
          aria-label="2D Blend Y Parameter"
          value={py.id}
          onChange={(e) => onChangeAxisParams(px.id, e.target.value)}
          className="w-[84px] px-1 py-0.5 rounded bg-[#161616] border border-[#3E3E3E] text-[#E6E6E6]"
        >
          {parameters.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Interactive XY Grid with Green Keyform Corner Dots & Draggable Puck */}
      <div className="p-2.5 bg-[#1B1B1B]">
        <div
          ref={padRef}
          onPointerDown={(e) => {
            draggingRef.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            updateFromClientPoint(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return;
            updateFromClientPoint(e.clientX, e.clientY);
          }}
          onPointerUp={(e) => {
            draggingRef.current = false;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          className="relative w-full h-[118px] rounded bg-[#131313] border border-[#3C3C3C] cursor-crosshair"
        >
          {/* Grid lines */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-[#2E2E2E]" />
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-[#2E2E2E]" />

          {/* 9 AE Blue Keyform Dots */}
          {[0, 50, 100].map((gx) =>
            [0, 50, 100].map((gy) => (
              <span
                key={`${gx}_${gy}`}
                style={{ left: `${gx}%`, top: `${gy}%` }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#2D8CEB]"
              />
            ))
          )}

          {/* Draggable Puck */}
          <span
            style={{ left: `${normX * 100}%`, top: `${normY * 100}%` }}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#2D8CEB] border-2 border-white shadow"
          />
        </div>
      </div>
    </div>
  );
}
