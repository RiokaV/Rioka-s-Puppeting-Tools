import React, { useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { FloatingPanelLayout } from '../types/puppet';

interface FloatingPanelProps {
  layout: FloatingPanelLayout;
  title: string;
  headerExtra?: React.ReactNode;
  minWidth?: number;
  minHeight?: number;
  onUpdateLayout: (
    id: FloatingPanelLayout['id'],
    patch: Partial<FloatingPanelLayout>
  ) => void;
  onFocus: (id: FloatingPanelLayout['id']) => void;
  children: React.ReactNode;
}

export function FloatingPanel({
  layout,
  title,
  headerExtra,
  minWidth = 220,
  minHeight = 150,
  onUpdateLayout,
  onFocus,
  children,
}: FloatingPanelProps) {
  const dragRef = useRef<{
    mode: 'move' | 'resize' | null;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  }>({
    mode: null,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    origW: 0,
    origH: 0,
  });

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    e.stopPropagation();
    onFocus(layout.id);
    dragRef.current = {
      mode: 'move',
      startX: e.clientX,
      startY: e.clientY,
      origX: layout.x,
      origY: layout.y,
      origW: layout.width,
      origH: layout.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.mode !== 'move') return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const maxX = Math.max(40, window.innerWidth - 120);
    const maxY = Math.max(40, window.innerHeight - 90);
    onUpdateLayout(layout.id, {
      x: Math.max(6, Math.min(maxX, Math.round(dragRef.current.origX + dx))),
      y: Math.max(42, Math.min(maxY, Math.round(dragRef.current.origY + dy))),
    });
  };

  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.mode === 'move') {
      dragRef.current.mode = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onFocus(layout.id);
    dragRef.current = {
      mode: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      origX: layout.x,
      origY: layout.y,
      origW: layout.width,
      origH: layout.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.mode !== 'resize') return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    onUpdateLayout(layout.id, {
      width: Math.max(
        minWidth,
        Math.min(window.innerWidth - 40, Math.round(dragRef.current.origW + dx))
      ),
      height: Math.max(
        minHeight,
        Math.min(window.innerHeight - 100, Math.round(dragRef.current.origH + dy))
      ),
    });
  };

  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.mode === 'resize') {
      dragRef.current.mode = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  return (
    <section
      aria-label={`${title} panel`}
      data-testid={`floating-panel-${layout.id}`}
      data-minimized={layout.minimized ? 'true' : 'false'}
      onPointerDown={() => onFocus(layout.id)}
      style={{
        left: `${layout.x}px`,
        top: `${layout.y}px`,
        width: `${layout.width}px`,
        height: layout.minimized ? 'auto' : `${layout.height}px`,
        zIndex: layout.zIndex,
      }}
      className="fixed flex flex-col rounded-[6px] bg-[#262626]/95 border border-[#3E3E3E] shadow-[0_12px_32px_rgba(0,0,0,0.55)] backdrop-blur-[2px] overflow-hidden select-none"
    >
      {/* Draggable Panel Header (After Effects Tab Bar style) */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        className={`h-8 shrink-0 px-2.5 flex items-center justify-between gap-2 bg-[#1F1F1F] cursor-move ${
          layout.minimized ? '' : 'border-b border-[#383838]'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-[3px] h-3.5 rounded-full bg-[#2D8CEB] shrink-0" />
          <h2 className="text-[12px] font-semibold tracking-tight text-[#E8E8E8] truncate">
            {title}
          </h2>
          {headerExtra}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUpdateLayout(layout.id, { minimized: !layout.minimized });
          }}
          aria-label={
            layout.minimized ? `Expand ${title} panel` : `Minimize ${title} panel`
          }
          aria-expanded={!layout.minimized}
          title={layout.minimized ? 'Expand panel' : 'Minimize panel'}
          className="w-5 h-5 rounded flex items-center justify-center text-[#A8A8A8] hover:text-white hover:bg-[#353535] transition-colors shrink-0"
        >
          {layout.minimized ? (
            <Plus className="w-3.5 h-3.5" />
          ) : (
            <Minus className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Body */}
      {!layout.minimized && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#262626]">
          {children}
        </div>
      )}

      {/* Bottom-Right Resize Grip */}
      {!layout.minimized && (
        <div
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          title="Drag to resize panel"
          className="absolute right-0 bottom-0 w-3.5 h-3.5 cursor-nwse-resize flex items-end justify-end p-[2px] opacity-65 hover:opacity-100"
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            className="text-[#888888]"
            aria-hidden="true"
          >
            <path
              d="M7 1L1 7M7 4L4 7M7 7L7 7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
    </section>
  );
}
