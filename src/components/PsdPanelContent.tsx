import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  FolderClosed,
  GripVertical,
  Link2,
  RefreshCw,
  Unlink,
  Upload,
} from 'lucide-react';
import type {
  ArtMeshLayer,
  PuppetDocument,
  ThumbnailSize,
} from '../types/puppet';
import { wouldCreateLayerParentCycle } from '../engine/studioFeatures';

interface PsdPanelContentProps {
  puppet: PuppetDocument;
  selectedLayerId: string;
  selectedLayerIds: string[];
  thumbnailSize: ThumbnailSize;
  onChangeThumbnailSize: (size: ThumbnailSize) => void;
  onSelectLayers: (
    primaryId: string,
    selectedIds: string[]
  ) => void;
  onToggleLayerVisibility: (layerId: string) => void;
  onReorderLayer: (fromLayerId: string, toLayerId: string) => void;
  onMoveLayerStep: (layerId: string, direction: 'up' | 'down') => void;
  onImportNewPsdFile: (file: File) => void;
  onRenewPsdFile: (file: File) => void;
  onSimulatePsdUpdate: () => void;
  onGroupSelectedLayers: () => void;
  onSetLayerParent: (childLayerId: string, parentLayerId: string | null) => void;
}

const THUMB_SIZE_OPTIONS: Array<{ id: ThumbnailSize; label: string }> = [
  { id: 'none', label: 'No Thumbnail' },
  { id: 'small', label: 'Small Thumbnail' },
  { id: 'normal', label: 'Normal Thumbnail' },
  { id: 'large', label: 'Large Thumbnail' },
];

export function PsdPanelContent({
  puppet,
  selectedLayerId,
  selectedLayerIds,
  thumbnailSize,
  onChangeThumbnailSize,
  onSelectLayers,
  onToggleLayerVisibility,
  onReorderLayer,
  onMoveLayerStep,
  onImportNewPsdFile,
  onRenewPsdFile,
  onSimulatePsdUpdate,
  onGroupSelectedLayers,
  onSetLayerParent,
}: PsdPanelContentProps) {
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const renewFileInputRef = useRef<HTMLInputElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [anchorLayerId, setAnchorLayerId] = useState<string>(selectedLayerId);
  const [thumbMenuPos, setThumbMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Close thumbnail context menu on outside click / Escape
  useEffect(() => {
    if (!thumbMenuPos) return;
    const close = () => setThumbMenuPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [thumbMenuPos]);

  // Display top-most rendered layer first (highest zIndex at top, like Photoshop / AE)
  const displayLayers: ArtMeshLayer[] = [...puppet.layers].sort(
    (a, b) => b.zIndex - a.zIndex
  );

  const groupDeformers = puppet.deformers.filter((d) => d.type === 'group');

  const handleRowClick = (e: React.MouseEvent, layerId: string) => {
    if (e.shiftKey) {
      const aIdx = displayLayers.findIndex((l) => l.id === anchorLayerId);
      const bIdx = displayLayers.findIndex((l) => l.id === layerId);
      if (aIdx >= 0 && bIdx >= 0) {
        const [lo, hi] = aIdx <= bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
        const rangeIds = displayLayers.slice(lo, hi + 1).map((l) => l.id);
        onSelectLayers(layerId, rangeIds);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const exists = selectedLayerIds.includes(layerId);
      const nextIds = exists
        ? selectedLayerIds.filter((id) => id !== layerId)
        : [...selectedLayerIds, layerId];
      const safeIds = nextIds.length > 0 ? nextIds : [layerId];
      setAnchorLayerId(layerId);
      onSelectLayers(layerId, safeIds);
      return;
    }
    setAnchorLayerId(layerId);
    onSelectLayers(layerId, [layerId]);
  };

  const handleThumbnailContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setThumbMenuPos({
      x: Math.min(window.innerWidth - 170, e.clientX),
      y: Math.min(window.innerHeight - 150, e.clientY),
    });
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const srcId = draggingId || e.dataTransfer.getData('text/plain');
    setDraggingId(null);
    setDragOverId(null);
    if (srcId && srcId !== targetId) {
      onReorderLayer(srcId, targetId);
    }
  };

  const thumbBoxClass =
    thumbnailSize === 'small'
      ? 'w-5 h-5'
      : thumbnailSize === 'large'
        ? 'w-12 h-12'
        : 'w-8 h-8';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* PSD Import & Renew Controls */}
      <div className="p-2.5 border-b border-[#363636] bg-[#212121] space-y-2">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span
            className="font-mono text-[#E2E2E2] truncate"
            title={puppet.psd.fileName}
          >
            {puppet.psd.fileName}
          </span>
          <span className="font-mono tabular-nums text-[#8F8F8F] shrink-0">
            Rev {puppet.psd.revision}
          </span>
        </div>

        <input
          ref={importFileInputRef}
          type="file"
          accept=".psd"
          aria-label="Import new PSD file"
          data-testid="import-new-psd-input"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportNewPsdFile(file);
            e.target.value = '';
          }}
        />
        <input
          ref={renewFileInputRef}
          type="file"
          accept=".psd"
          aria-label="Renew existing PSD file"
          data-testid="renew-psd-input"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onRenewPsdFile(file);
            e.target.value = '';
          }}
        />

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => importFileInputRef.current?.click()}
            title="Import a new .PSD file (clears default parameters & turns Auto-Breath OFF so you can build your own rig)"
            className="py-1.5 px-2 rounded bg-[#323232] hover:bg-[#3C3C3C] border border-[#454545] text-[11px] font-medium text-[#ECECEC] flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Upload className="w-3 h-3 text-[#2D8CEB]" />
            Import .PSD
          </button>
          <button
            type="button"
            onClick={() => {
              if (puppet.psd.sourceType === 'user-psd') {
                renewFileInputRef.current?.click();
              } else {
                onSimulatePsdUpdate();
              }
            }}
            title={
              puppet.psd.sourceType === 'user-psd'
                ? 'Update artwork layers from an updated .PSD while preserving your custom parameters & rig'
                : 'Simulate renewing the demo PSD while preserving rig & physics'
            }
            className="py-1.5 px-2 rounded bg-[#323232] hover:bg-[#3C3C3C] border border-[#454545] text-[11px] font-medium text-[#ECECEC] flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-3 h-3 text-[#2D8CEB]" />
            Renew PSD
          </button>
        </div>

        {selectedLayerIds.length >= 2 && (
          <button
            type="button"
            onClick={onGroupSelectedLayers}
            className="w-full py-1 px-2 rounded bg-[#2D8CEB] hover:bg-[#1E7AD6] text-white text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <FolderClosed className="w-3 h-3" />
            Group {selectedLayerIds.length} Selected Layers
          </button>
        )}

        {/* Bone Parenting Selector for Selected Layer */}
        {(() => {
          const sel = puppet.layers.find((l) => l.id === selectedLayerId);
          if (!sel) return null;
          const validParents = displayLayers.filter(
            (cand) =>
              cand.id !== sel.id &&
              !wouldCreateLayerParentCycle(puppet.layers, sel.id, cand.id)
          );
          return (
            <div className="flex items-center gap-1 pt-1 border-t border-[#2E2E2E]">
              <Link2 className="w-3 h-3 text-[#F59E0B] shrink-0" />
              <select
                aria-label="Bone parent layer"
                title={`Set Bone Parent for "${sel.name}"`}
                value={sel.parentLayerId ?? ''}
                onChange={(e) =>
                  onSetLayerParent(sel.id, e.target.value || null)
                }
                className="flex-1 min-w-0 px-1.5 py-0.5 rounded bg-[#161616] border border-[#3E3E3E] text-[10px] text-[#E6E6E6]"
              >
                <option value="">Parent: None</option>
                {validParents.map((p) => (
                  <option key={p.id} value={p.id}>
                    Parent: {p.name}
                  </option>
                ))}
              </select>
              {sel.parentLayerId && (
                <button
                  type="button"
                  onClick={() => onSetLayerParent(sel.id, null)}
                  aria-label="Unparent selected layer"
                  title="Unparent bone"
                  className="p-1 rounded bg-[#2E2E2E] hover:bg-[#4A2525] text-[#F59E0B] hover:text-white shrink-0"
                >
                  <Unlink className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* Custom Group Layers Section */}
      {groupDeformers.length > 0 && (
        <div className="px-2.5 py-1.5 border-b border-[#363636] bg-[#222222] space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8C8C8C]">
            Layer Groups
          </div>
          {groupDeformers.map((grp) => {
            const memberCount = puppet.layers.filter(
              (l) => l.groupLayerId === grp.id || l.parentDeformerId === grp.id
            ).length;
            return (
              <div
                key={grp.id}
                className="flex items-center justify-between text-[11px] px-1.5 py-1 rounded bg-[#2B2B2B] text-[#E0E0E0]"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <FolderClosed className="w-3 h-3 text-[#2D8CEB] shrink-0" />
                  <span className="truncate">{grp.name}</span>
                </span>
                <span className="font-mono tabular-nums text-[10px] text-[#9A9A9A]">
                  {memberCount} layers
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Draggable PSD Layer Stack Header (Right-click for thumbnail sizes, Ctrl/Shift+Click to multi-select) */}
      <div
        onContextMenu={handleThumbnailContextMenu}
        title="Right-click to change Thumbnail size · Ctrl/Shift+Click to multi-select"
        className="px-2.5 py-1 text-[10px] text-[#8E8E8E] border-b border-[#323232] flex items-center justify-between gap-2 select-none"
      >
        <span className="truncate">Ctrl/Shift+Click · R-Click thumbs</span>
        <span className="font-mono tabular-nums shrink-0">
          {puppet.layers.length}
        </span>
      </div>

      <div
        onContextMenu={handleThumbnailContextMenu}
        className="flex-1 overflow-y-auto divide-y divide-[#303030]"
      >
        {displayLayers.map((layer, visualIdx) => {
          const isPrimary = layer.id === selectedLayerId;
          const isMultiSelected = selectedLayerIds.includes(layer.id);
          const isDragOver = dragOverId === layer.id;
          const groupNode = layer.groupLayerId
            ? groupDeformers.find((g) => g.id === layer.groupLayerId)
            : null;

          return (
            <div
              key={layer.id}
              draggable
              onDragStart={(e) => handleDragStart(e, layer.id)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverId !== layer.id) setDragOverId(layer.id);
              }}
              onDragLeave={() => {
                if (dragOverId === layer.id) setDragOverId(null);
              }}
              onDrop={(e) => handleDrop(e, layer.id)}
              onDragEnd={() => {
                setDraggingId(null);
                setDragOverId(null);
              }}
              onContextMenu={handleThumbnailContextMenu}
              className={`group flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors select-none ${
                isDragOver
                  ? 'border-t-2 border-t-[#2D8CEB] bg-[#2D8CEB]/15'
                  : isPrimary
                    ? 'bg-[#2D8CEB]/28 text-white'
                    : isMultiSelected
                      ? 'bg-[#2D8CEB]/16 text-[#EEF6FF]'
                      : 'text-[#D4D4D4] hover:bg-[#303030]'
              }`}
            >
              <GripVertical
                aria-hidden="true"
                className="w-3 h-3 text-[#6E6E6E] shrink-0 cursor-grab"
              />

              <button
                type="button"
                onClick={() => onToggleLayerVisibility(layer.id)}
                aria-label={
                  layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`
                }
                className="p-0.5 text-[#9A9A9A] hover:text-white shrink-0"
              >
                {layer.visible ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3 text-[#666666]" />
                )}
              </button>

              {/* Layer Thumbnail (Right-click to switch No / Small / Normal / Large Thumbnail) */}
              {thumbnailSize !== 'none' && (
                <div
                  data-testid={`layer-thumb-${layer.id}`}
                  data-thumb-size={thumbnailSize}
                  onContextMenu={handleThumbnailContextMenu}
                  onClick={(e) => handleRowClick(e, layer.id)}
                  title="Right-click to change Thumbnail size"
                  className={`${thumbBoxClass} shrink-0 rounded-[3px] border border-[#444444] checkerboard-canvas overflow-hidden flex items-center justify-center cursor-pointer`}
                >
                  {layer.textureDataUrl && (
                    <img
                      src={layer.textureDataUrl}
                      alt={`${layer.name} thumbnail`}
                      draggable={false}
                      className="w-full h-full object-contain pointer-events-none"
                    />
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={(e) => handleRowClick(e, layer.id)}
                className="flex-1 min-w-0 text-left flex items-center justify-between gap-1.5 py-0.5"
              >
                <span className="truncate font-medium">
                  {layer.name}
                  {layer.parentLayerId && (
                    <span
                      title={`Parented to ${puppet.layers.find((p) => p.id === layer.parentLayerId)?.name ?? 'Bone'}`}
                      className="ml-1 text-[9.5px] text-[#F59E0B]"
                    >
                      ↳{' '}
                      {puppet.layers
                        .find((p) => p.id === layer.parentLayerId)
                        ?.name.split(' ')[0] ?? 'Bone'}
                    </span>
                  )}
                  {groupNode && (
                    <span className="ml-1 text-[10px] text-[#60A5FA]">
                      [{groupNode.name}]
                    </span>
                  )}
                </span>
                <span className="font-mono tabular-nums text-[9px] text-[#8E8E8E] shrink-0">
                  {layer.meshCols}×{layer.meshRows}
                </span>
              </button>

              <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100">
                <button
                  type="button"
                  disabled={visualIdx === 0}
                  onClick={() => onMoveLayerStep(layer.id, 'up')}
                  aria-label={`Move ${layer.name} forward`}
                  title="Bring layer forward"
                  className="p-0.5 rounded hover:bg-[#404040] disabled:opacity-25 text-[#BFBFBF]"
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  disabled={visualIdx === displayLayers.length - 1}
                  onClick={() => onMoveLayerStep(layer.id, 'down')}
                  aria-label={`Move ${layer.name} backward`}
                  title="Send layer backward"
                  className="p-0.5 rounded hover:bg-[#404040] disabled:opacity-25 text-[#BFBFBF]"
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Right-Click Thumbnail Size Context Menu */}
      {thumbMenuPos && (
        <div
          role="menu"
          aria-label="Layer thumbnail size"
          data-testid="thumbnail-size-menu"
          style={{ left: `${thumbMenuPos.x}px`, top: `${thumbMenuPos.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed z-[95] w-[158px] p-1 rounded-[6px] bg-[#202020] border border-[#4A4A4A] shadow-2xl space-y-0.5 text-[11px]"
        >
          {THUMB_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onChangeThumbnailSize(opt.id);
                setThumbMenuPos(null);
              }}
              className={`w-full px-2 py-1.5 rounded text-left flex items-center justify-between transition-colors ${
                thumbnailSize === opt.id
                  ? 'bg-[#2D8CEB] text-white font-medium'
                  : 'text-[#DCDCDC] hover:bg-[#333333]'
              }`}
            >
              <span>{opt.label}</span>
              {thumbnailSize === opt.id && <Check className="w-3 h-3" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
