import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Film,
  Grid,
  Layers,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  CompositionLayer,
  CompositionState,
  PhysicsSimulationState,
  RiokaPuppetEffect,
} from '../types/puppet';
import { evaluatePuppetRig, evaluateTrackAtFrame } from '../engine/rigging';
import {
  computePhysicsOutputDeltas,
  createInitialPhysicsState,
  stepPhysicsSimulation,
} from '../engine/physics';
import { renderPuppetToCanvas } from '../engine/canvasRenderer';
import { drawCompositionBackdropLayer } from '../engine/compositionBg';
import { cacheManager, formatBytesToMB } from '../engine/cacheManager';
import {
  exportDoubleMp4Animation,
  exportLosslessMovAnimation,
} from '../engine/videoExporter';

interface CompositionViewProps {
  composition: CompositionState;
  onChangeComposition: (
    updater: (prev: CompositionState) => CompositionState
  ) => void;
  onOpenPuppetStudio: () => void;
  onAddSolidLayer: () => void;
  onApplyEffectToSelected: () => void;
  onRemoveEffectFromSelected: () => void;
  onRenewPsdFile: (file: File) => void;
  onSimulatePsdUpdate: () => void;
  onPurgeCache: () => void;
  statusMessage: string | null;
}

function formatTimecode(frame: number, fps: number): string {
  const whole = Math.max(0, Math.floor(frame));
  const secs = Math.floor(whole / fps);
  const remFrames = whole % fps;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `00:${pad(mins)}:${pad(remSecs)}:${pad(remFrames)}`;
}

export function CompositionView({
  composition,
  onChangeComposition,
  onOpenPuppetStudio,
  onAddSolidLayer,
  onApplyEffectToSelected,
  onRemoveEffectFromSelected,
  onRenewPsdFile,
  onSimulatePsdUpdate,
  onPurgeCache,
  statusMessage,
}: CompositionViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const psdInputRef = useRef<HTMLInputElement | null>(null);
  const compRef = useRef(composition);
  compRef.current = composition;

  const [cacheStats, setCacheStats] = useState(() => cacheManager.getStats());
  const [mp4BitrateMbps, setMp4BitrateMbps] = useState(16);
  const [exportingMode, setExportingMode] = useState<'mov' | 'double_mp4' | null>(
    null
  );
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const solidGalleryImgRef = useRef<HTMLImageElement | null>(null);
  const solidGalleryVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    return cacheManager.subscribe(() => setCacheStats(cacheManager.getStats()));
  }, []);

  const physicsStatesRef = useRef<Record<string, PhysicsSimulationState>>({});
  const pointerLookRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });
  const dragOffsetRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origOffX: number;
    origOffY: number;
  }>({ dragging: false, startX: 0, startY: 0, origOffX: 0, origOffY: 0 });

  const [expandedLayerIds, setExpandedLayerIds] = useState<
    Record<string, boolean>
  >({
    comp_layer_puppet_1: true,
  });

  const selectedLayer: CompositionLayer | undefined = composition.layers.find(
    (l) => l.id === composition.selectedLayerId
  );
  const effect: RiokaPuppetEffect | null = selectedLayer?.effect ?? null;

  // Load & sync optional Gallery background when "Show on actual solid layer" is enabled
  useEffect(() => {
    const bg = effect?.galleryBackground;
    if (!bg || !bg.showOnSolidLayer) {
      solidGalleryImgRef.current = null;
      return;
    }
    if (bg.mediaType === 'image') {
      const img = new Image();
      img.onload = () => {
        solidGalleryImgRef.current = img;
      };
      img.src = bg.url;
    } else if (bg.mediaType === 'video' && solidGalleryVideoRef.current) {
      const vid = solidGalleryVideoRef.current;
      if (vid.src !== bg.url) {
        vid.src = bg.url;
        vid.load();
      }
      if (bg.syncWithAnimation) {
        const target =
          bg.startTimeSec + composition.currentFrame / Math.max(1, composition.fps);
        const wrapped =
          Number.isFinite(vid.duration) && vid.duration > 0
            ? target % vid.duration
            : target;
        if (Math.abs(vid.currentTime - wrapped) > 0.08) {
          try {
            vid.currentTime = Math.max(0, wrapped);
          } catch {
            // ignore while loading
          }
        }
        if (composition.isPlaying) {
          vid.play().catch(() => {});
        } else {
          vid.pause();
        }
      } else {
        vid.play().catch(() => {});
      }
    }
  }, [
    effect?.galleryBackground,
    composition.currentFrame,
    composition.fps,
    composition.isPlaying,
  ]);

  // Timeline playback loop (advances currentFrame smoothly at composition.fps)
  useEffect(() => {
    if (!composition.isPlaying) return;
    let timerId = 0;
    let lastTime = performance.now();
    let frameAccum = compRef.current.currentFrame;

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      const c = compRef.current;
      frameAccum += dt * c.fps;
      if (frameAccum > c.durationFrames) {
        if (c.loop) {
          frameAccum = frameAccum % c.durationFrames;
        } else {
          frameAccum = c.durationFrames;
          onChangeComposition((prev) => ({
            ...prev,
            currentFrame: prev.durationFrames,
            isPlaying: false,
          }));
          return;
        }
      }
      onChangeComposition((prev) => ({
        ...prev,
        currentFrame: Math.floor(frameAccum),
      }));
      timerId = window.setTimeout(tick, 33);
    };

    timerId = window.setTimeout(tick, 33);
    return () => window.clearTimeout(timerId);
  }, [composition.isPlaying, onChangeComposition]);

  // Real-time 30fps Composition Viewport render + Live Pendulum Physics loop
  useEffect(() => {
    let cancelled = false;
    let timerId = 0;
    let lastNow = performance.now();
    let elapsedSec = 0;

    const drawFrame = () => {
      if (cancelled) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.008, (now - lastNow) / 1000));
      lastNow = now;
      elapsedSec += dt;

      const canvas = canvasRef.current;
      const c = compRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const cw = canvas.width;
          const ch = canvas.height;
          ctx.clearRect(0, 0, cw, ch);

          // Render layers bottom-to-top (AE order: index 0 is top layer)
          const hasSolo = c.layers.some((l) => l.solo);
          const ordered = [...c.layers].reverse();

          for (const layer of ordered) {
            if (!layer.visible) continue;
            if (hasSolo && !layer.solo) continue;
            if (c.currentFrame < layer.inFrame || c.currentFrame > layer.outFrame) {
              continue;
            }

            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity / 100));

            if (layer.effect && layer.effect.enabled) {
              const eff = layer.effect;
              const puppet = eff.puppet;

              const paramValues: Record<string, number> = {};
              for (const p of puppet.parameters) {
                const track = eff.tracks[p.id];
                paramValues[p.id] = evaluateTrackAtFrame(
                  track,
                  c.currentFrame,
                  p.value
                );
              }

              if (eff.autoBreath) {
                const breathCycle = 0.5 + 0.5 * Math.sin(elapsedSec * 2.1);
                paramValues.ParamBreath = Math.max(
                  paramValues.ParamBreath ?? 0,
                  breathCycle * 0.85
                );
              }

              if (eff.autoBlink) {
                const blinkPeriod = 3.8;
                const phase = elapsedSec % blinkPeriod;
                if (phase > blinkPeriod - 0.18) {
                  const localT = (phase - (blinkPeriod - 0.18)) / 0.18;
                  const blinkFactor = Math.abs(Math.cos(localT * Math.PI));
                  paramValues.ParamEyeLOpen = Math.min(
                    paramValues.ParamEyeLOpen ?? 1,
                    blinkFactor
                  );
                  paramValues.ParamEyeROpen = Math.min(
                    paramValues.ParamEyeROpen ?? 1,
                    blinkFactor
                  );
                }
              }

              if (eff.cursorTracking && pointerLookRef.current.active) {
                paramValues.ParamAngleX = pointerLookRef.current.x * 26;
                paramValues.ParamAngleY = -pointerLookRef.current.y * 20;
                paramValues.ParamAngleZ = pointerLookRef.current.x * 9;
                paramValues.ParamEyeBallX = pointerLookRef.current.x * 0.9;
                paramValues.ParamEyeBallY = -pointerLookRef.current.y * 0.8;
                paramValues.ParamBodyAngleX = pointerLookRef.current.x * 5;
              }

              const prevPhys =
                physicsStatesRef.current[layer.id] ??
                createInitialPhysicsState(puppet.physicsGroups);
              const nextPhys = stepPhysicsSimulation(
                puppet.physicsGroups,
                prevPhys,
                {
                  dt,
                  time: elapsedSec,
                  paramValues,
                  windStrength: eff.windStrength,
                  windTurbulence: eff.windTurbulence,
                  strengthMultiplier: eff.physicsEnabled
                    ? eff.physicsStrength
                    : 0,
                }
              );
              physicsStatesRef.current[layer.id] = nextPhys;

              const rigResult = evaluatePuppetRig(
                puppet,
                paramValues,
                puppet.physicsGroups,
                nextPhys,
                eff.physicsEnabled ? eff.physicsStrength : 0
              );

              // If user enabled "Show on actual solid layer" for a Gallery Image/Video, composite it on the Solid Layer first
              const gBg = eff.galleryBackground;
              if (gBg && gBg.showOnSolidLayer) {
                const drawCover = (
                  src: CanvasImageSource,
                  natW: number,
                  natH: number
                ) => {
                  if (natW <= 0 || natH <= 0) return;
                  const sCover = Math.max(cw / natW, ch / natH);
                  const dw = natW * sCover;
                  const dh = natH * sCover;
                  ctx.drawImage(src, (cw - dw) * 0.5, (ch - dh) * 0.5, dw, dh);
                };
                if (gBg.mediaType === 'image' && solidGalleryImgRef.current) {
                  drawCover(
                    solidGalleryImgRef.current,
                    solidGalleryImgRef.current.naturalWidth,
                    solidGalleryImgRef.current.naturalHeight
                  );
                } else if (
                  gBg.mediaType === 'video' &&
                  solidGalleryVideoRef.current &&
                  solidGalleryVideoRef.current.readyState >= 2
                ) {
                  drawCover(
                    solidGalleryVideoRef.current,
                    solidGalleryVideoRef.current.videoWidth,
                    solidGalleryVideoRef.current.videoHeight
                  );
                }
              }

              const baseScale = (ch / puppet.modelHeight) * 0.94 * (eff.scale / 100);
              renderPuppetToCanvas(
                ctx,
                puppet,
                rigResult,
                puppet.physicsGroups,
                nextPhys,
                {
                  offsetX: cw * 0.5 + eff.offsetX * (cw / 1920),
                  offsetY: ch * 0.52 + eff.offsetY * (ch / 1080),
                  scale: baseScale,
                  rotationDeg: eff.rotation,
                }
              );
            } else {
              drawCompositionBackdropLayer(ctx, layer, 0, 0, cw, ch);
            }

            ctx.restore();
          }

          if (c.showSafeGuides) {
            ctx.save();
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(cw * 0.05, ch * 0.05, cw * 0.9, ch * 0.9);
            ctx.strokeRect(cw * 0.1, ch * 0.1, cw * 0.8, ch * 0.8);
            ctx.beginPath();
            ctx.moveTo(cw * 0.5 - 12, ch * 0.5);
            ctx.lineTo(cw * 0.5 + 12, ch * 0.5);
            ctx.moveTo(cw * 0.5, ch * 0.5 - 12);
            ctx.lineTo(cw * 0.5, ch * 0.5 + 12);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      timerId = window.setTimeout(drawFrame, 33);
    };

    drawFrame();
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, []);

  const updateSelectedEffect = (
    updater: (eff: RiokaPuppetEffect) => RiokaPuppetEffect
  ) => {
    onChangeComposition((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) =>
        layer.id === prev.selectedLayerId && layer.effect
          ? { ...layer, effect: updater(layer.effect) }
          : layer
      ),
    }));
  };

  const handleParamSliderChange = (paramId: string, newVal: number) => {
    const frame = composition.currentFrame;
    updateSelectedEffect((eff) => {
      const nextParams = eff.puppet.parameters.map((p) =>
        p.id === paramId ? { ...p, value: newVal } : p
      );
      const track = eff.tracks[paramId];
      let nextTracks = eff.tracks;

      if (track && track.stopwatchEnabled) {
        const existsIdx = track.keyframes.findIndex((k) => k.frame === frame);
        const nextKfs =
          existsIdx >= 0
            ? track.keyframes.map((k, idx) =>
                idx === existsIdx ? { ...k, value: newVal } : k
              )
            : [
                ...track.keyframes,
                {
                  id: `kf_${paramId}_${frame}_${Date.now()}`,
                  frame,
                  value: newVal,
                  easing: 'easeInOut' as const,
                },
              ].sort((a, b) => a.frame - b.frame);

        nextTracks = {
          ...eff.tracks,
          [paramId]: { ...track, keyframes: nextKfs },
        };
      }

      return {
        ...eff,
        puppet: { ...eff.puppet, parameters: nextParams },
        tracks: nextTracks,
      };
    });
  };

  const handleToggleStopwatch = (paramId: string, currentVal: number) => {
    const frame = composition.currentFrame;
    updateSelectedEffect((eff) => {
      const existing = eff.tracks[paramId] ?? {
        parameterId: paramId,
        stopwatchEnabled: false,
        keyframes: [],
      };
      const enabling = !existing.stopwatchEnabled;
      return {
        ...eff,
        tracks: {
          ...eff.tracks,
          [paramId]: {
            ...existing,
            stopwatchEnabled: enabling,
            keyframes: enabling
              ? existing.keyframes.length > 0
                ? existing.keyframes
                : [
                    {
                      id: `kf_${paramId}_${frame}_${Date.now()}`,
                      frame,
                      value: currentVal,
                      easing: 'easeInOut',
                    },
                  ]
              : [],
          },
        },
      };
    });
  };

  const handleAddOrDeleteKeyframe = (paramId: string, currentVal: number) => {
    const frame = composition.currentFrame;
    updateSelectedEffect((eff) => {
      const existing = eff.tracks[paramId] ?? {
        parameterId: paramId,
        stopwatchEnabled: true,
        keyframes: [],
      };
      const hasAtFrame = existing.keyframes.some((k) => k.frame === frame);
      const nextKfs = hasAtFrame
        ? existing.keyframes.filter((k) => k.frame !== frame)
        : [
            ...existing.keyframes,
            {
              id: `kf_${paramId}_${frame}_${Date.now()}`,
              frame,
              value: currentVal,
              easing: 'easeInOut' as const,
            },
          ].sort((a, b) => a.frame - b.frame);

      return {
        ...eff,
        tracks: {
          ...eff.tracks,
          [paramId]: {
            ...existing,
            stopwatchEnabled: true,
            keyframes: nextKfs,
          },
        },
      };
    });
  };

  const handleCanvasPointerMove = (
    e: React.PointerEvent<HTMLCanvasElement>
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    pointerLookRef.current = {
      x: Math.max(-1, Math.min(1, nx)),
      y: Math.max(-1, Math.min(1, ny)),
      active: true,
    };

    if (dragOffsetRef.current.dragging && effect) {
      const dx = (e.clientX - dragOffsetRef.current.startX) * (1920 / rect.width);
      const dy = (e.clientY - dragOffsetRef.current.startY) * (1080 / rect.height);
      updateSelectedEffect((eff) => ({
        ...eff,
        offsetX: Math.round(dragOffsetRef.current.origOffX + dx),
        offsetY: Math.round(dragOffsetRef.current.origOffY + dy),
      }));
    }
  };

  const handleCanvasPointerDown = (
    e: React.PointerEvent<HTMLCanvasElement>
  ) => {
    if (!effect || effect.cursorTracking) return;
    dragOffsetRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origOffX: effect.offsetX,
      origOffY: effect.offsetY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragOffsetRef.current.dragging = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleDeleteLayer = (layerId: string) => {
    onChangeComposition((prev) => {
      if (prev.layers.length <= 1) return prev;
      const nextLayers = prev.layers.filter((l) => l.id !== layerId);
      const nextSelected =
        prev.selectedLayerId === layerId ? nextLayers[0].id : prev.selectedLayerId;
      return { ...prev, layers: nextLayers, selectedLayerId: nextSelected };
    });
  };

  const handleBakeAnimationToSolidLayer = () => {
    if (!effect) return;
    const dt = 1 / Math.max(1, composition.fps);
    let sim = createInitialPhysicsState(effect.puppet.physicsGroups);
    const bakedByParam: Record<string, Array<{ frame: number; value: number }>> =
      {};
    const stepFrames = 4;

    for (let f = 0; f <= composition.durationFrames; f++) {
      const paramVals: Record<string, number> = {};
      for (const p of effect.puppet.parameters) {
        paramVals[p.id] = evaluateTrackAtFrame(effect.tracks[p.id], f, p.value);
      }
      sim = stepPhysicsSimulation(effect.puppet.physicsGroups, sim, {
        dt,
        time: f * dt,
        paramValues: paramVals,
        windStrength: effect.windStrength,
        windTurbulence: effect.windTurbulence,
        strengthMultiplier: effect.physicsEnabled ? effect.physicsStrength : 0,
      });

      if (f % stepFrames === 0 || f === composition.durationFrames) {
        const physDeltas = computePhysicsOutputDeltas(
          effect.puppet.physicsGroups,
          sim,
          effect.physicsEnabled ? effect.physicsStrength : 0
        );
        for (const p of effect.puppet.parameters) {
          const combined = Math.max(
            p.min,
            Math.min(p.max, (paramVals[p.id] ?? p.value) + (physDeltas.parameters[p.id] ?? 0))
          );
          if (!bakedByParam[p.id]) bakedByParam[p.id] = [];
          bakedByParam[p.id].push({
            frame: f,
            value: Number(combined.toFixed(3)),
          });
        }
      }
    }

    updateSelectedEffect((eff) => {
      const nextTracks = { ...eff.tracks };
      for (const [paramId, pts] of Object.entries(bakedByParam)) {
        nextTracks[paramId] = {
          parameterId: paramId,
          stopwatchEnabled: true,
          keyframes: pts.map((pt) => ({
            id: `kf_solidbake_${paramId}_${pt.frame}`,
            frame: pt.frame,
            value: pt.value,
            easing: 'easeInOut' as const,
          })),
        };
      }
      return {
        ...eff,
        keyframeTarget: 'after_effects',
        bakedToSolidLayer: true,
        tracks: nextTracks,
      };
    });

    cacheManager.registerPhysicsFrames(
      composition.durationFrames,
      effect.puppet.physicsGroups.length
    );
    setExportStatus(
      `Baked ${composition.durationFrames + 1} frames (rig + physics) directly onto "${selectedLayer?.name ?? 'Solid Layer'}".`
    );
  };

  const handleRenderLosslessMov = async () => {
    if (!effect || exportingMode) return;
    setExportingMode('mov');
    setExportProgress(2);
    setExportStatus('Encoding Lossless 32-bit RGBA .MOV (with Alpha)...');
    try {
      const fileName = await exportLosslessMovAnimation(
        composition,
        effect,
        (pct) => setExportProgress(pct)
      );
      setExportStatus(`Exported Lossless RGBA .MOV: ${fileName}`);
    } catch (err) {
      setExportStatus(
        err instanceof Error ? err.message : 'Failed to render Lossless .MOV.'
      );
    } finally {
      setExportingMode(null);
    }
  };

  const handleRenderDoubleMp4 = async () => {
    if (!effect || exportingMode) return;
    setExportingMode('double_mp4');
    setExportProgress(2);
    setExportStatus(
      `Encoding Double MP4 (H.264 RGB + Alpha Only @ ${mp4BitrateMbps} Mbps)...`
    );
    try {
      const res = await exportDoubleMp4Animation(
        composition,
        effect,
        mp4BitrateMbps,
        (pct) => setExportProgress(pct)
      );
      setExportStatus(
        `Exported Double MP4 (${res.bitrateMbps} Mbps): ${res.rgbFile} + ${res.alphaFile}`
      );
    } catch (err) {
      setExportStatus(
        err instanceof Error ? err.message : 'Failed to render Double MP4.'
      );
    } finally {
      setExportingMode(null);
    }
  };

  const frameProgressPct =
    (composition.currentFrame / Math.max(1, composition.durationFrames)) * 100;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#1D1D1D]">
      <video
        ref={solidGalleryVideoRef}
        muted
        loop
        playsInline
        className="hidden"
      />
      {/* Upper Split: Left Effect Controls + Right Composition Viewport */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT PANEL: After Effects Effect Controls */}
        <aside
          aria-label="Effect Controls"
          className="w-[320px] shrink-0 flex flex-col bg-[#232323] border-r border-[#383838] min-h-0"
        >
          <div className="px-4 py-2.5 border-b border-[#383838] flex items-center justify-between">
            <div className="min-w-0">
              <h2 className="text-[12px] font-semibold text-[#ECEFF4] truncate">
                Effect Controls
              </h2>
              <p className="text-[11px] text-[#8E98AB] truncate">
                {selectedLayer ? selectedLayer.name : 'No Layer Selected'}
              </p>
            </div>
            {effect && (
              <button
                type="button"
                onClick={onRemoveEffectFromSelected}
                aria-label="Remove Rioka's Puppeting Tools effect"
                title="Remove effect from solid"
                className="p-1.5 text-[#8E98AB] hover:text-[#F87171] rounded transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
            {!selectedLayer ? (
              <p className="text-[12px] text-[#8E98AB]">
                Select a Solid Layer in the timeline below to inspect or apply
                effects.
              </p>
            ) : !effect ? (
              <div className="p-4 rounded-lg bg-[#1C202A] border border-[#2B3140] space-y-3">
                <div className="space-y-1">
                  <p className="text-[13px] font-semibold text-[#ECEFF4]">
                    No Puppet Effect Applied
                  </p>
                  <p className="text-[12px] text-[#949EB2] leading-relaxed">
                    Just like Element 3D or Trapcode Particular, attach
                    Rioka&apos;s Puppeting Tools to this Solid Layer to rig a
                    Live2D character and render it directly in the composition.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onApplyEffectToSelected}
                  className="w-full py-2 px-3 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[12px] font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Apply Rioka&apos;s Puppeting Tools
                </button>
              </div>
            ) : (
              <>
                {/* Effect Header & Primary Launch Studio Button */}
                <div className="space-y-2.5 pb-3.5 border-b border-[#262B36]">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-[12px] font-semibold text-[#F3F6FA] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={effect.enabled}
                        onChange={(e) =>
                          updateSelectedEffect((eff) => ({
                            ...eff,
                            enabled: e.target.checked,
                          }))
                        }
                        className="accent-[#3B82F6] rounded"
                      />
                      Rioka&apos;s Puppeting Tools
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedEffect((eff) => ({
                          ...eff,
                          offsetX: 0,
                          offsetY: 28,
                          scale: 100,
                          rotation: 0,
                          puppet: {
                            ...eff.puppet,
                            parameters: eff.puppet.parameters.map((p) => ({
                              ...p,
                              value: p.defaultValue,
                            })),
                          },
                        }))
                      }
                      className="text-[11px] text-[#8E98AB] hover:text-[#ECEFF4] flex items-center gap-1 transition-colors whitespace-nowrap"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={onOpenPuppetStudio}
                    className="w-full py-2.5 px-3.5 rounded-md bg-[#2D8CEB] hover:bg-[#1E7AD6] text-white text-[12px] font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Rioka Puppeting Tools...
                  </button>
                </div>

                {/* Outside-Window Bake & Render Output (Solid Layer / Lossless .MOV / Double MP4) */}
                <div
                  data-testid="outside-export-panel"
                  className="space-y-2 pb-3.5 border-b border-[#343434]"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-[#D6D6D6]">
                      Solid Layer Bake &amp; Render Output
                    </span>
                    {effect.bakedToSolidLayer && (
                      <span className="text-[10px] font-mono text-[#34D399]">
                        Baked
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleBakeAnimationToSolidLayer}
                    className="w-full py-1.5 px-2.5 rounded bg-[#2B3344] hover:bg-[#34415A] border border-[#3E5070] text-[11px] font-medium text-[#E8F1FF] flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Layers className="w-3.5 h-3.5 text-[#60A5FA]" />
                    Bake Animation to Solid Layer
                  </button>

                  <button
                    type="button"
                    disabled={exportingMode !== null}
                    onClick={handleRenderLosslessMov}
                    className="w-full py-1.5 px-2.5 rounded bg-[#2B2B2B] hover:bg-[#383838] disabled:opacity-50 border border-[#444444] text-[11px] font-medium text-[#ECECEC] flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Film className="w-3.5 h-3.5 text-[#F59E0B]" />
                    Render Lossless .MOV (RGBA Alpha)
                  </button>

                  <div className="p-2 rounded bg-[#1B1B1B] border border-[#343434] space-y-2">
                    <div className="flex items-center justify-between text-[10px]">
                      <label
                        htmlFor="ae-mp4-bitrate"
                        className="text-[#BFBFBF] font-medium"
                      >
                        Double MP4 Bitrate (H.264)
                      </label>
                      <span className="font-mono tabular-nums text-[#93C5FD]">
                        {mp4BitrateMbps} Mbps
                      </span>
                    </div>
                    <input
                      id="ae-mp4-bitrate"
                      type="range"
                      min={2}
                      max={50}
                      step={1}
                      value={mp4BitrateMbps}
                      onChange={(e) =>
                        setMp4BitrateMbps(parseInt(e.target.value, 10))
                      }
                      className="w-full studio-slider"
                    />
                    <button
                      type="button"
                      disabled={exportingMode !== null}
                      onClick={handleRenderDoubleMp4}
                      className="w-full py-1.5 px-2.5 rounded bg-[#2D8CEB] hover:bg-[#1E7AD6] disabled:opacity-50 text-[11px] font-medium text-white flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Render Double MP4 (RGB + Alpha)
                    </button>
                  </div>

                  {exportingMode && (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full rounded bg-[#141414] overflow-hidden">
                        <div
                          className="h-full bg-[#2D8CEB] transition-all duration-150"
                          style={{ width: `${exportProgress}%` }}
                        />
                      </div>
                      <p className="text-[10px] font-mono text-[#93C5FD]">
                        Rendering {exportProgress}%...
                      </p>
                    </div>
                  )}

                  {exportStatus && (
                    <p
                      role="status"
                      data-testid="outside-export-status"
                      className="text-[10px] text-[#93C5FD] leading-snug break-words"
                    >
                      {exportStatus}
                    </p>
                  )}
                </div>

                {/* After Effects Shared Disk Cache & Memory Purge */}
                <div className="space-y-1.5 pb-3.5 border-b border-[#343434]">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-[#D6D6D6]">
                      AE Cache &amp; Memory
                    </span>
                    <span className="font-mono tabular-nums text-[#A0A0A0]">
                      RAM {formatBytesToMB(cacheStats.ramBytes)} · Disk{' '}
                      {formatBytesToMB(cacheStats.diskCacheBytes)}
                    </span>
                  </div>
                  <p
                    className="text-[10px] font-mono text-[#888888] truncate"
                    title={cacheStats.cacheFolderPath}
                  >
                    {cacheStats.cacheFolderPath}
                  </p>
                  <button
                    type="button"
                    onClick={onPurgeCache}
                    className="w-full py-1.5 px-2.5 rounded bg-[#2B2B2B] hover:bg-[#3A2828] border border-[#444444] text-[11px] font-medium text-[#E8E8E8] flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Trash2 className="w-3 h-3 text-[#F87171]" />
                    Edit → Purge All Memory &amp; Disk Cache
                  </button>
                </div>

                {/* Renewable PSD Live Link */}
                <div className="space-y-2 pb-3.5 border-b border-[#262B36]">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-[#CBD5E1]">
                      Linked PSD Source
                    </span>
                    <span className="font-mono tabular-nums text-[#8E98AB]">
                      Rev {effect.puppet.psd.revision} ·{' '}
                      {effect.puppet.layers.length} layers
                    </span>
                  </div>
                  <p className="text-[12px] font-mono text-[#ECEFF4] truncate">
                    {effect.puppet.psd.fileName}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      ref={psdInputRef}
                      type="file"
                      accept=".psd"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onRenewPsdFile(file);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => psdInputRef.current?.click()}
                      className="py-1.5 px-2.5 rounded bg-[#222733] hover:bg-[#2B3140] border border-[#32394A] text-[11px] font-medium text-[#ECEFF4] flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Upload className="w-3 h-3" />
                      Import .PSD
                    </button>
                    <button
                      type="button"
                      onClick={onSimulatePsdUpdate}
                      className="py-1.5 px-2.5 rounded bg-[#222733] hover:bg-[#2B3140] border border-[#32394A] text-[11px] font-medium text-[#ECEFF4] flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Renew PSD
                    </button>
                  </div>
                  {statusMessage && (
                    <p
                      role="status"
                      className="text-[11px] text-[#93C5FD] leading-snug"
                    >
                      {statusMessage}
                    </p>
                  )}
                </div>

                {/* Physics & Live Simulation Overrides */}
                <div className="space-y-2.5 pb-3.5 border-b border-[#262B36]">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-[#CBD5E1]">
                      Physics &amp; Secondary Motion
                    </span>
                    <label className="flex items-center gap-1.5 text-[11px] text-[#949EB2] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={effect.physicsEnabled}
                        onChange={(e) =>
                          updateSelectedEffect((eff) => ({
                            ...eff,
                            physicsEnabled: e.target.checked,
                          }))
                        }
                        className="accent-[#3B82F6]"
                      />
                      Active
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="ae-phys-strength" className="text-[#949EB2]">
                        Physics Strength
                      </label>
                      <span className="font-mono tabular-nums text-[#ECEFF4]">
                        {Math.round(effect.physicsStrength * 100)}%
                      </span>
                    </div>
                    <input
                      id="ae-phys-strength"
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={effect.physicsStrength}
                      onChange={(e) =>
                        updateSelectedEffect((eff) => ({
                          ...eff,
                          physicsStrength: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full studio-slider"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="ae-wind-strength" className="text-[#949EB2]">
                        Wind Force
                      </label>
                      <span className="font-mono tabular-nums text-[#ECEFF4]">
                        {effect.windStrength.toFixed(2)}
                      </span>
                    </div>
                    <input
                      id="ae-wind-strength"
                      type="range"
                      min={-2}
                      max={2}
                      step={0.05}
                      value={effect.windStrength}
                      onChange={(e) =>
                        updateSelectedEffect((eff) => ({
                          ...eff,
                          windStrength: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full studio-slider"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-[#CBD5E1]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={effect.autoBlink}
                        onChange={(e) =>
                          updateSelectedEffect((eff) => ({
                            ...eff,
                            autoBlink: e.target.checked,
                          }))
                        }
                        className="accent-[#3B82F6]"
                      />
                      Auto Blink
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={effect.autoBreath}
                        onChange={(e) =>
                          updateSelectedEffect((eff) => ({
                            ...eff,
                            autoBreath: e.target.checked,
                          }))
                        }
                        className="accent-[#3B82F6]"
                      />
                      Auto Breath
                    </label>
                  </div>
                </div>

                {/* Rig Parameters (Keyframeable on AE Timeline) */}
                <div className="space-y-2.5 pb-3.5 border-b border-[#262B36]">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-[#CBD5E1]">
                      Puppet Parameters
                    </span>
                    <span className="text-[11px] text-[#8E98AB]">
                      Stopwatch = Keyframe
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {effect.puppet.parameters.map((param) => {
                      const track = effect.tracks[param.id];
                      const evaluatedVal = evaluateTrackAtFrame(
                        track,
                        composition.currentFrame,
                        param.value
                      );
                      const isKeyframedHere = Boolean(
                        track?.keyframes.some(
                          (k) => k.frame === composition.currentFrame
                        )
                      );
                      return (
                        <div key={param.id} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleStopwatch(param.id, evaluatedVal)
                                }
                                aria-label={`Toggle keyframes for ${param.name}`}
                                aria-pressed={Boolean(track?.stopwatchEnabled)}
                                title={
                                  track?.stopwatchEnabled
                                    ? 'Disable timeline keyframes'
                                    : 'Enable timeline keyframes'
                                }
                                className={`p-0.5 rounded transition-colors ${
                                  track?.stopwatchEnabled
                                    ? 'text-[#3B82F6]'
                                    : 'text-[#647087] hover:text-[#CBD5E1]'
                                }`}
                              >
                                <Clock className="w-3.5 h-3.5" />
                              </button>
                              <label
                                htmlFor={`ae-param-${param.id}`}
                                className="text-[#CBD5E1] truncate"
                              >
                                {param.name}
                              </label>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {track?.stopwatchEnabled && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleAddOrDeleteKeyframe(
                                      param.id,
                                      evaluatedVal
                                    )
                                  }
                                  aria-label={
                                    isKeyframedHere
                                      ? `Remove keyframe for ${param.name}`
                                      : `Add keyframe for ${param.name}`
                                  }
                                  title="Add or remove keyframe at current frame"
                                  className={`w-2.5 h-2.5 rotate-45 border transition-colors ${
                                    isKeyframedHere
                                      ? 'bg-[#F59E0B] border-[#FBBF24]'
                                      : 'bg-transparent border-[#647087] hover:border-[#F59E0B]'
                                  }`}
                                />
                              )}
                              <span className="font-mono tabular-nums text-[#ECEFF4] w-11 text-right">
                                {evaluatedVal.toFixed(1)}
                              </span>
                            </div>
                          </div>
                          <input
                            id={`ae-param-${param.id}`}
                            type="range"
                            min={param.min}
                            max={param.max}
                            step={(param.max - param.min) / 100}
                            value={evaluatedVal}
                            onChange={(e) =>
                              handleParamSliderChange(
                                param.id,
                                parseFloat(e.target.value)
                              )
                            }
                            className="w-full studio-slider"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Solid Layer World Transform */}
                <div className="space-y-2.5">
                  <span className="text-[12px] font-semibold text-[#CBD5E1] block">
                    World Transform (Solid Layer)
                  </span>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="ae-world-scale" className="text-[#949EB2]">
                        Puppet Scale
                      </label>
                      <span className="font-mono tabular-nums text-[#ECEFF4]">
                        {effect.scale}%
                      </span>
                    </div>
                    <input
                      id="ae-world-scale"
                      type="range"
                      min={35}
                      max={180}
                      step={1}
                      value={effect.scale}
                      onChange={(e) =>
                        updateSelectedEffect((eff) => ({
                          ...eff,
                          scale: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full studio-slider"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label
                        htmlFor="ae-offset-x"
                        className="text-[11px] text-[#949EB2] block mb-1"
                      >
                        Pos X (px)
                      </label>
                      <input
                        id="ae-offset-x"
                        type="number"
                        value={effect.offsetX}
                        onChange={(e) =>
                          updateSelectedEffect((eff) => ({
                            ...eff,
                            offsetX: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-2 py-1 text-[12px] font-mono tabular-nums bg-[#111318] border border-[#2C313E] rounded text-[#ECEFF4]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="ae-offset-y"
                        className="text-[11px] text-[#949EB2] block mb-1"
                      >
                        Pos Y (px)
                      </label>
                      <input
                        id="ae-offset-y"
                        type="number"
                        value={effect.offsetY}
                        onChange={(e) =>
                          updateSelectedEffect((eff) => ({
                            ...eff,
                            offsetY: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-2 py-1 text-[12px] font-mono tabular-nums bg-[#111318] border border-[#2C313E] rounded text-[#ECEFF4]"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* CENTER: Composition Viewport */}
        <section
          aria-label="Composition Viewport"
          className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0E1015]"
        >
          {/* Viewport Toolbar */}
          <div className="h-10 shrink-0 px-4 border-b border-[#262B36] bg-[#15181F] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0 text-[12px]">
              <span className="font-semibold text-[#ECEFF4] truncate">
                {composition.name}
              </span>
              <span aria-hidden="true" className="text-[#475166]">
                ·
              </span>
              <span className="font-mono tabular-nums text-[#8E98AB] whitespace-nowrap">
                {composition.width}×{composition.height} · {composition.fps} fps
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {effect && (
                <button
                  type="button"
                  onClick={() =>
                    updateSelectedEffect((eff) => ({
                      ...eff,
                      cursorTracking: !eff.cursorTracking,
                    }))
                  }
                  aria-pressed={effect.cursorTracking}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    effect.cursorTracking
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#1F2430] text-[#CBD5E1] hover:bg-[#293040]'
                  }`}
                >
                  <MousePointer2 className="w-3 h-3" />
                  Cursor Look-At
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  onChangeComposition((prev) => ({
                    ...prev,
                    showTransparencyGrid: !prev.showTransparencyGrid,
                  }))
                }
                aria-pressed={composition.showTransparencyGrid}
                className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  composition.showTransparencyGrid
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-[#1F2430] text-[#CBD5E1] hover:bg-[#293040]'
                }`}
              >
                <Grid className="w-3 h-3" />
                Alpha Grid
              </button>

              <button
                type="button"
                onClick={() =>
                  onChangeComposition((prev) => ({
                    ...prev,
                    showSafeGuides: !prev.showSafeGuides,
                  }))
                }
                aria-pressed={composition.showSafeGuides}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  composition.showSafeGuides
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-[#1F2430] text-[#CBD5E1] hover:bg-[#293040]'
                }`}
              >
                Safe Guides
              </button>

              <select
                aria-label="Viewport zoom"
                value={composition.zoom}
                onChange={(e) =>
                  onChangeComposition((prev) => ({
                    ...prev,
                    zoom: parseFloat(e.target.value),
                  }))
                }
                className="px-2 py-1 rounded bg-[#1F2430] border border-[#2F3646] text-[11px] font-mono tabular-nums text-[#ECEFF4]"
              >
                <option value={0.75}>75%</option>
                <option value={1}>100%</option>
                <option value={1.25}>125%</option>
              </select>
            </div>
          </div>

          {/* 16:9 Live Composition Canvas Container */}
          <div className="flex-1 flex items-center justify-center p-5 overflow-hidden">
            <div
              className={`relative aspect-video w-full max-h-full max-w-[920px] rounded border border-[#2C313E] overflow-hidden shadow-lg ${
                composition.showTransparencyGrid
                  ? 'checkerboard-canvas'
                  : 'bg-[#12151C]'
              }`}
              style={{
                transform: `scale(${composition.zoom})`,
                transition: 'transform 160ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <canvas
                ref={canvasRef}
                data-testid="composition-canvas"
                width={960}
                height={540}
                onPointerMove={handleCanvasPointerMove}
                onPointerLeave={() => {
                  pointerLookRef.current.active = false;
                }}
                onPointerDown={handleCanvasPointerDown}
                onPointerUp={handleCanvasPointerUp}
                className={`w-full h-full block ${
                  effect?.cursorTracking ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
                }`}
              />
            </div>
          </div>
        </section>
      </div>

      {/* BOTTOM PANEL: After Effects Timeline & Solid Layer Stack */}
      <section
        aria-label="Timeline"
        className="h-[240px] shrink-0 flex flex-col bg-[#15181F] border-t border-[#262B36]"
      >
        {/* Timeline Transport Bar */}
        <div className="h-10 shrink-0 px-4 border-b border-[#262B36] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onAddSolidLayer}
              className="px-2.5 py-1 rounded bg-[#222733] hover:bg-[#2B3140] border border-[#32394A] text-[11px] font-medium text-[#ECEFF4] flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              New Solid
            </button>

            <span className="font-mono tabular-nums text-[12px] font-semibold text-[#38BDF8]">
              {formatTimecode(composition.currentFrame, composition.fps)}
            </span>
            <span className="font-mono tabular-nums text-[11px] text-[#8E98AB]">
              Frame {composition.currentFrame} / {composition.durationFrames}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                onChangeComposition((prev) => ({ ...prev, currentFrame: 0 }))
              }
              aria-label="Jump to start frame"
              className="p-1.5 rounded bg-[#1E222D] hover:bg-[#282E3D] text-[#CBD5E1] transition-colors"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                onChangeComposition((prev) => ({
                  ...prev,
                  isPlaying: !prev.isPlaying,
                }))
              }
              aria-label={composition.isPlaying ? 'Pause playback' : 'Play composition'}
              className="px-3 py-1 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[11px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              {composition.isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Play
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                onChangeComposition((prev) => ({
                  ...prev,
                  currentFrame: Math.min(
                    prev.durationFrames,
                    prev.currentFrame + 1
                  ),
                }))
              }
              aria-label="Step forward one frame"
              className="p-1.5 rounded bg-[#1E222D] hover:bg-[#282E3D] text-[#CBD5E1] transition-colors"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                onChangeComposition((prev) => ({ ...prev, loop: !prev.loop }))
              }
              aria-label="Toggle loop playback"
              aria-pressed={composition.loop}
              className={`p-1.5 rounded transition-colors ${
                composition.loop
                  ? 'bg-[#2563EB]/25 text-[#60A5FA]'
                  : 'bg-[#1E222D] text-[#8E98AB] hover:text-[#ECEFF4]'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Timeline Grid: Sticky Header + Pixel-Aligned Synced Rows */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#12151C]">
          {/* Sticky Ruler Header Row (320px left label + scrubbable right ruler) */}
          <div className="h-7 shrink-0 flex border-b border-[#262B36] bg-[#181C25]">
            <div className="w-[320px] shrink-0 px-3 border-r border-[#262B36] flex items-center justify-between text-[10px] font-medium text-[#8E98AB]">
              <span>Layer / Property Track</span>
              <span>Value</span>
            </div>
            <div className="flex-1 px-3 flex items-center relative">
              <input
                type="range"
                aria-label="Timeline playhead frame"
                min={0}
                max={composition.durationFrames}
                step={1}
                value={composition.currentFrame}
                onChange={(e) =>
                  onChangeComposition((prev) => ({
                    ...prev,
                    currentFrame: parseInt(e.target.value, 10),
                  }))
                }
                className="w-full studio-slider"
              />
            </div>
          </div>

          {/* Unified Vertically Scrolling Rows with Vertical Playhead Overlay */}
          <div className="flex-1 overflow-y-auto relative">
            {/* Playhead Guide Overlay positioned strictly over the right timeline lane */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 left-[320px] right-0 z-20"
            >
              <div
                className="absolute top-0 bottom-0 w-[1.5px] bg-[#3B82F6]"
                style={{
                  left: `calc(12px + (100% - 24px) * ${frameProgressPct / 100})`,
                }}
              />
            </div>

            {composition.layers.map((layer, index) => {
              const isSelected = layer.id === composition.selectedLayerId;
              const isExpanded = Boolean(expandedLayerIds[layer.id]);
              const activeTracks = layer.effect
                ? layer.effect.puppet.parameters.filter(
                    (p) => layer.effect?.tracks[p.id]?.stopwatchEnabled
                  )
                : [];

              return (
                <div key={layer.id} className="border-b border-[#222733]">
                  {/* Layer Main Row */}
                  <div className="flex h-8">
                    <div
                      className={`w-[320px] shrink-0 px-2.5 border-r border-[#262B36] flex items-center gap-2 text-[12px] ${
                        isSelected
                          ? 'bg-[#212A3E] text-[#F3F6FA]'
                          : 'bg-[#161921] text-[#CBD5E1] hover:bg-[#1B1F29]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onChangeComposition((prev) => ({
                            ...prev,
                            layers: prev.layers.map((l) =>
                              l.id === layer.id
                                ? { ...l, visible: !l.visible }
                                : l
                            ),
                          }))
                        }
                        aria-label={`Toggle visibility for ${layer.name}`}
                        className="text-[#8E98AB] hover:text-[#ECEFF4]"
                      >
                        {layer.visible ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5 text-[#555E72]" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedLayerIds((prev) => ({
                            ...prev,
                            [layer.id]: !prev[layer.id],
                          }))
                        }
                        aria-label={`Expand tracks for ${layer.name}`}
                        className="text-[#8E98AB] hover:text-[#ECEFF4]"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <span className="font-mono tabular-nums text-[10px] text-[#647087] w-4">
                        {index + 1}
                      </span>

                      <button
                        type="button"
                        onClick={() =>
                          onChangeComposition((prev) => ({
                            ...prev,
                            selectedLayerId: layer.id,
                          }))
                        }
                        className="flex-1 text-left truncate font-medium flex items-center gap-1.5"
                      >
                        <Layers className="w-3 h-3 shrink-0 text-[#60A5FA]" />
                        <span className="truncate">{layer.name}</span>
                      </button>

                      <span className="text-[10px] font-mono text-[#8E98AB] whitespace-nowrap">
                        {layer.effect ? 'FX · Puppet' : 'Solid'}
                      </span>

                      {composition.layers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteLayer(layer.id)}
                          aria-label={`Delete ${layer.name}`}
                          className="text-[#647087] hover:text-[#F87171] p-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Solid Duration Bar */}
                    <div className="flex-1 px-3 flex items-center bg-[#12151C]">
                      <div
                        className={`h-4 w-full rounded-sm border ${
                          layer.effect
                            ? 'bg-[#2563EB]/30 border-[#3B82F6]/60'
                            : 'bg-[#2A303E]/60 border-[#3C4457]'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Keyframed Parameter Sub-Rows (Synced Left Label + Right Diamonds) */}
                  {isExpanded &&
                    activeTracks.map((param) => {
                      const kfs =
                        layer.effect?.tracks[param.id]?.keyframes ?? [];
                      return (
                        <div
                          key={param.id}
                          className="flex h-7 border-t border-[#1D212C]"
                        >
                          <div className="w-[320px] shrink-0 pl-10 pr-3 border-r border-[#262B36] bg-[#13161D] flex items-center justify-between text-[11px] text-[#949EB2]">
                            <span className="truncate flex items-center gap-1.5">
                              <Sliders className="w-3 h-3 text-[#647087]" />
                              {param.name}
                            </span>
                            <span className="font-mono tabular-nums text-[#8E98AB]">
                              {evaluateTrackAtFrame(
                                layer.effect?.tracks[param.id],
                                composition.currentFrame,
                                param.value
                              ).toFixed(1)}
                            </span>
                          </div>

                          <div className="flex-1 px-3 relative flex items-center bg-[#12151C]">
                            <div className="w-full h-[1px] bg-[#242936]" />
                            {kfs.map((kf) => {
                              const pct =
                                (kf.frame /
                                  Math.max(1, composition.durationFrames)) *
                                100;
                              const isCurrent =
                                kf.frame === composition.currentFrame;
                              return (
                                <button
                                  key={kf.id}
                                  type="button"
                                  onClick={() =>
                                    onChangeComposition((prev) => ({
                                      ...prev,
                                      currentFrame: kf.frame,
                                    }))
                                  }
                                  aria-label={`Jump to ${param.name} keyframe at frame ${kf.frame}`}
                                  title={`${param.name}: ${kf.value.toFixed(1)} @ frame ${kf.frame}`}
                                  style={{
                                    left: `calc(12px + (100% - 24px) * ${pct / 100})`,
                                  }}
                                  className={`absolute -translate-x-1/2 w-2.5 h-2.5 rotate-45 border z-10 transition-transform hover:scale-125 ${
                                    isCurrent
                                      ? 'bg-[#60A5FA] border-white'
                                      : 'bg-[#F59E0B] border-[#FDE68A]'
                                  }`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
