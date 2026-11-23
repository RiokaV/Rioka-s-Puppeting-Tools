import React, { useEffect, useRef, useState } from 'react';
import { Activity, GitBranch, RotateCcw, X, Zap } from 'lucide-react';
import type {
  PhysicsGroup,
  PhysicsSimulationState,
  PuppetDocument,
} from '../types/puppet';
import {
  createInitialPhysicsState,
  stepPhysicsSimulation,
} from '../engine/physics';

interface PendulumViewerWindowProps {
  group: PhysicsGroup;
  physicsStrength: number;
  windStrength: number;
  windTurbulence: number;
  onClose: () => void;
}

/**
 * Isolated interactive Pendulum Viewer sandbox.
 * Lets users grab/drag/shake the pendulum anchor to demo physics behavior
 * WITHOUT modifying any original rigged parameters on the character.
 */
export function PendulumViewerWindow({
  group,
  physicsStrength,
  windStrength,
  windTurbulence,
  onClose,
}: PendulumViewerWindowProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pos, setPos] = useState({ x: 842, y: 108 });
  const panelDragRef = useRef<{
    active: boolean;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  }>({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  // Isolated sandbox simulation state (never writes to PuppetDocument parameters!)
  const sandboxRef = useRef<{
    physState: PhysicsSimulationState;
    virtualX: number; // -30..30 simulated input
    virtualY: number;
    dragging: boolean;
    impulseX: number;
    impulseY: number;
  }>({
    physState: createInitialPhysicsState([group]),
    virtualX: 0,
    virtualY: 0,
    dragging: false,
    impulseX: 0,
    impulseY: 0,
  });

  const propsRef = useRef({
    group,
    physicsStrength,
    windStrength,
    windTurbulence,
  });
  propsRef.current = { group, physicsStrength, windStrength, windTurbulence };

  // Re-initialize sandbox chain if group changes
  useEffect(() => {
    sandboxRef.current.physState = createInitialPhysicsState([group]);
  }, [group.id, group.pendulums.length]);

  useEffect(() => {
    let cancelled = false;
    let timerId = 0;
    let lastNow = performance.now();
    let elapsed = 0;

    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.01, (now - lastNow) / 1000));
      lastNow = now;
      elapsed += dt;

      const sb = sandboxRef.current;
      const p = propsRef.current;

      // Gently spring virtual drag handle back toward center when released
      if (!sb.dragging) {
        sb.virtualX *= Math.pow(0.08, dt);
        sb.virtualY *= Math.pow(0.08, dt);
      }

      const virtualParams: Record<string, number> = {};
      for (const inp of p.group.inputs) {
        if (inp.type === 'positionY') {
          virtualParams[inp.parameterId] = sb.virtualY;
        } else {
          virtualParams[inp.parameterId] = sb.virtualX;
        }
      }

      const nextState = stepPhysicsSimulation([p.group], sb.physState, {
        dt,
        time: elapsed,
        paramValues: virtualParams,
        windStrength: p.windStrength,
        windTurbulence: p.windTurbulence,
        strengthMultiplier: p.physicsStrength,
        impulseX: sb.impulseX,
        impulseY: sb.impulseY,
      });
      sb.physState = nextState;
      sb.impulseX = 0;
      sb.impulseY = 0;

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          // Grid background
          ctx.fillStyle = '#141414';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = 'rgba(255,255,255,0.05)';
          ctx.lineWidth = 1;
          for (let gx = 24; gx < w; gx += 24) {
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            ctx.lineTo(gx, h);
            ctx.stroke();
          }
          for (let gy = 24; gy < h; gy += 24) {
            ctx.beginPath();
            ctx.moveTo(0, gy);
            ctx.lineTo(w, gy);
            ctx.stroke();
          }

          const gState = nextState[p.group.id];
          if (gState) {
            const centerX = w * 0.5 + sb.virtualX * 2.1;
            const anchorY = 34 + sb.virtualY * 0.8;
            const scale = 0.72;

            // Anchor cross
            ctx.strokeStyle = '#60A5FA';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(centerX - 8, anchorY);
            ctx.lineTo(centerX + 8, anchorY);
            ctx.moveTo(centerX, anchorY - 8);
            ctx.lineTo(centerX, anchorY + 8);
            ctx.stroke();

            // Draw pendulum chain segments
            let prevX = centerX;
            let prevY = anchorY;
            for (let i = 0; i < gState.links.length; i++) {
              const link = gState.links[i];
              const dx = (link.worldX - gState.anchorWorldX) * scale;
              const dy = (link.worldY - gState.anchorWorldY) * scale;
              const lx = centerX + dx;
              const ly = anchorY + dy;

              ctx.strokeStyle = '#38BDF8';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(prevX, prevY);
              ctx.lineTo(lx, ly);
              ctx.stroke();

              ctx.fillStyle = i === gState.links.length - 1 ? '#F59E0B' : '#2D8CEB';
              ctx.beginPath();
              ctx.arc(lx, ly, i === gState.links.length - 1 ? 6 : 4.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = '#FFFFFF';
              ctx.lineWidth = 1.2;
              ctx.stroke();

              prevX = lx;
              prevY = ly;
            }

            // Anchor node
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(centerX, anchorY, 4.5, 0, Math.PI * 2);
            ctx.fill();

            // Tip angle readout
            const tip = gState.links[gState.links.length - 1];
            const tipDeg = tip ? ((tip.angle * 180) / Math.PI).toFixed(1) : '0.0';
            ctx.fillStyle = '#9E9E9E';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.fillText(`Tip Angle: ${tipDeg}°`, 8, h - 8);
          }
        }
      }

      timerId = window.setTimeout(tick, 33);
    };

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, []);

  const handleSandboxPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    sandboxRef.current.virtualX = Math.max(-30, Math.min(30, nx * 30));
    sandboxRef.current.virtualY = Math.max(-20, Math.min(20, ny * 20));
  };

  return (
    <div
      data-testid="pendulum-viewer-window"
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      className="fixed z-[82] w-[262px] rounded-[6px] bg-[#242424] border border-[#4A4A4A] shadow-2xl overflow-hidden select-none text-[11px]"
    >
      <div
        onPointerDown={(e) => {
          panelDragRef.current = {
            active: true,
            sx: e.clientX,
            sy: e.clientY,
            ox: pos.x,
            oy: pos.y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!panelDragRef.current.active) return;
          setPos({
            x: Math.max(8, panelDragRef.current.ox + (e.clientX - panelDragRef.current.sx)),
            y: Math.max(40, panelDragRef.current.oy + (e.clientY - panelDragRef.current.sy)),
          });
        }}
        onPointerUp={(e) => {
          panelDragRef.current.active = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        className="h-7 px-2.5 bg-[#202020] border-b border-[#3A3A3A] flex items-center justify-between cursor-grab active:cursor-grabbing"
      >
        <span className="font-semibold text-[#F0F0F0] flex items-center gap-1.5 truncate">
          <GitBranch className="w-3 h-3 text-[#38BDF8]" />
          Pendulum Viewer — {group.name}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Pendulum Viewer"
          className="text-[#9A9A9A] hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2 space-y-2">
        <canvas
          ref={canvasRef}
          width={244}
          height={188}
          onPointerDown={(e) => {
            sandboxRef.current.dragging = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            handleSandboxPointer(e);
          }}
          onPointerMove={(e) => {
            if (!sandboxRef.current.dragging) return;
            handleSandboxPointer(e);
          }}
          onPointerUp={(e) => {
            sandboxRef.current.dragging = false;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          className="w-full h-[188px] rounded border border-[#383838] cursor-grab active:cursor-grabbing block"
        />

        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[10px] text-[#9E9E9E] truncate">
            Drag inside to demo (rig untouched)
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                sandboxRef.current.impulseX = 52;
              }}
              className="px-1.5 py-0.5 rounded bg-[#D97706] hover:bg-[#B45309] text-white text-[10px] font-medium flex items-center gap-0.5"
            >
              <Zap className="w-2.5 h-2.5" />
              Test
            </button>
            <button
              type="button"
              onClick={() => {
                sandboxRef.current.physState = createInitialPhysicsState([group]);
                sandboxRef.current.virtualX = 0;
                sandboxRef.current.virtualY = 0;
              }}
              aria-label="Reset pendulum viewer"
              className="p-1 rounded bg-[#323232] hover:bg-[#3E3E3E] text-[#CCCCCC]"
            >
              <RotateCcw className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ParameterPhysicsPreviewWindowProps {
  puppet: PuppetDocument;
  physicsParamOffsets: Record<string, number>;
  onClose: () => void;
}

/**
 * Live Parameter Physics Preview monitor.
 * Shows secondary physics-driven parameters wiggling in real time whenever the user moves main parameters.
 */
export function ParameterPhysicsPreviewWindow({
  puppet,
  physicsParamOffsets,
  onClose,
}: ParameterPhysicsPreviewWindowProps) {
  const [pos, setPos] = useState({ x: 842, y: 368 });
  const dragRef = useRef<{
    active: boolean;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  }>({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  // Collect all parameters driven by any physics group (plus Physics-group params)
  const drivenIds = new Set<string>();
  for (const g of puppet.physicsGroups) {
    for (const out of g.outputs) {
      if (out.targetType === 'parameter') drivenIds.add(out.targetId);
    }
  }
  const physicsParams = puppet.parameters.filter(
    (p) => p.group === 'Physics' || drivenIds.has(p.id)
  );

  return (
    <div
      data-testid="param-physics-preview-window"
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      className="fixed z-[83] w-[262px] rounded-[6px] bg-[#242424] border border-[#4A4A4A] shadow-2xl overflow-hidden select-none text-[11px]"
    >
      <div
        onPointerDown={(e) => {
          dragRef.current = {
            active: true,
            sx: e.clientX,
            sy: e.clientY,
            ox: pos.x,
            oy: pos.y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current.active) return;
          setPos({
            x: Math.max(8, dragRef.current.ox + (e.clientX - dragRef.current.sx)),
            y: Math.max(40, dragRef.current.oy + (e.clientY - dragRef.current.sy)),
          });
        }}
        onPointerUp={(e) => {
          dragRef.current.active = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        className="h-7 px-2.5 bg-[#202020] border-b border-[#3A3A3A] flex items-center justify-between cursor-grab active:cursor-grabbing"
      >
        <span className="font-semibold text-[#F0F0F0] flex items-center gap-1.5 truncate">
          <Activity className="w-3 h-3 text-[#22C55E]" />
          Parameter Physics Preview
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Parameter Physics Preview"
          className="text-[#9A9A9A] hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2.5 space-y-2.5">
        <p className="text-[10px] text-[#9E9E9E]">
          {physicsParams.length > 0
            ? 'Move any main parameter (e.g. Head Angle X) to see secondary physics parameters wiggle live:'
            : 'No physics-driven parameters configured yet. Add parameters and connect a physics group to preview live wiggle.'}
        </p>

        {physicsParams.map((p) => {
          const delta = physicsParamOffsets[p.id] ?? 0;
          const combined = Math.max(p.min, Math.min(p.max, p.value + delta));
          const range = Math.max(0.001, p.max - p.min);
          const pct = ((combined - p.min) / range) * 100;
          const centerPct = ((p.defaultValue - p.min) / range) * 100;
          const barLeft = Math.min(centerPct, pct);
          const barWidth = Math.max(2, Math.abs(pct - centerPct));

          return (
            <div key={p.id} className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[#E5E5E5] font-medium truncate">
                  {p.name}
                </span>
                <span className="font-mono tabular-nums text-[#38BDF8]">
                  {delta >= 0 ? '+' : ''}
                  {delta.toFixed(2)}
                </span>
              </div>
              <div className="relative h-2.5 rounded bg-[#141414] border border-[#383838] overflow-hidden">
                {/* Center neutral tick */}
                <span
                  style={{ left: `${centerPct}%` }}
                  className="absolute top-0 bottom-0 w-px bg-[#555555]"
                />
                {/* Live wiggle fill bar */}
                <span
                  style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
                  className="absolute top-0 bottom-0 bg-[#38BDF8]/70"
                />
                {/* Wiggle indicator dot */}
                <span
                  style={{ left: `${pct}%` }}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white shadow"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
