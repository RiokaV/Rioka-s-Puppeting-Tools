import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Anchor,
  Brush,
  FolderPlus,
  Grid2x2,
  Grid3x3,
  Image as ImageIcon,
  Layers,
  Link2,
  MapPinPlus,
  MousePointer2,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  Unlink2,
  Wind,
} from 'lucide-react';
import type {
  AudioTrackConfig,
  CacheStats,
  CompositionState,
  CubicBezierTuple,
  EasingCurvePreset,
  ExpressionPreset,
  FloatingPanelLayout,
  GalleryBackgroundConfig,
  KeyframeEasing,
  ParameterTrack,
  PhysicsGroup,
  PhysicsSimulationState,
  PreviewResolution,
  PuppetDocument,
  RigParameter,
  RiokaPuppetEffect,
  StudioToolId,
  ThumbnailSize,
  ViewportBackground,
  WorkspaceView,
} from '../types/puppet';
import {
  buildDeformedMeshVertices,
  evaluatePuppetRig,
  evaluateTrackAtFrame,
  getLayerNonBoneWorldRotationDeg,
  syncParametersToFrame,
  transformLayerPointToModel,
} from '../engine/rigging';
import {
  computePhysicsOutputDeltas,
  createInitialPhysicsState,
  stepPhysicsSimulation,
} from '../engine/physics';
import { renderPuppetToCanvas } from '../engine/canvasRenderer';
import {
  drawCheckerboardRect,
  drawCompositionBackdropLayer,
  getBelowCompositionLayers,
} from '../engine/compositionBg';
import {
  applyBrushMorphToOffsets,
  addKeyformPointToParameter,
  applyKeyformPresetToParameter,
  clampMeshDimension,
  computeBoneGizmoGeometry,
  computeBoneTransformFromArrowPointer,
  computeMorphPinGizmoGeometry,
  computeMorphPinRotationFromPointer,
  computeMorphPinScaleFromPointer,
  copyMultiKeyframes,
  createDefaultBasicLattice,
  deleteKeyformPointFromParameter,
  deleteMultiKeyframes,
  hitTestBoneGizmo,
  hitTestMorphPinGizmo,
  isMorphPinMoved,
  MESH_MAX_SUBDIV,
  MESH_MIN_SUBDIV,
  moveMultiKeyframes,
  pasteKeyframesAtFrame,
  resetKeyformPoint,
  swapKeyformPoints,
  upsertKeyframeAtFrame,
  type KeyframeClipboardItem,
  type KeyframeSelectionItem,
} from '../engine/morphTools';
import {
  DEFAULT_CURVE_PRESETS,
  DEFAULT_EXPRESSION_PRESETS,
  applyEasingToKeyframes,
  computeAudioFramePeaks,
  createHistoryStack,
  generateAutoBlinkKeyframes,
  generateDemoVoiceSamples,
  generateLipSyncKeyframes,
  pushHistorySnapshot,
  redoHistory,
  reflectKeyformDeltas,
  undoHistory,
  wouldCreateLayerParentCycle,
} from '../engine/studioFeatures';
import {
  cacheManager,
  formatBytesToMB,
  getPreviewResolutionScale,
} from '../engine/cacheManager';
import { FloatingPanel } from './FloatingPanel';
import { PsdPanelContent } from './PsdPanelContent';
import {
  LinkedBlendPad,
  ParameterPanelContent,
} from './ParameterPanelContent';
import { AnimationPanelContent } from './AnimationPanelContent';
import { PhysicsPanelContent } from './PhysicsPanelContent';
import {
  ParameterPhysicsPreviewWindow,
  PendulumViewerWindow,
} from './PhysicsPreviews';
import { VideoBgPopup } from './VideoBgPopup';

interface PluginWindowViewProps {
  composition: CompositionState;
  effect: RiokaPuppetEffect;
  onChangeComposition: (
    updater: (prev: CompositionState) => CompositionState
  ) => void;
  onUpdateEffect: (
    updater: (eff: RiokaPuppetEffect) => RiokaPuppetEffect
  ) => void;
  onUpdatePuppet: (updater: (doc: PuppetDocument) => PuppetDocument) => void;
  onImportNewPsdFile: (file: File) => void;
  onRenewPsdFile: (file: File) => void;
  onSimulatePsdUpdate: () => void;
  onResetAllParameters: () => void;
  onResetAllKeyframes: () => void;
  onResetAllPhysics: () => void;
  onResetAll: () => void;
  onPurgeCache: () => void;
  onCancel: () => void;
  onApply: () => void;
  onExportAeKeyframes: () => void;
  onNavigateView: (view: WorkspaceView) => void;
  statusMessage: string | null;
  onFlashStatus: (msg: string) => void;
}

const BACKGROUNDS: Array<{ id: ViewportBackground; label: string }> = [
  { id: 'ae_composition', label: 'Use After Effects Composition' },
  { id: 'gallery', label: 'From Gallery (Image / Video)' },
  { id: 'black', label: 'Pure Black' },
  { id: 'ae_dark', label: 'AE Charcoal' },
  { id: 'checkerboard', label: 'Transparency Grid' },
  { id: 'light', label: 'Studio Light' },
  { id: 'green_screen', label: 'Chroma Green' },
];

const CURVE_PRESETS_STORAGE_KEY = 'rioka_curve_presets_v1';
const EXPRESSIONS_STORAGE_KEY = 'rioka_expressions_v1';

type StudioHistorySnapshot = {
  puppet: PuppetDocument;
  tracks: Record<string, ParameterTrack>;
};

function loadStoredCurvePresets(): EasingCurvePreset[] {
  if (typeof window === 'undefined') return DEFAULT_CURVE_PRESETS;
  try {
    const raw = window.localStorage.getItem(CURVE_PRESETS_STORAGE_KEY);
    if (!raw) return DEFAULT_CURVE_PRESETS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // ignore corrupted storage
  }
  return DEFAULT_CURVE_PRESETS;
}

function loadStoredExpressions(): ExpressionPreset[] {
  if (typeof window === 'undefined') return DEFAULT_EXPRESSION_PRESETS;
  try {
    const raw = window.localStorage.getItem(EXPRESSIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_EXPRESSION_PRESETS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // ignore corrupted storage
  }
  return DEFAULT_EXPRESSION_PRESETS;
}

function encodePcmToWavBlobUrl(
  samples: Float32Array,
  sampleRate: number
): string {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, Math.round(clamped * 32767), true);
    offset += 2;
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function createDefaultPanelLayouts(): Record<
  FloatingPanelLayout['id'],
  FloatingPanelLayout
> {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const psdW = vw < 1340 ? 196 : 214;
  const paramX = 10 + psdW + 8;
  const paramW = vw < 1340 ? 240 : 262;
  const rightW = vw < 1340 ? 276 : 294;
  const rightX = Math.max(paramX + paramW + 380, vw - rightW - 10);
  const animX = paramX + paramW + 12;
  const animW = Math.max(360, Math.min(618, rightX - animX - 12));
  const animH = 246;
  const animY = Math.max(420, vh - animH - 48);

  return {
    psd: {
      id: 'psd',
      x: 10,
      y: 52,
      width: psdW,
      height: Math.min(430, vh - 210),
      minimized: false,
      zIndex: 20,
    },
    parameter: {
      id: 'parameter',
      x: paramX,
      y: 96,
      width: paramW,
      height: Math.min(500, vh - 205),
      minimized: false,
      zIndex: 21,
    },
    animation: {
      id: 'animation',
      x: animX,
      y: animY,
      width: animW,
      height: animH,
      minimized: false,
      zIndex: 22,
    },
    physics: {
      id: 'physics',
      x: rightX,
      y: 88,
      width: rightW,
      height: Math.min(490, vh - 200),
      minimized: false,
      zIndex: 23,
    },
  };
}

export function PluginWindowView({
  composition,
  effect,
  onChangeComposition,
  onUpdateEffect,
  onUpdatePuppet,
  onImportNewPsdFile,
  onRenewPsdFile,
  onSimulatePsdUpdate,
  onResetAllParameters,
  onResetAllKeyframes,
  onResetAllPhysics,
  onResetAll,
  onPurgeCache,
  onCancel,
  onApply,
  onExportAeKeyframes,
  onNavigateView,
  statusMessage,
  onFlashStatus,
}: PluginWindowViewProps) {
  const puppet = effect.puppet;

  // Tool & UI states
  const [activeTool, setActiveTool] = useState<StudioToolId>('cursor');
  const initialLayerId =
    puppet.layers.find((l) => l.psdLayerName === 'Hair_Front_Bangs')?.id ??
    puppet.layers[0]?.id ??
    '';
  const [selectedLayerId, setSelectedLayerId] = useState<string>(initialLayerId);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>(
    initialLayerId ? [initialLayerId] : []
  );
  const [thumbnailSize, setThumbnailSize] = useState<ThumbnailSize>('normal');
  const [selectedParamId, setSelectedParamId] = useState<string>(
    puppet.parameters[0]?.id ?? 'ParamAngleX'
  );
  const [selectedPhysicsGroupId, setSelectedPhysicsGroupId] = useState<string>(
    puppet.physicsGroups[0]?.id ?? 'phys_hair_front'
  );
  const [showPhysicsOverlay, setShowPhysicsOverlay] = useState(false);
  const [showPendulumViewer, setShowPendulumViewer] = useState(false);
  const [showParamPhysicsPreview, setShowParamPhysicsPreview] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  // Keep selected layer, parameter, and physics group valid after importing a fresh PSD or deleting items
  useEffect(() => {
    if (puppet.layers.length === 0) return;
    if (!puppet.layers.some((l) => l.id === selectedLayerId)) {
      const topLayer = [...puppet.layers].sort((a, b) => b.zIndex - a.zIndex)[0];
      if (topLayer) {
        setSelectedLayerId(topLayer.id);
        setSelectedLayerIds([topLayer.id]);
      }
    }
  }, [puppet.layers, selectedLayerId]);

  useEffect(() => {
    if (puppet.parameters.length === 0) {
      if (selectedParamId !== '') setSelectedParamId('');
      return;
    }
    if (!puppet.parameters.some((p) => p.id === selectedParamId)) {
      setSelectedParamId(puppet.parameters[0].id);
    }
  }, [puppet.parameters, selectedParamId]);

  useEffect(() => {
    if (puppet.physicsGroups.length === 0) {
      if (selectedPhysicsGroupId !== '') setSelectedPhysicsGroupId('');
      if (showPendulumViewer) setShowPendulumViewer(false);
      return;
    }
    if (!puppet.physicsGroups.some((g) => g.id === selectedPhysicsGroupId)) {
      setSelectedPhysicsGroupId(puppet.physicsGroups[0].id);
    }
  }, [puppet.physicsGroups, selectedPhysicsGroupId, showPendulumViewer]);

  // Viewport background & popovers
  const [viewportBg, setViewportBg] = useState<ViewportBackground>(() =>
    effect.galleryBackground ? 'gallery' : 'black'
  );
  const [showBgMenu, setShowBgMenu] = useState(false);
  const [showVideoBgPopup, setShowVideoBgPopup] = useState(false);
  const [showMeshPopover, setShowMeshPopover] = useState(false);
  const [customMeshCols, setCustomMeshCols] = useState<string>('4');
  const [customMeshRows, setCustomMeshRows] = useState<string>('4');
  const [linkMeshAxes, setLinkMeshAxes] = useState<boolean>(true);
  const [showResetMenu, setShowResetMenu] = useState(false);
  const galleryFileInputRef = useRef<HTMLInputElement | null>(null);
  const galleryImageRef = useRef<HTMLImageElement | null>(null);
  const galleryVideoRef = useRef<HTMLVideoElement | null>(null);

  // Brush Morph state & Right-Click popover
  const [brushSize, setBrushSize] = useState(72);
  const [brushHardness, setBrushHardness] = useState(0.55);
  const [brushPopoverPos, setBrushPopoverPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const brushCursorRef = useRef<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 512, y: 512, visible: false });

  // 2D Linked Blend widget
  const [showLinkedPad, setShowLinkedPad] = useState(false);
  const [linkedParamXId, setLinkedParamXId] = useState('ParamAngleX');
  const [linkedParamYId, setLinkedParamYId] = useState('ParamAngleY');

  // Keyframe clipboard
  const [clipboard, setClipboard] = useState<KeyframeClipboardItem[]>([]);

  // Undo / Redo History Stack
  const historyRef = useRef(createHistoryStack<StudioHistorySnapshot>());
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });

  // Easing Curve Presets + Favorites (persisted in localStorage)
  const [curvePresets, setCurvePresets] = useState<EasingCurvePreset[]>(() =>
    loadStoredCurvePresets()
  );
  useEffect(() => {
    try {
      window.localStorage.setItem(
        CURVE_PRESETS_STORAGE_KEY,
        JSON.stringify(curvePresets)
      );
    } catch {
      // ignore storage quota errors
    }
  }, [curvePresets]);

  // Facial Expression Presets (persisted in localStorage)
  const [expressions, setExpressions] = useState<ExpressionPreset[]>(() =>
    loadStoredExpressions()
  );
  useEffect(() => {
    try {
      window.localStorage.setItem(
        EXPRESSIONS_STORAGE_KEY,
        JSON.stringify(expressions)
      );
    } catch {
      // ignore storage quota errors
    }
  }, [expressions]);

  // Audio Track & synced playback ref
  const [audioTrack, setAudioTrack] = useState<AudioTrackConfig | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Floating panel layouts (auto-reflow on window resize until user drags/resizes a panel)
  const [panels, setPanels] = useState<
    Record<FloatingPanelLayout['id'], FloatingPanelLayout>
  >(() => createDefaultPanelLayouts());
  const hasCustomPanelLayoutRef = useRef(false);
  const topZRef = useRef(30);

  useEffect(() => {
    const handleResize = () => {
      if (!hasCustomPanelLayoutRef.current) {
        setPanels(createDefaultPanelLayouts());
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Live cache & RAM stats
  const [cacheStats, setCacheStats] = useState<CacheStats>(() =>
    cacheManager.getStats()
  );

  // Live physics-driven parameter offsets (for real-time Parameter & Physics readout)
  const [livePhysicsParamOffsets, setLivePhysicsParamOffsets] = useState<
    Record<string, number>
  >({});

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const physicsStateRef = useRef<PhysicsSimulationState>(
    createInitialPhysicsState(puppet.physicsGroups)
  );
  const pendingImpulseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastBreathValueRef = useRef<number>(0);
  const viewportTransformRef = useRef<{
    offsetX: number;
    offsetY: number;
    scale: number;
    rotationDeg: number;
    compW: number;
    compH: number;
    canvasW: number;
    canvasH: number;
  }>({
    offsetX: 640,
    offsetY: 360,
    scale: 0.66,
    rotationDeg: 0,
    compW: 1280,
    compH: 720,
    canvasW: 1280,
    canvasH: 720,
  });

  // Keep latest props in refs so the 30fps loop never tears down
  const stateRef = useRef({
    composition,
    effect,
    activeTool,
    selectedLayerId,
    selectedPinId,
    selectedPhysicsGroupId,
    showPhysicsOverlay,
    brushSize,
    brushHardness,
    viewportBg,
  });
  stateRef.current = {
    composition,
    effect,
    activeTool,
    selectedLayerId,
    selectedPinId,
    selectedPhysicsGroupId,
    showPhysicsOverlay,
    brushSize,
    brushHardness,
    viewportBg,
  };

  // Interactive canvas drag state
  const canvasDragRef = useRef<{
    kind:
      | 'morph_pin_move'
      | 'morph_pin_rotate'
      | 'morph_pin_scale'
      | 'morph_pin_rest'
      | 'bone_anchor'
      | 'bone_move'
      | 'bone_rot_scale'
      | 'basic_lattice'
      | 'brush_morph'
      | 'char_move'
      | 'char_rotate'
      | null;
    pinId?: string;
    pinCenterModel?: { x: number; y: number };
    pinBaseRotDeg?: number;
    pinStartRot?: number;
    pinStartPointerAngleDeg?: number;
    pinStartScale?: number;
    pinStartDistModel?: number;
    latticeIdx?: number;
    bonePivotModel?: { x: number; y: number };
    boneBaseRotDeg?: number;
    lastModelX: number;
    lastModelY: number;
    startClientX: number;
    startClientY: number;
    origOffsetX: number;
    origOffsetY: number;
    origRotation: number;
  }>({
    kind: null,
    lastModelX: 0,
    lastModelY: 0,
    startClientX: 0,
    startClientY: 0,
    origOffsetX: 0,
    origOffsetY: 0,
    origRotation: 0,
  });

  // Load offscreen Gallery image/video media when effect.galleryBackground changes
  useEffect(() => {
    const bg = effect.galleryBackground;
    if (!bg) {
      galleryImageRef.current = null;
      return;
    }
    if (bg.mediaType === 'image') {
      const img = new Image();
      img.onload = () => {
        galleryImageRef.current = img;
      };
      img.src = bg.url;
    } else if (bg.mediaType === 'video') {
      const vid = galleryVideoRef.current;
      if (vid) {
        if (vid.src !== bg.url) {
          vid.src = bg.url;
          vid.load();
        }
        if (!bg.syncWithAnimation) {
          vid.play().catch(() => {});
        }
      }
    }
  }, [effect.galleryBackground?.url, effect.galleryBackground?.mediaType, effect.galleryBackground?.syncWithAnimation]);

  // Sync Gallery video playback with Animation timeline when syncWithAnimation is enabled
  useEffect(() => {
    const bg = effect.galleryBackground;
    const vid = galleryVideoRef.current;
    if (!bg || bg.mediaType !== 'video' || !vid) return;

    if (bg.syncWithAnimation) {
      const targetSec =
        bg.startTimeSec + composition.currentFrame / Math.max(1, composition.fps);
      const wrapped =
        Number.isFinite(vid.duration) && vid.duration > 0
          ? targetSec % vid.duration
          : targetSec;
      if (Math.abs(vid.currentTime - wrapped) > 0.08) {
        try {
          vid.currentTime = Math.max(0, wrapped);
        } catch {
          // ignore while metadata loads
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
  }, [
    effect.galleryBackground,
    composition.currentFrame,
    composition.fps,
    composition.isPlaying,
  ]);

  // Sync loaded Audio Track playback & scrub position with timeline
  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl || !audioTrack || !audioTrack.url) return;
    if (audioEl.src !== audioTrack.url) {
      audioEl.src = audioTrack.url;
      audioEl.load();
    }
    audioEl.volume = Math.max(0, Math.min(1, audioTrack.volume));
    const targetSec = composition.currentFrame / Math.max(1, composition.fps);
    if (Math.abs(audioEl.currentTime - targetSec) > 0.12) {
      try {
        audioEl.currentTime = Math.max(
          0,
          Math.min(audioTrack.durationSec, targetSec)
        );
      } catch {
        // ignore before metadata is ready
      }
    }
    if (composition.isPlaying) {
      audioEl.play().catch(() => {});
    } else {
      audioEl.pause();
    }
  }, [
    audioTrack,
    composition.currentFrame,
    composition.fps,
    composition.isPlaying,
  ]);

  // Undo / Redo helpers
  const recordUndoSnapshot = useCallback((tag?: string) => {
    const snap: StudioHistorySnapshot = structuredClone({
      puppet: stateRef.current.effect.puppet,
      tracks: stateRef.current.effect.tracks,
    });
    historyRef.current = pushHistorySnapshot(historyRef.current, snap, {
      tag,
    });
    setHistoryCounts({
      past: historyRef.current.past.length,
      future: historyRef.current.future.length,
    });
  }, []);

  const handleUndo = useCallback(() => {
    const currentSnap: StudioHistorySnapshot = structuredClone({
      puppet: stateRef.current.effect.puppet,
      tracks: stateRef.current.effect.tracks,
    });
    const res = undoHistory(historyRef.current, currentSnap);
    if (!res.restored) return;
    historyRef.current = res.stack;
    setHistoryCounts({
      past: res.stack.past.length,
      future: res.stack.future.length,
    });
    const restored = res.restored;
    onUpdateEffect((eff) => ({
      ...eff,
      puppet: restored.puppet,
      tracks: restored.tracks,
    }));
    onFlashStatus('Undo');
  }, [onUpdateEffect, onFlashStatus]);

  const handleRedo = useCallback(() => {
    const currentSnap: StudioHistorySnapshot = structuredClone({
      puppet: stateRef.current.effect.puppet,
      tracks: stateRef.current.effect.tracks,
    });
    const res = redoHistory(historyRef.current, currentSnap);
    if (!res.restored) return;
    historyRef.current = res.stack;
    setHistoryCounts({
      past: res.stack.past.length,
      future: res.stack.future.length,
    });
    const restored = res.restored;
    onUpdateEffect((eff) => ({
      ...eff,
      puppet: restored.puppet,
      tracks: restored.tracks,
    }));
    onFlashStatus('Redo');
  }, [onUpdateEffect, onFlashStatus]);

  // Global keyboard shortcuts for Undo (Ctrl/Cmd+Z) and Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)
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
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  // Subscribe to Cache Manager & update viewport framebuffer estimate
  useEffect(() => {
    const unsub = cacheManager.subscribe(() => {
      setCacheStats(cacheManager.getStats());
    });
    cacheManager.registerMeshBuffers(
      puppet.layers.length,
      effect.renderQuality,
      effect.customQualityPercent
    );
    return unsub;
  }, [puppet.layers.length, effect.renderQuality, effect.customQualityPercent]);

  // Scrubbing or stepping to a timeline frame immediately syncs all active animated tracks
  // to puppet.parameters so BOTH the viewport preview and Parameter sliders follow in real time.
  const handleScrubFrame = useCallback(
    (frame: number) => {
      const clampedFrame = Math.max(
        0,
        Math.min(stateRef.current.composition.durationFrames, Math.round(frame))
      );
      const tracks = stateRef.current.effect.tracks;
      const prevParams = stateRef.current.effect.puppet.parameters;
      const prevHeadX =
        prevParams.find((p) => p.id === 'ParamAngleX')?.value ?? 0;

      onChangeComposition((prev) =>
        prev.currentFrame === clampedFrame
          ? prev
          : { ...prev, currentFrame: clampedFrame }
      );

      onUpdatePuppet((doc) => {
        const synced = syncParametersToFrame(doc.parameters, tracks, clampedFrame);
        if (synced === doc.parameters) return doc;
        const nextHeadX =
          synced.find((p) => p.id === 'ParamAngleX')?.value ?? prevHeadX;
        const dx = nextHeadX - prevHeadX;
        if (Math.abs(dx) > 0.05) {
          pendingImpulseRef.current.x += Math.max(-18, Math.min(18, dx * 0.6));
        }
        return { ...doc, parameters: synced };
      });
    },
    [onChangeComposition, onUpdatePuppet]
  );

  // Playback loop inside Plugin Window
  useEffect(() => {
    if (!composition.isPlaying) return;
    let timerId = 0;
    let lastTime = performance.now();
    let frameAccum = composition.currentFrame;
    let lastEmittedFrame = composition.currentFrame;

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      const c = stateRef.current.composition;
      frameAccum += dt * c.fps;
      if (frameAccum > c.durationFrames) {
        frameAccum = c.loop ? frameAccum % c.durationFrames : c.durationFrames;
      }
      const nextFrame = Math.floor(frameAccum);
      if (nextFrame !== lastEmittedFrame) {
        lastEmittedFrame = nextFrame;
        handleScrubFrame(nextFrame);
      }
      timerId = window.setTimeout(tick, 33);
    };
    timerId = window.setTimeout(tick, 33);
    return () => window.clearTimeout(timerId);
  }, [composition.isPlaying, handleScrubFrame]);

  // Main 30fps Canvas Render & Live Physics Loop (software-renderer safe via setTimeout)
  useEffect(() => {
    let cancelled = false;
    let timerId = 0;
    let lastNow = performance.now();
    let elapsedSec = 0;
    let frameCounter = 0;

    const draw = () => {
      if (cancelled) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.008, (now - lastNow) / 1000));
      lastNow = now;
      elapsedSec += dt;
      frameCounter += 1;

      const s = stateRef.current;
      const canvas = canvasRef.current;
      if (canvas) {
        const resScale = getPreviewResolutionScale(
          s.effect.renderQuality,
          s.effect.customQualityPercent
        );
        const cssW = canvas.clientWidth || 1280;
        const cssH = canvas.clientHeight || 720;
        const targetW = Math.max(240, Math.round(cssW * resScale));
        const targetH = Math.max(160, Math.round(cssH * resScale));
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, targetW, targetH);

          // Build current parameter values (if playing or tracks active, combine with manual slider values)
          const paramValues: Record<string, number> = {};
          for (const p of s.effect.puppet.parameters) {
            const track = s.effect.tracks[p.id];
            paramValues[p.id] = s.composition.isPlaying
              ? evaluateTrackAtFrame(track, s.composition.currentFrame, p.value)
              : p.value;
          }

          if (s.effect.autoBreath) {
            const breath = 0.5 + 0.5 * Math.sin(elapsedSec * 2.0);
            const breathVal = breath * 0.7;
            lastBreathValueRef.current = breathVal;
            paramValues.ParamBreath = Math.max(
              paramValues.ParamBreath ?? 0,
              breathVal
            );
          } else {
            lastBreathValueRef.current = 0;
          }

          const impulseX = pendingImpulseRef.current.x;
          const impulseY = pendingImpulseRef.current.y;
          pendingImpulseRef.current = { x: 0, y: 0 };

          const nextPhys = stepPhysicsSimulation(
            s.effect.puppet.physicsGroups,
            physicsStateRef.current,
            {
              dt,
              time: elapsedSec,
              paramValues,
              windStrength: s.effect.windStrength,
              windTurbulence: s.effect.windTurbulence,
              strengthMultiplier: s.effect.physicsEnabled
                ? s.effect.physicsStrength
                : 0,
              impulseX,
              impulseY,
            }
          );
          physicsStateRef.current = nextPhys;

          const rigResult = evaluatePuppetRig(
            s.effect.puppet,
            paramValues,
            s.effect.puppet.physicsGroups,
            nextPhys,
            s.effect.physicsEnabled ? s.effect.physicsStrength : 0
          );

          // Sync live physics parameter readouts at ~6Hz so UI stays buttery smooth
          if (frameCounter % 5 === 0) {
            setLivePhysicsParamOffsets(rigResult.physicsParamOffsets);
          }

          // Full-viewport Composition Window filling 100% of the canvas stage
          const compX = 0;
          const compY = 0;
          const compW = targetW;
          const compH = targetH;
          const compCenterX = compW * 0.5;
          const compCenterY = compH * 0.5;

          // Character-only transform (Shift+Left-Drag move, Alt+Left-Drag rotate, Scroll scale)
          const charOffsetX =
            compCenterX +
            s.effect.offsetX * (compW / Math.max(1, s.composition.width));
          const charOffsetY =
            compCenterY +
            s.effect.offsetY * (compH / Math.max(1, s.composition.height));
          const charScale =
            (compH / s.effect.puppet.modelHeight) *
            0.94 *
            (s.effect.scale / 100);
          const charRotationDeg = s.effect.rotation;

          viewportTransformRef.current = {
            offsetX: charOffsetX,
            offsetY: charOffsetY,
            scale: charScale,
            rotationDeg: charRotationDeg,
            compW,
            compH,
            canvasW: targetW,
            canvasH: targetH,
          };
          canvas.dataset.compRect = `${Math.round(compX)},${Math.round(compY)},${Math.round(compW)},${Math.round(compH)}`;

          // Render selected Composition Background across the entire full-viewport Comp Window
          if (s.viewportBg === 'ae_composition') {
            const belowLayers = getBelowCompositionLayers(
              s.composition,
              s.composition.selectedLayerId
            );
            for (const belowLayer of belowLayers) {
              drawCompositionBackdropLayer(
                ctx,
                belowLayer,
                compX,
                compY,
                compW,
                compH
              );
            }
          } else if (s.viewportBg === 'gallery' && s.effect.galleryBackground) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(compX, compY, compW, compH);
            ctx.clip();
            ctx.fillStyle = '#0A0A0A';
            ctx.fillRect(compX, compY, compW, compH);

            const gBg = s.effect.galleryBackground;
            ctx.imageSmoothingEnabled = gBg.quality !== 'quarter';
            ctx.imageSmoothingQuality =
              gBg.quality === 'full'
                ? 'high'
                : gBg.quality === 'half'
                  ? 'medium'
                  : 'low';

            const drawMediaCover = (
              src: CanvasImageSource,
              natW: number,
              natH: number
            ) => {
              if (natW <= 0 || natH <= 0) return;
              const scaleCover = Math.max(compW / natW, compH / natH);
              const dw = natW * scaleCover;
              const dh = natH * scaleCover;
              ctx.drawImage(
                src,
                compX + (compW - dw) * 0.5,
                compY + (compH - dh) * 0.5,
                dw,
                dh
              );
            };

            if (gBg.mediaType === 'image' && galleryImageRef.current) {
              drawMediaCover(
                galleryImageRef.current,
                galleryImageRef.current.naturalWidth,
                galleryImageRef.current.naturalHeight
              );
            } else if (
              gBg.mediaType === 'video' &&
              galleryVideoRef.current &&
              galleryVideoRef.current.readyState >= 2
            ) {
              drawMediaCover(
                galleryVideoRef.current,
                galleryVideoRef.current.videoWidth,
                galleryVideoRef.current.videoHeight
              );
            }
            ctx.restore();
          } else if (s.viewportBg === 'black') {
            ctx.fillStyle = '#0A0A0A';
            ctx.fillRect(compX, compY, compW, compH);
          } else if (s.viewportBg === 'ae_dark') {
            ctx.fillStyle = '#1D1D1D';
            ctx.fillRect(compX, compY, compW, compH);
          } else if (s.viewportBg === 'checkerboard') {
            drawCheckerboardRect(
              ctx,
              compX,
              compY,
              compW,
              compH,
              Math.max(8, Math.round(12 * resScale)),
              '#1D1D1D',
              '#2E2E2E'
            );
          } else if (s.viewportBg === 'light') {
            ctx.fillStyle = '#DCDFE6';
            ctx.fillRect(compX, compY, compW, compH);
          } else if (s.viewportBg === 'green_screen') {
            ctx.fillStyle = '#00B140';
            ctx.fillRect(compX, compY, compW, compH);
          }

          const activePinDragKind =
            canvasDragRef.current.kind === 'morph_pin_move'
              ? 'move'
              : canvasDragRef.current.kind === 'morph_pin_rotate'
                ? 'rotate'
                : canvasDragRef.current.kind === 'morph_pin_scale'
                  ? 'scale'
                  : null;

          renderPuppetToCanvas(
            ctx,
            s.effect.puppet,
            rigResult,
            s.effect.puppet.physicsGroups,
            nextPhys,
            {
              offsetX: charOffsetX,
              offsetY: charOffsetY,
              scale: charScale,
              rotationDeg: charRotationDeg,
              activeTool: s.activeTool,
              showMeshWireframe: s.activeTool === 'mesh_create',
              showPhysicsOverlay: s.showPhysicsOverlay,
              selectedLayerId: s.selectedLayerId,
              selectedPhysicsGroupId: s.selectedPhysicsGroupId,
              selectedPinId: s.selectedPinId,
              activePinDragKind,
              brushCursor: {
                x: brushCursorRef.current.x,
                y: brushCursorRef.current.y,
                radius: s.brushSize,
                hardness: s.brushHardness,
                visible: brushCursorRef.current.visible,
              },
            }
          );

          const rotRad = (charRotationDeg * Math.PI) / 180;
          const cosR = Math.cos(rotRad);
          const sinR = Math.sin(rotRad);
          const modelToCanvasCss = (mx: number, my: number) => {
            const lx = (mx - s.effect.puppet.modelWidth * 0.5) * charScale;
            const ly = (my - s.effect.puppet.modelHeight * 0.5) * charScale;
            const cx = charOffsetX + lx * cosR - ly * sinR;
            const cy = charOffsetY + lx * sinR + ly * cosR;
            return {
              x: (cx / Math.max(1, targetW)) * cssW,
              y: (cy / Math.max(1, targetH)) * cssH,
            };
          };

          // Publish live screen-space Bone Gizmo handle coordinates on the canvas dataset when Bone Tool is active
          if (s.activeTool === 'bone_create') {
            const selL = s.effect.puppet.layers.find(
              (l) => l.id === s.selectedLayerId
            );
            if (selL) {
              const deformersById = Object.fromEntries(
                s.effect.puppet.deformers.map((d) => [d.id, d])
              );
              const layersById = Object.fromEntries(
                s.effect.puppet.layers.map((l) => [l.id, l])
              );
              const pivotLocal = {
                x: selL.x - selL.width * 0.5 + selL.width * selL.pivotX,
                y: selL.y - selL.height * 0.5 + selL.height * selL.pivotY,
              };
              const pivotW = transformLayerPointToModel(
                pivotLocal,
                selL,
                deformersById,
                rigResult,
                layersById
              );
              const baseRot = getLayerNonBoneWorldRotationDeg(
                selL,
                deformersById,
                rigResult,
                layersById
              );
              const geom = computeBoneGizmoGeometry(
                pivotW,
                selL.boneTransform.rotation,
                selL.boneTransform.scaleX,
                baseRot
              );
              const pCss = modelToCanvasCss(geom.pivotX, geom.pivotY);
              const tCss = modelToCanvasCss(geom.tipX, geom.tipY);
              canvas.dataset.boneGizmo = `${pCss.x.toFixed(1)},${pCss.y.toFixed(1)},${tCss.x.toFixed(1)},${tCss.y.toFixed(1)}`;
            }
          } else if (canvas.dataset.boneGizmo) {
            delete canvas.dataset.boneGizmo;
          }

          // Publish live screen-space Advanced Pin Gizmo handle coordinates on the canvas dataset when Main Cursor is active
          if (s.activeTool === 'cursor') {
            const selL = s.effect.puppet.layers.find(
              (l) => l.id === s.selectedLayerId
            );
            if (selL && selL.morphPins && selL.morphPins.length > 0) {
              const activePin =
                selL.morphPins.find((p) => p.id === s.selectedPinId) ??
                selL.morphPins[selL.morphPins.length - 1];
              const deformersById = Object.fromEntries(
                s.effect.puppet.deformers.map((d) => [d.id, d])
              );
              const layersById = Object.fromEntries(
                s.effect.puppet.layers.map((l) => [l.id, l])
              );
              const halfW = selL.width * 0.5;
              const halfH = selL.height * 0.5;
              const targetLocal = {
                x: selL.x - halfW + activePin.restU * selL.width + activePin.dx,
                y: selL.y - halfH + activePin.restV * selL.height + activePin.dy,
              };
              const centerW = transformLayerPointToModel(
                targetLocal,
                selL,
                deformersById,
                rigResult,
                layersById
              );
              const baseRot =
                getLayerNonBoneWorldRotationDeg(
                  selL,
                  deformersById,
                  rigResult,
                  layersById
                ) + (selL.boneTransform?.rotation ?? 0);
              const geom = computeMorphPinGizmoGeometry(
                centerW,
                activePin.rotation ?? 0,
                activePin.scale ?? 1,
                charScale,
                baseRot
              );
              const cCss = modelToCanvasCss(geom.centerX, geom.centerY);
              const sbCss = modelToCanvasCss(geom.scaleBoxX, geom.scaleBoxY);
              const rCss = modelToCanvasCss(geom.rotHandleX, geom.rotHandleY);
              canvas.dataset.pinGizmo = `${cCss.x.toFixed(1)},${cCss.y.toFixed(1)},${sbCss.x.toFixed(1)},${sbCss.y.toFixed(1)},${rCss.x.toFixed(1)},${rCss.y.toFixed(1)}`;
            } else if (canvas.dataset.pinGizmo) {
              delete canvas.dataset.pinGizmo;
            }
          } else if (canvas.dataset.pinGizmo) {
            delete canvas.dataset.pinGizmo;
          }
        }
      }

      timerId = window.setTimeout(draw, 33);
    };

    draw();
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, []);

  // Coordinate converter: client pointer -> 1024x1024 puppet model space (inverse character transform)
  const clientToModel = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 512, y: 512 };
      const rect = canvas.getBoundingClientRect();
      const vt = viewportTransformRef.current;
      const cx = ((clientX - rect.left) / Math.max(1, rect.width)) * vt.canvasW;
      const cy = ((clientY - rect.top) / Math.max(1, rect.height)) * vt.canvasH;
      const relX = cx - vt.offsetX;
      const relY = cy - vt.offsetY;
      const rad = (-vt.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const unrotX = relX * cos - relY * sin;
      const unrotY = relX * sin + relY * cos;
      return {
        x: unrotX / Math.max(0.001, vt.scale) + puppet.modelWidth * 0.5,
        y: unrotY / Math.max(0.001, vt.scale) + puppet.modelHeight * 0.5,
      };
    },
    [puppet.modelWidth, puppet.modelHeight]
  );

  // Helper to evaluate current rig snapshot on demand for hit-testing
  const evaluateCurrentRig = useCallback(() => {
    const paramValues: Record<string, number> = {};
    for (const p of puppet.parameters) paramValues[p.id] = p.value;
    if (effect.autoBreath && lastBreathValueRef.current > 0) {
      paramValues.ParamBreath = Math.max(
        paramValues.ParamBreath ?? 0,
        lastBreathValueRef.current
      );
    }
    const deformersById = Object.fromEntries(
      puppet.deformers.map((d) => [d.id, d])
    );
    const layersById = Object.fromEntries(
      puppet.layers.map((l) => [l.id, l])
    );
    const rig = evaluatePuppetRig(
      puppet,
      paramValues,
      puppet.physicsGroups,
      physicsStateRef.current,
      effect.physicsEnabled ? effect.physicsStrength : 0
    );
    return { rig, deformersById, layersById };
  }, [puppet, effect.autoBreath, effect.physicsEnabled, effect.physicsStrength]);

  // Canvas Pointer Handlers for Character-Only Transform + all 7 Tools!
  const handleCanvasPointerDown = (
    e: React.PointerEvent<HTMLCanvasElement>
  ) => {
    setShowBgMenu(false);
    setShowResetMenu(false);
    setBrushPopoverPos(null);

    // Character-only viewport manipulation:
    // Middle-Click Drag OR Shift + Left-Click Drag = Move character
    // Alt + Left-Click Drag = Rotate character (except Bone Create where Alt+Drag moves Bone Anchor)
    if (
      e.button === 1 ||
      (e.button === 0 &&
        (e.shiftKey || (e.altKey && activeTool !== 'bone_create')))
    ) {
      e.preventDefault();
      canvasDragRef.current = {
        kind: e.button === 1 || e.shiftKey ? 'char_move' : 'char_rotate',
        lastModelX: 0,
        lastModelY: 0,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origOffsetX: effect.offsetX,
        origOffsetY: effect.offsetY,
        origRotation: effect.rotation,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return; // ignore right-click (contextmenu) & extra buttons

    const pt = clientToModel(e.clientX, e.clientY);
    const layer = puppet.layers.find((l) => l.id === selectedLayerId);
    if (!layer) return;

    const { rig, deformersById, layersById } = evaluateCurrentRig();
    const halfW = layer.width * 0.5;
    const halfH = layer.height * 0.5;

    if (activeTool === 'add_morph_point') {
      // Check if clicking an existing pin to reposition rest point (without deforming mesh)
      let hitPinId: string | null = null;
      const pinRestHitR = 14 / Math.max(0.05, viewportTransformRef.current.scale);
      for (const pin of layer.morphPins) {
        const restLocal = {
          x: layer.x - halfW + pin.restU * layer.width + pin.dx,
          y: layer.y - halfH + pin.restV * layer.height + pin.dy,
        };
        const world = transformLayerPointToModel(
          restLocal,
          layer,
          deformersById,
          rig,
          layersById
        );
        if (Math.hypot(world.x - pt.x, world.y - pt.y) < pinRestHitR) {
          hitPinId = pin.id;
          break;
        }
      }

      if (hitPinId) {
        setSelectedPinId(hitPinId);
        recordUndoSnapshot('morph_pin_rest');
        canvasDragRef.current = {
          ...canvasDragRef.current,
          kind: 'morph_pin_rest',
          pinId: hitPinId,
          lastModelX: pt.x,
          lastModelY: pt.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        // Add new rest morph pin at clicked coordinates on layer
        recordUndoSnapshot('add_morph_point');
        const u = Math.max(0.02, Math.min(0.98, (pt.x - (layer.x - halfW)) / layer.width));
        const v = Math.max(0.02, Math.min(0.98, (pt.y - (layer.y - halfH)) / layer.height));
        const newPinId = `pin_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        onUpdatePuppet((doc) => ({
          ...doc,
          layers: doc.layers.map((l) =>
            l.id === layer.id
              ? {
                  ...l,
                  morphPins: [
                    ...l.morphPins,
                    { id: newPinId, restU: u, restV: v, dx: 0, dy: 0, rotation: 0, scale: 1 },
                  ],
                }
              : l
          ),
        }));
        setSelectedPinId(newPinId);
        onFlashStatus(
          `Added Pin on "${layer.name}". Switch to Main Cursor to Move, Rotate, or Scale (unmoved pins stay anchored).`
        );
      }
      return;
    }

    if (activeTool === 'cursor') {
      if (!layer.morphPins || layer.morphPins.length === 0) return;
      const vpScale = viewportTransformRef.current.scale;
      const baseRotDeg =
        getLayerNonBoneWorldRotationDeg(layer, deformersById, rig, layersById) +
        (layer.boneTransform?.rotation ?? 0);

      const activePin =
        layer.morphPins.find((p) => p.id === selectedPinId) ??
        layer.morphPins[layer.morphPins.length - 1];

      const getPinWorldPos = (pin: (typeof layer.morphPins)[number]) =>
        transformLayerPointToModel(
          {
            x: layer.x - halfW + pin.restU * layer.width + pin.dx,
            y: layer.y - halfH + pin.restV * layer.height + pin.dy,
          },
          layer,
          deformersById,
          rig,
          layersById
        );

      // 1) Hit-test the active pin's Advanced Pin Gizmo (Center Move / Blue Scale / Hollow Green Square & Ring Rotate)
      const activeCenterW = getPinWorldPos(activePin);
      const activeGeom = computeMorphPinGizmoGeometry(
        activeCenterW,
        activePin.rotation ?? 0,
        activePin.scale ?? 1,
        vpScale,
        baseRotDeg
      );
      const handleHit = hitTestMorphPinGizmo(pt, activeGeom, vpScale);

      if (handleHit !== 'none') {
        setSelectedPinId(activePin.id);
        if (handleHit === 'move') {
          recordUndoSnapshot('morph_pin_move');
          canvasDragRef.current = {
            ...canvasDragRef.current,
            kind: 'morph_pin_move',
            pinId: activePin.id,
            pinBaseRotDeg: baseRotDeg,
            lastModelX: pt.x,
            lastModelY: pt.y,
          };
        } else if (handleHit === 'rotate') {
          recordUndoSnapshot('morph_pin_rotate');
          const startPtrAngleDeg =
            (Math.atan2(pt.y - activeCenterW.y, pt.x - activeCenterW.x) * 180) /
            Math.PI;
          canvasDragRef.current = {
            ...canvasDragRef.current,
            kind: 'morph_pin_rotate',
            pinId: activePin.id,
            pinCenterModel: activeCenterW,
            pinBaseRotDeg: baseRotDeg,
            pinStartRot: activePin.rotation ?? 0,
            pinStartPointerAngleDeg: startPtrAngleDeg,
            lastModelX: pt.x,
            lastModelY: pt.y,
          };
        } else if (handleHit === 'scale') {
          recordUndoSnapshot('morph_pin_scale');
          const startDist = Math.hypot(
            pt.x - activeCenterW.x,
            pt.y - activeCenterW.y
          );
          canvasDragRef.current = {
            ...canvasDragRef.current,
            kind: 'morph_pin_scale',
            pinId: activePin.id,
            pinCenterModel: activeCenterW,
            pinStartScale: activePin.scale ?? 1,
            pinStartDistModel: startDist,
            lastModelX: pt.x,
            lastModelY: pt.y,
          };
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }

      // 2) Hit-test other pins' center dots to select & move them
      const otherPinHitR = 13 / Math.max(0.05, vpScale);
      for (const pin of layer.morphPins) {
        if (pin.id === activePin.id) continue;
        const world = getPinWorldPos(pin);
        if (Math.hypot(world.x - pt.x, world.y - pt.y) <= otherPinHitR) {
          setSelectedPinId(pin.id);
          recordUndoSnapshot('morph_pin_move');
          canvasDragRef.current = {
            ...canvasDragRef.current,
            kind: 'morph_pin_move',
            pinId: pin.id,
            pinBaseRotDeg: baseRotDeg,
            lastModelX: pt.x,
            lastModelY: pt.y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
      return;
    }

    if (activeTool === 'bone_create') {
      const pivotLocal = {
        x: layer.x - halfW + layer.width * layer.pivotX,
        y: layer.y - halfH + layer.height * layer.pivotY,
      };
      const pivotW = transformLayerPointToModel(
        pivotLocal,
        layer,
        deformersById,
        rig,
        layersById
      );
      const baseRotDeg = getLayerNonBoneWorldRotationDeg(
        layer,
        deformersById,
        rig,
        layersById
      );
      const geom = computeBoneGizmoGeometry(
        pivotW,
        layer.boneTransform.rotation,
        layer.boneTransform.scaleX,
        baseRotDeg
      );
      const hit = hitTestBoneGizmo(
        pt,
        geom,
        viewportTransformRef.current.scale
      );

      if (e.altKey) {
        recordUndoSnapshot('bone_anchor');
        canvasDragRef.current = {
          ...canvasDragRef.current,
          kind: 'bone_anchor',
          boneBaseRotDeg: baseRotDeg,
          lastModelX: pt.x,
          lastModelY: pt.y,
        };
      } else if (hit === 'arrow') {
        recordUndoSnapshot('bone_rot_scale');
        canvasDragRef.current = {
          ...canvasDragRef.current,
          kind: 'bone_rot_scale',
          bonePivotModel: pivotW,
          boneBaseRotDeg: baseRotDeg,
          lastModelX: pt.x,
          lastModelY: pt.y,
        };
      } else {
        // Dragging the Null Object circle (or layer body) moves the object
        recordUndoSnapshot('bone_move');
        canvasDragRef.current = {
          ...canvasDragRef.current,
          kind: 'bone_move',
          bonePivotModel: pivotW,
          boneBaseRotDeg: baseRotDeg,
          lastModelX: pt.x,
          lastModelY: pt.y,
        };
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool === 'basic_morph') {
      const lat = layer.basicLattice;
      let bestIdx = -1;
      let bestDist = 26;
      for (let r = 0; r <= lat.rows; r++) {
        const v = r / lat.rows;
        for (let c = 0; c <= lat.cols; c++) {
          const u = c / lat.cols;
          const idx = r * (lat.cols + 1) + c;
          const off = lat.offsets[idx] ?? { dx: 0, dy: 0 };
          const lp = {
            x: layer.x - halfW + u * layer.width + off.dx,
            y: layer.y - halfH + v * layer.height + off.dy,
          };
          const world = transformLayerPointToModel(
            lp,
            layer,
            deformersById,
            rig,
            layersById
          );
          const d = Math.hypot(world.x - pt.x, world.y - pt.y);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = idx;
          }
        }
      }
      if (bestIdx >= 0) {
        recordUndoSnapshot('basic_lattice');
        canvasDragRef.current = {
          ...canvasDragRef.current,
          kind: 'basic_lattice',
          latticeIdx: bestIdx,
          lastModelX: pt.x,
          lastModelY: pt.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }

    if (activeTool === 'brush_morph') {
      recordUndoSnapshot('brush_morph');
      canvasDragRef.current = {
        ...canvasDragRef.current,
        kind: 'brush_morph',
        lastModelX: pt.x,
        lastModelY: pt.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handleCanvasPointerMove = (
    e: React.PointerEvent<HTMLCanvasElement>
  ) => {
    const pt = clientToModel(e.clientX, e.clientY);
    brushCursorRef.current = { x: pt.x, y: pt.y, visible: true };

    const drag = canvasDragRef.current;
    if (!drag.kind) {
      // Dynamic hover cursor feedback for Advanced Pin Gizmo handles in Main Cursor mode
      if (activeTool === 'cursor') {
        const layer = puppet.layers.find((l) => l.id === selectedLayerId);
        if (layer && layer.morphPins && layer.morphPins.length > 0) {
          const vpScale = viewportTransformRef.current.scale;
          const { rig, deformersById, layersById } = evaluateCurrentRig();
          const halfW = layer.width * 0.5;
          const halfH = layer.height * 0.5;
          const activePin =
            layer.morphPins.find((p) => p.id === selectedPinId) ??
            layer.morphPins[layer.morphPins.length - 1];
          const baseRotDeg =
            getLayerNonBoneWorldRotationDeg(layer, deformersById, rig, layersById) +
            (layer.boneTransform?.rotation ?? 0);
          const centerW = transformLayerPointToModel(
            {
              x: layer.x - halfW + activePin.restU * layer.width + activePin.dx,
              y: layer.y - halfH + activePin.restV * layer.height + activePin.dy,
            },
            layer,
            deformersById,
            rig,
            layersById
          );
          const geom = computeMorphPinGizmoGeometry(
            centerW,
            activePin.rotation ?? 0,
            activePin.scale ?? 1,
            vpScale,
            baseRotDeg
          );
          const hit = hitTestMorphPinGizmo(pt, geom, vpScale);
          if (hit === 'move') {
            e.currentTarget.style.cursor = 'move';
          } else if (hit === 'rotate') {
            e.currentTarget.style.cursor = 'grab';
          } else if (hit === 'scale') {
            e.currentTarget.style.cursor = 'ns-resize';
          } else {
            const otherHitR = 13 / Math.max(0.05, vpScale);
            let onOther = false;
            for (const pin of layer.morphPins) {
              if (pin.id === activePin.id) continue;
              const pw = transformLayerPointToModel(
                {
                  x: layer.x - halfW + pin.restU * layer.width + pin.dx,
                  y: layer.y - halfH + pin.restV * layer.height + pin.dy,
                },
                layer,
                deformersById,
                rig,
                layersById
              );
              if (Math.hypot(pw.x - pt.x, pw.y - pt.y) <= otherHitR) {
                onOther = true;
                break;
              }
            }
            e.currentTarget.style.cursor = onOther ? 'pointer' : '';
          }
        } else if (e.currentTarget.style.cursor) {
          e.currentTarget.style.cursor = '';
        }
      } else if (e.currentTarget.style.cursor) {
        e.currentTarget.style.cursor = '';
      }
      return;
    }

    if (drag.kind === 'char_move') {
      const rect = e.currentTarget.getBoundingClientRect();
      const vt = viewportTransformRef.current;
      const compCssW = Math.max(
        1,
        (vt.compW / Math.max(1, vt.canvasW)) * rect.width
      );
      const compCssH = Math.max(
        1,
        (vt.compH / Math.max(1, vt.canvasH)) * rect.height
      );
      const dxComp =
        (e.clientX - drag.startClientX) * (composition.width / compCssW);
      const dyComp =
        (e.clientY - drag.startClientY) * (composition.height / compCssH);
      onUpdateEffect((eff) => ({
        ...eff,
        offsetX: Math.round(drag.origOffsetX + dxComp),
        offsetY: Math.round(drag.origOffsetY + dyComp),
      }));
      return;
    }

    if (drag.kind === 'char_rotate') {
      const dAngle = (e.clientX - drag.startClientX) * 0.45;
      onUpdateEffect((eff) => ({
        ...eff,
        rotation: Math.max(
          -180,
          Math.min(180, Math.round(drag.origRotation + dAngle))
        ),
      }));
      return;
    }

    const dx = pt.x - drag.lastModelX;
    const dy = pt.y - drag.lastModelY;
    drag.lastModelX = pt.x;
    drag.lastModelY = pt.y;

    const layer = puppet.layers.find((l) => l.id === selectedLayerId);
    if (!layer) return;

    if (drag.kind === 'morph_pin_rest' && drag.pinId) {
      // Moves ONLY the pin rest position — mesh does NOT deform
      const du = dx / Math.max(10, layer.width);
      const dv = dy / Math.max(10, layer.height);
      onUpdatePuppet((doc) => ({
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === layer.id
            ? {
                ...l,
                morphPins: l.morphPins.map((pin) =>
                  pin.id === drag.pinId
                    ? {
                        ...pin,
                        restU: Math.max(0, Math.min(1, pin.restU + du)),
                        restV: Math.max(0, Math.min(1, pin.restV + dv)),
                      }
                    : pin
                ),
              }
            : l
        ),
      }));
    } else if (drag.kind === 'morph_pin_move' && drag.pinId) {
      const parentRad = (-(drag.pinBaseRotDeg ?? 0) * Math.PI) / 180;
      const cosP = Math.cos(parentRad);
      const sinP = Math.sin(parentRad);
      const localDx = dx * cosP - dy * sinP;
      const localDy = dx * sinP + dy * cosP;
      onUpdatePuppet((doc) => ({
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === layer.id
            ? {
                ...l,
                morphPins: l.morphPins.map((pin) =>
                  pin.id === drag.pinId
                    ? { ...pin, dx: pin.dx + localDx, dy: pin.dy + localDy }
                    : pin
                ),
              }
            : l
        ),
      }));
    } else if (
      drag.kind === 'morph_pin_rotate' &&
      drag.pinId &&
      drag.pinCenterModel
    ) {
      const nextRot = computeMorphPinRotationFromPointer(
        drag.pinCenterModel,
        pt,
        drag.pinStartPointerAngleDeg ?? 0,
        drag.pinStartRot ?? 0
      );
      onUpdatePuppet((doc) => ({
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === layer.id
            ? {
                ...l,
                morphPins: l.morphPins.map((pin) =>
                  pin.id === drag.pinId ? { ...pin, rotation: nextRot } : pin
                ),
              }
            : l
        ),
      }));
    } else if (
      drag.kind === 'morph_pin_scale' &&
      drag.pinId &&
      drag.pinCenterModel
    ) {
      const nextScale = computeMorphPinScaleFromPointer(
        drag.pinCenterModel,
        pt,
        drag.pinStartDistModel ?? 1,
        drag.pinStartScale ?? 1,
        viewportTransformRef.current.scale
      );
      onUpdatePuppet((doc) => ({
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === layer.id
            ? {
                ...l,
                morphPins: l.morphPins.map((pin) =>
                  pin.id === drag.pinId ? { ...pin, scale: nextScale } : pin
                ),
              }
            : l
        ),
      }));
    } else if (drag.kind === 'bone_anchor') {
      const du = dx / Math.max(10, layer.width);
      const dv = dy / Math.max(10, layer.height);
      onUpdatePuppet((doc) => ({
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === layer.id
            ? {
                ...l,
                pivotX: Math.max(-0.5, Math.min(1.5, l.pivotX + du)),
                pivotY: Math.max(-0.5, Math.min(1.5, l.pivotY + dv)),
              }
            : l
        ),
      }));
    } else if (drag.kind === 'bone_move') {
      const parentRad = (-(drag.boneBaseRotDeg ?? 0) * Math.PI) / 180;
      const cosP = Math.cos(parentRad);
      const sinP = Math.sin(parentRad);
      const localDx = dx * cosP - dy * sinP;
      const localDy = dx * sinP + dy * cosP;
      onUpdatePuppet((doc) => ({
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === layer.id
            ? {
                ...l,
                boneTransform: {
                  ...l.boneTransform,
                  dx: l.boneTransform.dx + localDx,
                  dy: l.boneTransform.dy + localDy,
                },
              }
            : l
        ),
      }));
    } else if (drag.kind === 'bone_rot_scale' && drag.bonePivotModel) {
      const { rotation, scale } = computeBoneTransformFromArrowPointer(
        drag.bonePivotModel,
        pt,
        drag.boneBaseRotDeg ?? 0
      );
      onUpdatePuppet((doc) => ({
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === layer.id
            ? {
                ...l,
                boneTransform: {
                  ...l.boneTransform,
                  rotation,
                  scaleX: scale,
                  scaleY: scale,
                },
              }
            : l
        ),
      }));
    } else if (drag.kind === 'basic_lattice' && drag.latticeIdx !== undefined) {
      const idx = drag.latticeIdx;
      onUpdatePuppet((doc) => ({
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === layer.id
            ? {
                ...l,
                basicLattice: {
                  ...l.basicLattice,
                  offsets: l.basicLattice.offsets.map((off, i) =>
                    i === idx ? { dx: off.dx + dx, dy: off.dy + dy } : off
                  ),
                },
              }
            : l
        ),
      }));
    } else if (drag.kind === 'brush_morph') {
      const { rig, deformersById, layersById } = evaluateCurrentRig();
      const vertices = buildDeformedMeshVertices(
        layer,
        deformersById,
        rig,
        layersById
      );
      const nextOffsets = applyBrushMorphToOffsets(
        layer,
        vertices,
        pt.x,
        pt.y,
        dx,
        dy,
        brushSize,
        brushHardness
      );
      onUpdatePuppet((doc) => ({
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === layer.id ? { ...l, vertexOffsets: nextOffsets } : l
        ),
      }));
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    canvasDragRef.current.kind = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Mouse scroll wheel scales ONLY the character (non-passive native listener so preventDefault has 0 console errors)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 5 : -5;
      onUpdateEffect((eff) => ({
        ...eff,
        scale: Math.max(20, Math.min(250, Math.round(eff.scale + step))),
      }));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onUpdateEffect]);

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === 'brush_morph') {
      e.preventDefault();
      setBrushPopoverPos({
        x: Math.min(window.innerWidth - 240, e.clientX),
        y: Math.min(window.innerHeight - 170, e.clientY),
      });
    }
  };

  // Load Image or Video from Gallery
  const handleGalleryFileChange = (file: File) => {
    const isVideo = file.type.startsWith('video/');
    const objectUrl = URL.createObjectURL(file);
    const nextConfig: GalleryBackgroundConfig = {
      mediaType: isVideo ? 'video' : 'image',
      fileName: file.name,
      url: objectUrl,
      syncWithAnimation: true,
      startTimeSec: 0,
      startTimeDisplayMode: 'timecode',
      quality: 'full',
      showOnSolidLayer: false,
    };
    onUpdateEffect((eff) => ({
      ...eff,
      galleryBackground: nextConfig,
    }));
    setViewportBg('gallery');
    if (isVideo) {
      setShowVideoBgPopup(true);
      onFlashStatus(`Loaded gallery video "${file.name}". Configure Video Background settings.`);
    } else {
      setShowVideoBgPopup(false);
      onFlashStatus(`Loaded gallery image "${file.name}" as composition background.`);
    }
  };

  // Floating Panel Layout helpers
  const updatePanelLayout = useCallback(
    (id: FloatingPanelLayout['id'], patch: Partial<FloatingPanelLayout>) => {
      hasCustomPanelLayoutRef.current = true;
      setPanels((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    },
    []
  );

  const focusPanel = useCallback((id: FloatingPanelLayout['id']) => {
    topZRef.current += 1;
    const z = topZRef.current;
    setPanels((prev) => ({ ...prev, [id]: { ...prev[id], zIndex: z } }));
  }, []);

  // Tool actions
  const applyMeshDensity = (cols: number, rows: number, label: string) => {
    const safeCols = clampMeshDimension(cols, 4);
    const safeRows = clampMeshDimension(rows, 4);
    recordUndoSnapshot('mesh_density');
    onUpdatePuppet((doc) => ({
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === selectedLayerId
          ? {
              ...l,
              meshCols: safeCols,
              meshRows: safeRows,
              vertexOffsets: Array.from(
                { length: (safeCols + 1) * (safeRows + 1) },
                () => ({ dx: 0, dy: 0 })
              ),
            }
          : l
      ),
    }));
    setCustomMeshCols(String(safeCols));
    setCustomMeshRows(String(safeRows));
    onFlashStatus(`Applied ${label} (${safeCols}×${safeRows}) to selected layer.`);
  };

  // Sync custom mesh inputs whenever the user switches layers or opens Mesh Create
  useEffect(() => {
    const cur = puppet.layers.find((l) => l.id === selectedLayerId);
    if (!cur) return;
    setCustomMeshCols(String(cur.meshCols));
    setCustomMeshRows(String(cur.meshRows));
    setLinkMeshAxes(cur.meshCols === cur.meshRows);
  }, [selectedLayerId, showMeshPopover, puppet.layers]);

  // Bone Parenting handler (with cycle protection)
  const handleSetLayerParent = (childId: string, parentId: string | null) => {
    if (wouldCreateLayerParentCycle(puppet.layers, childId, parentId)) {
      onFlashStatus('Cannot parent layer: that would create a circular bone chain.');
      return;
    }
    recordUndoSnapshot('bone_parent');
    const childName = puppet.layers.find((l) => l.id === childId)?.name ?? 'Layer';
    const parentName = parentId
      ? puppet.layers.find((l) => l.id === parentId)?.name ?? 'Parent'
      : null;
    onUpdatePuppet((doc) => ({
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === childId ? { ...l, parentLayerId: parentId } : l
      ),
    }));
    onFlashStatus(
      parentName
        ? `Parented "${childName}" bone to "${parentName}".`
        : `Unparented "${childName}" bone.`
    );
  };

  const handleGroupLayersAction = () => {
    const targetIds =
      selectedLayerIds.length >= 2
        ? selectedLayerIds
        : selectedLayerId
          ? [selectedLayerId]
          : [];
    if (targetIds.length === 0) return;

    recordUndoSnapshot('group_layers');
    const groupCount =
      puppet.deformers.filter((d) => d.type === 'group').length + 1;
    const newGroupId = `def_group_${Date.now()}`;
    const sampleLayer = puppet.layers.find((l) => l.id === targetIds[0]);

    onUpdatePuppet((doc) => ({
      ...doc,
      deformers: [
        ...doc.deformers,
        {
          id: newGroupId,
          name: `Group Layer ${groupCount}`,
          type: 'group',
          parentId: sampleLayer?.parentDeformerId ?? 'def_head',
          pivotX: sampleLayer?.x ?? 512,
          pivotY: sampleLayer?.y ?? 450,
          width: sampleLayer?.width ?? 300,
          height: sampleLayer?.height ?? 300,
          baseTransform: {
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            opacity: 1,
          },
        },
      ],
      layers: doc.layers.map((l) =>
        targetIds.includes(l.id)
          ? { ...l, parentDeformerId: newGroupId, groupLayerId: newGroupId }
          : l
      ),
    }));
    setSelectedLayerIds(selectedLayerId ? [selectedLayerId] : []);
    onFlashStatus(
      `Grouped ${targetIds.length} layer(s) into "Group Layer ${groupCount}".`
    );
  };

  // PSD Layer Reorder handlers
  const handleReorderLayer = (fromId: string, toId: string) => {
    recordUndoSnapshot('reorder_layer');
    onUpdatePuppet((doc) => {
      // Visual list is descending zIndex (front first)
      const desc = [...doc.layers].sort((a, b) => b.zIndex - a.zIndex);
      const fromIdx = desc.findIndex((l) => l.id === fromId);
      const toIdx = desc.findIndex((l) => l.id === toId);
      if (fromIdx < 0 || toIdx < 0) return doc;
      const [moved] = desc.splice(fromIdx, 1);
      desc.splice(toIdx, 0, moved);
      const total = desc.length;
      const reindexed = desc.map((l, i) => ({ ...l, zIndex: total - 1 - i }));
      return { ...doc, layers: reindexed.sort((a, b) => a.zIndex - b.zIndex) };
    });
  };

  const handleMoveLayerStep = (layerId: string, dir: 'up' | 'down') => {
    const desc = [...puppet.layers].sort((a, b) => b.zIndex - a.zIndex);
    const idx = desc.findIndex((l) => l.id === layerId);
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= desc.length) return;
    handleReorderLayer(layerId, desc[targetIdx].id);
  };

  // Parameter handlers
  const handleTouchParamForConnect = (paramId: string, currentValue: number) => {
    setSelectedParamId(paramId);
    if (!stateRef.current.effect.connectToParameter) return;
    recordUndoSnapshot(`param_touch_${paramId}`);
    const frame = stateRef.current.composition.currentFrame;
    onUpdateEffect((eff) => {
      if (!eff.connectToParameter) return eff;
      return {
        ...eff,
        tracks: upsertKeyframeAtFrame(eff.tracks, paramId, frame, currentValue),
      };
    });
  };

  const handleParamChange = (paramId: string, value: number) => {
    setSelectedParamId(paramId);
    recordUndoSnapshot(`param_${paramId}`);
    const frame = stateRef.current.composition.currentFrame;
    onUpdateEffect((eff) => ({
      ...eff,
      puppet: {
        ...eff.puppet,
        parameters: eff.puppet.parameters.map((p) =>
          p.id === paramId ? { ...p, value } : p
        ),
      },
      tracks: eff.connectToParameter
        ? upsertKeyframeAtFrame(eff.tracks, paramId, frame, value)
        : eff.tracks,
    }));
  };

  const handleApplyKeyformPreset = (
    paramId: string,
    preset: '2point' | '3point' | 'clear'
  ) => {
    recordUndoSnapshot('keyform_preset');
    const layer = puppet.layers.find((l) => l.id === selectedLayerId);
    const targetId = layer?.parentDeformerId ?? 'def_head';
    onUpdatePuppet((doc) => {
      const param = doc.parameters.find((p) => p.id === paramId);
      if (!param) return doc;
      const res = applyKeyformPresetToParameter(
        param,
        doc.keyforms,
        'deformer',
        targetId,
        preset,
        preset === 'clear' ? 'parameter' : 'target'
      );
      return {
        ...doc,
        parameters: doc.parameters.map((p) =>
          p.id === paramId ? res.parameter : p
        ),
        keyforms: res.keyforms,
      };
    });
    const label =
      preset === '2point'
        ? '2 Keyforms'
        : preset === '3point'
          ? '3 Keyforms'
          : 'Cleared Keyforms';
    onFlashStatus(`${label} applied on ${paramId}.`);
  };

  // Reflect / Mirror Keyform (Live2D Time-Saver)
  const handleReflectKeyform = (
    paramId: string,
    direction: 'minToMax' | 'maxToMin'
  ) => {
    const param = puppet.parameters.find((p) => p.id === paramId);
    if (!param) return;
    recordUndoSnapshot('reflect_keyform');
    onUpdatePuppet((doc) => {
      const p = doc.parameters.find((item) => item.id === paramId);
      if (!p) return doc;
      return {
        ...doc,
        keyforms: reflectKeyformDeltas(doc.keyforms, p, direction),
      };
    });
    onFlashStatus(
      `Reflected ${param.name} keyforms (${direction === 'minToMax' ? 'L → R' : 'R → L'}).`
    );
  };

  // Facial Expression Presets & Auto-Blink
  const handleApplyExpression = (preset: ExpressionPreset) => {
    recordUndoSnapshot('apply_expression');
    const frame = stateRef.current.composition.currentFrame;
    onUpdateEffect((eff) => {
      let nextTracks = eff.tracks;
      const nextParams = eff.puppet.parameters.map((p) => {
        if (preset.values[p.id] === undefined) return p;
        const clamped = Math.max(p.min, Math.min(p.max, preset.values[p.id]));
        if (eff.connectToParameter) {
          nextTracks = upsertKeyframeAtFrame(nextTracks, p.id, frame, clamped);
        }
        return { ...p, value: clamped };
      });
      return {
        ...eff,
        puppet: { ...eff.puppet, parameters: nextParams },
        tracks: nextTracks,
      };
    });
    onFlashStatus(`Applied "${preset.name}" expression.`);
  };

  const handleSaveCustomExpression = (name: string) => {
    const values: Record<string, number> = {};
    for (const p of puppet.parameters) {
      values[p.id] = Number(p.value.toFixed(2));
    }
    const nextPreset: ExpressionPreset = {
      id: `expr_custom_${Date.now().toString(36)}`,
      name,
      values,
      builtIn: false,
    };
    setExpressions((prev) => [...prev, nextPreset]);
    onFlashStatus(`Saved custom expression "${name}".`);
  };

  const handleDeleteCustomExpression = (presetId: string) => {
    setExpressions((prev) => prev.filter((e) => e.id !== presetId));
    onFlashStatus('Deleted custom expression.');
  };

  const handleGenerateAutoBlink = () => {
    recordUndoSnapshot('auto_blink');
    const { eyeL, eyeR } = generateAutoBlinkKeyframes(
      composition.durationFrames,
      composition.fps
    );
    onUpdateEffect((eff) => ({
      ...eff,
      tracks: {
        ...eff.tracks,
        ParamEyeLOpen: {
          parameterId: 'ParamEyeLOpen',
          stopwatchEnabled: true,
          keyframes: eyeL,
        },
        ParamEyeROpen: {
          parameterId: 'ParamEyeROpen',
          stopwatchEnabled: true,
          keyframes: eyeR,
        },
      },
    }));
    onFlashStatus(
      `Generated Auto-Blink keyframes (${eyeL.length} keys on Eye L/R).`
    );
  };

  // Keyframe Easing & Curve Editor Presets
  const handleApplyKeyframeEasing = (
    selection: KeyframeSelectionItem[],
    easing: KeyframeEasing,
    bezier?: CubicBezierTuple
  ) => {
    if (selection.length === 0) return;
    recordUndoSnapshot('apply_curve');
    onUpdateEffect((eff) => ({
      ...eff,
      tracks: applyEasingToKeyframes(eff.tracks, selection, easing, bezier),
    }));
    onFlashStatus(
      `Applied ${easing === 'bezier' && bezier ? `bezier(${bezier.map((v) => v.toFixed(2)).join(', ')})` : easing} to ${selection.length} keyframe(s).`
    );
  };

  const handleToggleFavoriteCurve = (presetId: string) => {
    setCurvePresets((prev) =>
      prev.map((p) => (p.id === presetId ? { ...p, favorite: !p.favorite } : p))
    );
  };

  const handleSaveCurvePreset = (
    name: string,
    easing: KeyframeEasing,
    bezier: CubicBezierTuple
  ) => {
    const newPreset: EasingCurvePreset = {
      id: `curve_custom_${Date.now().toString(36)}`,
      name,
      easing,
      bezier: [...bezier],
      favorite: true,
      builtIn: false,
    };
    setCurvePresets((prev) => [...prev, newPreset]);
    onFlashStatus(`Saved & favorited curve preset "${name}".`);
  };

  const handleDeleteCurvePreset = (presetId: string) => {
    setCurvePresets((prev) => prev.filter((p) => p.id !== presetId));
    onFlashStatus('Deleted custom curve preset.');
  };

  // Audio Track & Auto Lip-Sync handlers
  const handleLoadDemoVoice = () => {
    const durationSec = Math.max(
      2,
      composition.durationFrames / Math.max(1, composition.fps)
    );
    const sampleRate = 22050;
    const samples = generateDemoVoiceSamples(sampleRate, durationSec);
    const peaks = computeAudioFramePeaks(
      samples,
      sampleRate,
      composition.fps,
      composition.durationFrames
    );
    const wavUrl = encodePcmToWavBlobUrl(samples, sampleRate);
    if (audioTrack?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(audioTrack.url);
    }
    setAudioTrack({
      fileName: 'Demo_Voice_Rioka.wav',
      url: wavUrl,
      durationSec,
      peaks,
      volume: 1,
      isDemo: true,
    });
    onFlashStatus(
      'Loaded Demo Voice waveform. Click "Auto Lip-Sync" to animate Mouth Open!'
    );
  };

  const handleImportAudioFile = async (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    let durationSec = Math.max(
      2,
      composition.durationFrames / Math.max(1, composition.fps)
    );
    let peaks: number[] = [];

    try {
      const arrayBuf = await file.arrayBuffer();
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      durationSec = decoded.duration || durationSec;
      const channelData = decoded.getChannelData(0);
      peaks = computeAudioFramePeaks(
        channelData,
        decoded.sampleRate,
        composition.fps,
        composition.durationFrames
      );
      await ctx.close();
    } catch {
      // Fallback waveform if browser cannot decode a custom codec
      const fallbackSamples = generateDemoVoiceSamples(22050, durationSec);
      peaks = computeAudioFramePeaks(
        fallbackSamples,
        22050,
        composition.fps,
        composition.durationFrames
      );
    }

    if (audioTrack?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(audioTrack.url);
    }
    setAudioTrack({
      fileName: file.name,
      url: objectUrl,
      durationSec,
      peaks,
      volume: 1,
      isDemo: false,
    });
    onFlashStatus(
      `Imported audio "${file.name}". Click "Auto Lip-Sync" to animate Mouth Open.`
    );
  };

  const handleGenerateLipSync = () => {
    if (!audioTrack) return;
    recordUndoSnapshot('auto_lipsync');
    const lipKfs = generateLipSyncKeyframes(audioTrack.peaks);
    const frame = composition.currentFrame;
    onUpdateEffect((eff) => {
      const nextTrack: ParameterTrack = {
        parameterId: 'ParamMouthOpenY',
        stopwatchEnabled: true,
        keyframes: lipKfs,
      };
      const valNow = evaluateTrackAtFrame(nextTrack, frame, 0);
      return {
        ...eff,
        puppet: {
          ...eff.puppet,
          parameters: eff.puppet.parameters.map((p) =>
            p.id === 'ParamMouthOpenY' ? { ...p, value: valNow } : p
          ),
        },
        tracks: {
          ...eff.tracks,
          ParamMouthOpenY: nextTrack,
        },
      };
    });
    onFlashStatus(
      `Auto Lip-Sync generated ${lipKfs.length} Mouth Open keyframes.`
    );
  };

  const handleClearAudioTrack = () => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
    }
    if (audioTrack?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(audioTrack.url);
    }
    setAudioTrack(null);
    onFlashStatus('Removed audio track.');
  };

  // Timeline Keyframe & Physics Baking handlers
  const handleAddKeyframe = (paramId: string) => {
    recordUndoSnapshot('add_kf');
    const frame = stateRef.current.composition.currentFrame;
    const param = puppet.parameters.find((p) => p.id === paramId);
    if (!param) return;
    onUpdateEffect((eff) => ({
      ...eff,
      tracks: upsertKeyframeAtFrame(eff.tracks, paramId, frame, param.value),
    }));
    onFlashStatus(`Added keyframe on ${param.name} at frame ${frame}.`);
  };

  const handleDeleteSelectedKeyframes = (selection: KeyframeSelectionItem[]) => {
    if (selection.length === 0) return;
    recordUndoSnapshot('delete_kf');
    onUpdateEffect((eff) => ({
      ...eff,
      tracks: deleteMultiKeyframes(eff.tracks, selection),
    }));
    onFlashStatus(`Deleted ${selection.length} keyframe(s).`);
  };

  const handleCopySelectedKeyframes = (
    selection: KeyframeSelectionItem[],
    cut: boolean
  ) => {
    const items = copyMultiKeyframes(effect.tracks, selection);
    if (items.length === 0) {
      const p = puppet.parameters.find((x) => x.id === selectedParamId);
      if (p) {
        setClipboard([
          { parameterId: p.id, value: p.value, easing: 'easeInOut', frameOffset: 0 },
        ]);
        onFlashStatus(`Copied current value of ${p.name}.`);
      }
      return;
    }
    setClipboard(items);
    if (cut) {
      recordUndoSnapshot('cut_kf');
      onUpdateEffect((eff) => ({
        ...eff,
        tracks: deleteMultiKeyframes(eff.tracks, selection),
      }));
    }
    onFlashStatus(
      `${cut ? 'Cut' : 'Copied'} ${items.length} keyframe(s).`
    );
  };

  const handlePasteKeyframesAtFrame = (targetFrame: number) => {
    if (clipboard.length === 0) return;
    recordUndoSnapshot('paste_kf');
    onUpdateEffect((eff) => ({
      ...eff,
      tracks: pasteKeyframesAtFrame(
        eff.tracks,
        clipboard,
        targetFrame,
        composition.durationFrames
      ),
    }));
    onFlashStatus(
      `Pasted ${clipboard.length} keyframe(s) at frame ${targetFrame}.`
    );
  };

  const handleMoveSelectedKeyframes = (
    selection: KeyframeSelectionItem[],
    deltaFrames: number
  ) => {
    if (selection.length === 0 || deltaFrames === 0) return;
    recordUndoSnapshot('move_kf');
    onUpdateEffect((eff) => ({
      ...eff,
      tracks: moveMultiKeyframes(
        eff.tracks,
        selection,
        deltaFrames,
        composition.durationFrames
      ),
    }));
  };

  // Bake Cubism Physics into Animation Timeline Keyframes (Add Physics / Update Physics)
  const bakePhysicsIntoTimeline = (mode: 'add' | 'update') => {
    const dt = 1 / Math.max(1, composition.fps);
    let sim = createInitialPhysicsState(puppet.physicsGroups);
    const bakedByParam: Record<
      string,
      Array<{ frame: number; value: number }>
    > = {};

    const stepFrames = 6; // clean sparse keyframe curve every 6 frames
    for (let f = 0; f <= composition.durationFrames; f++) {
      const paramVals: Record<string, number> = {};
      for (const p of puppet.parameters) {
        paramVals[p.id] = evaluateTrackAtFrame(effect.tracks[p.id], f, p.value);
      }
      sim = stepPhysicsSimulation(puppet.physicsGroups, sim, {
        dt,
        time: f * dt,
        paramValues: paramVals,
        windStrength: effect.windStrength,
        windTurbulence: effect.windTurbulence,
        strengthMultiplier: effect.physicsStrength,
      });

      if (f % stepFrames === 0 || f === composition.durationFrames) {
        const deltas = computePhysicsOutputDeltas(
          puppet.physicsGroups,
          sim,
          effect.physicsStrength
        );
        for (const [pId, val] of Object.entries(deltas.parameters)) {
          if (!bakedByParam[pId]) bakedByParam[pId] = [];
          const pDef = puppet.parameters.find((p) => p.id === pId);
          const clamped = pDef
            ? Math.max(pDef.min, Math.min(pDef.max, val))
            : val;
          bakedByParam[pId].push({ frame: f, value: Number(clamped.toFixed(3)) });
        }
      }
    }

    const bakedParamIds = Object.keys(bakedByParam);
    onUpdateEffect((eff) => {
      const nextTracks = { ...eff.tracks };
      for (const pId of bakedParamIds) {
        const existing = nextTracks[pId]?.keyframes ?? [];
        const manualOnly = existing.filter((k) => !k.fromPhysics);
        const physKfs = bakedByParam[pId].map((pt) => ({
          id: `kf_phys_${pId}_${pt.frame}`,
          frame: pt.frame,
          value: pt.value,
          easing: 'easeInOut' as const,
          fromPhysics: true,
        }));
        nextTracks[pId] = {
          parameterId: pId,
          stopwatchEnabled: true,
          keyframes: [...manualOnly, ...physKfs].sort((a, b) => a.frame - b.frame),
        };
      }
      return { ...eff, tracks: nextTracks };
    });

    cacheManager.registerPhysicsFrames(
      composition.durationFrames,
      puppet.physicsGroups.length
    );
    onFlashStatus(
      mode === 'add'
        ? `Baked physics curves onto ${bakedParamIds.length} parameter track(s).`
        : `Updated baked physics curves across ${composition.durationFrames} frames.`
    );
  };

  const removeBakedPhysicsKeyframes = () => {
    onUpdateEffect((eff) => {
      const nextTracks = { ...eff.tracks };
      for (const [pId, track] of Object.entries(nextTracks)) {
        const kept = track.keyframes.filter((k) => !k.fromPhysics);
        nextTracks[pId] = {
          ...track,
          stopwatchEnabled: kept.length > 0 ? track.stopwatchEnabled : false,
          keyframes: kept,
        };
      }
      return { ...eff, tracks: nextTracks };
    });
    onFlashStatus('Removed baked physics keyframes from animation timeline.');
  };

  const selectedLayer = puppet.layers.find((l) => l.id === selectedLayerId);

  const leftTools: Array<{
    id: StudioToolId;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'cursor',
      label: 'Main Cursor (Pin: Center Move · Box Scale · Blue/Ring Rotate)',
      icon: <MousePointer2 className="w-4 h-4" />,
    },
    {
      id: 'mesh_create',
      label: 'Mesh Create (Presets & Custom Grid)',
      icon: <Grid3x3 className="w-4 h-4" />,
    },
    {
      id: 'bone_create',
      label: 'Bone Tool (Circle: Move · Arrow: Rotate & Scale · Alt+Drag: Anchor)',
      icon: <Anchor className="w-4 h-4" />,
    },
    {
      id: 'group_layer',
      label: 'Group Layer',
      icon: <FolderPlus className="w-4 h-4" />,
    },
  ];

  const rightTools: Array<{
    id: StudioToolId;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'add_morph_point',
      label: 'Add Morph Point (Rest Position Only)',
      icon: <MapPinPlus className="w-4 h-4" />,
    },
    {
      id: 'brush_morph',
      label: 'Brush Morph (Right-Click Size & Hardness)',
      icon: <Brush className="w-4 h-4" />,
    },
    {
      id: 'basic_morph',
      label: 'Basic Morphing (Adjustable Grid Box)',
      icon: <Grid2x2 className="w-4 h-4" />,
    },
  ];

  const handleSelectTool = (toolId: StudioToolId) => {
    if (toolId === 'group_layer') {
      handleGroupLayersAction();
      return;
    }
    setActiveTool(toolId);
    setShowMeshPopover(toolId === 'mesh_create' ? !showMeshPopover : false);
    if (toolId === 'brush_morph' && activeTool === 'brush_morph') {
      setBrushPopoverPos((prev) => (prev ? null : { x: 740, y: 102 }));
    } else {
      setBrushPopoverPos(null);
    }
  };

  return (
    <div
      data-testid="plugin-window-root"
      className="h-screen w-screen flex flex-col overflow-hidden bg-[#1D1D1D] text-[#E6E6E6]"
    >
      {/* TOP TITLE BAR (Matching 1.png in After Effects dark charcoal) */}
      <header className="h-9 shrink-0 px-3 bg-[#232323] border-b border-[#3A3A3A] grid grid-cols-3 items-center select-none z-50">
        <div className="flex items-center gap-2 text-[11px] text-[#9E9E9E] min-w-0">
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={handleUndo}
              disabled={historyCounts.past === 0}
              aria-label="Undo"
              title={`Undo (Ctrl+Z)${historyCounts.past > 0 ? ` — ${historyCounts.past} step(s)` : ''}`}
              className="p-1 rounded bg-[#2D2D2D] hover:bg-[#3A3A3A] disabled:opacity-35 text-[#E2E2E2] border border-[#3F3F3F] transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={historyCounts.future === 0}
              aria-label="Redo"
              title={`Redo (Ctrl+Shift+Z)${historyCounts.future > 0 ? ` — ${historyCounts.future} step(s)` : ''}`}
              className="p-1 rounded bg-[#2D2D2D] hover:bg-[#3A3A3A] disabled:opacity-35 text-[#E2E2E2] border border-[#3F3F3F] transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <Layers className="w-3.5 h-3.5 text-[#2D8CEB] shrink-0" />
          <span className="truncate font-mono text-[10px]">
            {selectedLayer ? selectedLayer.name : 'No Layer'} ·{' '}
            {activeTool.replace(/_/g, ' ')}
          </span>
        </div>

        <h1 className="text-center text-[13px] font-semibold tracking-tight text-[#F0F0F0] whitespace-nowrap">
          Rioka Puppeting Tools
        </h1>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={effect.autoBreath}
            aria-label="Automatic Breathing"
            data-testid="toggle-auto-breath"
            onClick={() => {
              const next = !effect.autoBreath;
              onUpdateEffect((eff) => ({ ...eff, autoBreath: next }));
              onFlashStatus(
                next
                  ? 'Automatic Breathing turned ON.'
                  : 'Automatic Breathing turned OFF.'
              );
            }}
            title="Turn Automatic Breathing ON or OFF (applies in Studio & After Effects)"
            className={`px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              effect.autoBreath
                ? 'bg-[#2D8CEB]/22 border-[#2D8CEB] text-[#E0F2FE]'
                : 'bg-[#2B2B2B] border-[#424242] text-[#A8A8A8] hover:text-white hover:bg-[#343434]'
            }`}
          >
            <Wind
              className={`w-3 h-3 ${
                effect.autoBreath ? 'text-[#38BDF8]' : 'text-[#787878]'
              }`}
            />
            <span>Auto-Breath</span>
            <span
              className={`font-mono text-[9.5px] px-1 py-0.25 rounded ${
                effect.autoBreath
                  ? 'bg-[#2D8CEB] text-white'
                  : 'bg-[#3A3A3A] text-[#B0B0B0]'
              }`}
            >
              {effect.autoBreath ? 'ON' : 'OFF'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigateView('ae_sdk')}
            className="px-2.5 py-1 rounded text-[11px] font-medium text-[#BFBFBF] hover:text-white hover:bg-[#343434] transition-colors whitespace-nowrap"
          >
            AE SDK
          </button>
        </div>
      </header>

      {/* FULL-VIEWPORT COMPOSITION WINDOW CANVAS + FLOATING DOCK & PANELS */}
      <div className="relative flex-1 min-h-0 overflow-hidden bg-[#0A0A0A]">
        {/* Hidden Gallery Media Input & Video Element */}
        <input
          ref={galleryFileInputRef}
          type="file"
          accept="image/*,video/*"
          aria-label="Import gallery background image or video"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleGalleryFileChange(file);
            e.target.value = '';
          }}
        />
        <video
          ref={galleryVideoRef}
          muted
          loop
          playsInline
          className="hidden"
        />
        <audio ref={audioElRef} className="hidden" />

        <canvas
          ref={canvasRef}
          data-testid="plugin-viewport-canvas"
          data-viewport-bg={viewportBg}
          data-auto-breath={effect.autoBreath ? 'true' : 'false'}
          data-param-count={puppet.parameters.length}
          data-current-frame={composition.currentFrame}
          data-head-angle-x={(
            puppet.parameters.find((p) => p.id === 'ParamAngleX')?.value ?? 0
          ).toFixed(2)}
          data-bone-transform={
            selectedLayer
              ? `${selectedLayer.boneTransform.dx.toFixed(1)},${selectedLayer.boneTransform.dy.toFixed(1)},${selectedLayer.boneTransform.rotation.toFixed(1)},${selectedLayer.boneTransform.scaleX.toFixed(2)}`
              : ''
          }
          data-morph-pins={
            selectedLayer && selectedLayer.morphPins.length > 0
              ? selectedLayer.morphPins
                  .map(
                    (p) =>
                      `${p.dx.toFixed(1)},${p.dy.toFixed(1)},${(p.rotation ?? 0).toFixed(1)},${(p.scale ?? 1).toFixed(2)}`
                  )
                  .join('|')
              : ''
          }
          data-char-offset={`${effect.offsetX},${effect.offsetY}`}
          data-char-scale={effect.scale}
          data-char-rotation={effect.rotation}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onDoubleClick={(e) => {
            if (!selectedLayer) return;
            const pt = clientToModel(e.clientX, e.clientY);
            const { rig, deformersById, layersById } = evaluateCurrentRig();

            if (activeTool === 'cursor' && selectedLayer.morphPins.length > 0) {
              const halfW = selectedLayer.width * 0.5;
              const halfH = selectedLayer.height * 0.5;
              const hitR = 13 / Math.max(0.05, viewportTransformRef.current.scale);
              for (const pin of selectedLayer.morphPins) {
                const pw = transformLayerPointToModel(
                  {
                    x: selectedLayer.x - halfW + pin.restU * selectedLayer.width + pin.dx,
                    y: selectedLayer.y - halfH + pin.restV * selectedLayer.height + pin.dy,
                  },
                  selectedLayer,
                  deformersById,
                  rig,
                  layersById
                );
                if (Math.hypot(pw.x - pt.x, pw.y - pt.y) <= hitR) {
                  recordUndoSnapshot('morph_pin_reset');
                  onUpdatePuppet((doc) => ({
                    ...doc,
                    layers: doc.layers.map((l) =>
                      l.id === selectedLayer.id
                        ? {
                            ...l,
                            morphPins: l.morphPins.map((p) =>
                              p.id === pin.id
                                ? { ...p, dx: 0, dy: 0, rotation: 0, scale: 1 }
                                : p
                            ),
                          }
                        : l
                    ),
                  }));
                  onFlashStatus(
                    `Reset pin to fixed anchor on "${selectedLayer.name}".`
                  );
                  return;
                }
              }
              return;
            }

            if (activeTool !== 'bone_create') return;
            const pivotLocal = {
              x:
                selectedLayer.x -
                selectedLayer.width * 0.5 +
                selectedLayer.width * selectedLayer.pivotX,
              y:
                selectedLayer.y -
                selectedLayer.height * 0.5 +
                selectedLayer.height * selectedLayer.pivotY,
            };
            const pivotW = transformLayerPointToModel(
              pivotLocal,
              selectedLayer,
              deformersById,
              rig,
              layersById
            );
            const baseRot = getLayerNonBoneWorldRotationDeg(
              selectedLayer,
              deformersById,
              rig,
              layersById
            );
            const geom = computeBoneGizmoGeometry(
              pivotW,
              selectedLayer.boneTransform.rotation,
              selectedLayer.boneTransform.scaleX,
              baseRot
            );
            if (
              hitTestBoneGizmo(pt, geom, viewportTransformRef.current.scale) ===
              'circle'
            ) {
              recordUndoSnapshot('bone_reset');
              onUpdatePuppet((doc) => ({
                ...doc,
                layers: doc.layers.map((l) =>
                  l.id === selectedLayer.id
                    ? {
                        ...l,
                        boneTransform: {
                          dx: 0,
                          dy: 0,
                          rotation: 0,
                          scaleX: 1,
                          scaleY: 1,
                        },
                      }
                    : l
                ),
              }));
              onFlashStatus(`Reset bone transform on "${selectedLayer.name}".`);
            }
          }}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          onAuxClick={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          onPointerLeave={() => {
            brushCursorRef.current.visible = false;
          }}
          onContextMenu={handleCanvasContextMenu}
          title={
            activeTool === 'bone_create'
              ? 'Drag Circle: Move · Drag Arrow: Rotate & Scale · Alt+Drag: Move Anchor · Double-Click Circle: Reset'
              : activeTool === 'cursor' && selectedLayer && selectedLayer.morphPins.length > 0
                ? 'Green Dot: Move · Hollow Box: Scale · Blue Square/Ring: Rotate · Middle-Drag: Move Character'
                : 'Middle-Drag or Shift + Left-Drag: Move Character · Alt + Left-Drag: Rotate · Scroll: Scale'
          }
          className={`w-full h-full block ${
            activeTool === 'brush_morph' || activeTool === 'add_morph_point'
              ? 'cursor-crosshair'
              : activeTool === 'bone_create'
                ? 'cursor-move'
                : 'cursor-default'
          }`}
        />

        {/* TOP-CENTER 7-TOOL FLOATING DOCK (Exact 4 + gap + 3 grouping from 1.png & 2.png) */}
        <div
          role="toolbar"
          aria-label="Rioka Main Tools"
          className="fixed left-1/2 -translate-x-1/2 top-[44px] z-[60] flex items-center gap-5 px-3 py-1.5 rounded-[8px] bg-[#242424]/95 border border-[#464646] shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
        >
          <div className="flex items-center gap-1.5">
            {leftTools.map((t) => {
              const isAct = activeTool === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelectTool(t.id)}
                  aria-label={t.label}
                  aria-pressed={isAct}
                  title={t.label}
                  className={`w-9 h-7 rounded-[5px] border flex items-center justify-center transition-colors ${
                    isAct
                      ? 'bg-[#2D8CEB] border-[#5AA7F6] text-white'
                      : 'bg-[#2E2E2E] border-[#484848] text-[#D8D8D8] hover:bg-[#3A3A3A] hover:text-white'
                  }`}
                >
                  {t.icon}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            {rightTools.map((t) => {
              const isAct = activeTool === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelectTool(t.id)}
                  aria-label={t.label}
                  aria-pressed={isAct}
                  title={t.label}
                  className={`w-9 h-7 rounded-[5px] border flex items-center justify-center transition-colors ${
                    isAct
                      ? 'bg-[#2D8CEB] border-[#5AA7F6] text-white'
                      : 'bg-[#2E2E2E] border-[#484848] text-[#D8D8D8] hover:bg-[#3A3A3A] hover:text-white'
                  }`}
                >
                  {t.icon}
                </button>
              );
            })}
          </div>
        </div>

        {/* MESH CREATE POPOVER (Presets + Custom Mesh Subdivision) */}
        {showMeshPopover && selectedLayer && (() => {
          const parsedCols = clampMeshDimension(customMeshCols, selectedLayer.meshCols);
          const parsedRows = clampMeshDimension(customMeshRows, selectedLayer.meshRows);
          const vertCount = (parsedCols + 1) * (parsedRows + 1);
          const triCount = parsedCols * parsedRows * 2;
          const isPreset = (c: number, r: number) =>
            selectedLayer.meshCols === c && selectedLayer.meshRows === r;

          const commitCustomMesh = (cVal: number, rVal: number) => {
            applyMeshDensity(cVal, rVal, 'Custom Mesh');
          };

          return (
            <div
              data-testid="mesh-create-popover"
              className="fixed left-1/2 -translate-x-1/2 top-[92px] z-[75] w-[294px] p-3 rounded-[6px] bg-[#222222]/98 border border-[#454545] shadow-2xl space-y-2.5 text-[11px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#F0F0F0] truncate">
                  Mesh Create — {selectedLayer.name}
                </span>
                <span
                  data-testid="mesh-density-badge"
                  className="font-mono text-[10.5px] text-[#2D8CEB] shrink-0"
                >
                  {selectedLayer.meshCols}×{selectedLayer.meshRows}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => applyMeshDensity(2, 2, 'Small Mesh')}
                  className={`py-1.5 px-2 rounded border font-medium transition-colors ${
                    isPreset(2, 2)
                      ? 'bg-[#2D8CEB]/22 border-[#2D8CEB] text-white'
                      : 'bg-[#303030] hover:bg-[#2D8CEB] border-[#454545] text-[#ECECEC]'
                  }`}
                >
                  Small Mesh
                  <span className="block text-[9px] opacity-75 font-mono">2×2</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyMeshDensity(4, 4, 'Basic Mesh')}
                  className={`py-1.5 px-2 rounded border font-medium transition-colors ${
                    isPreset(4, 4)
                      ? 'bg-[#2D8CEB]/22 border-[#2D8CEB] text-white'
                      : 'bg-[#303030] hover:bg-[#2D8CEB] border-[#454545] text-[#ECECEC]'
                  }`}
                >
                  Basic
                  <span className="block text-[9px] opacity-75 font-mono">4×4</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyMeshDensity(6, 6, 'Detailed Mesh')}
                  className={`py-1.5 px-2 rounded border font-medium transition-colors ${
                    isPreset(6, 6)
                      ? 'bg-[#2D8CEB]/22 border-[#2D8CEB] text-white'
                      : 'bg-[#303030] hover:bg-[#2D8CEB] border-[#454545] text-[#ECECEC]'
                  }`}
                >
                  Detailed Mesh
                  <span className="block text-[9px] opacity-75 font-mono">6×6</span>
                </button>
              </div>

              <div className="pt-2 border-t border-[#363636] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-medium text-[#BDBDBD]">
                    Custom Grid ({MESH_MIN_SUBDIV}–{MESH_MAX_SUBDIV})
                  </span>
                  <button
                    type="button"
                    aria-pressed={linkMeshAxes}
                    aria-label={linkMeshAxes ? 'Unlink columns and rows' : 'Link columns and rows'}
                    title={linkMeshAxes ? 'Linked (Square Grid) — Click to unlock independent X/Y' : 'Independent X/Y — Click to link square grid'}
                    onClick={() => setLinkMeshAxes((prev) => !prev)}
                    className={`px-1.5 py-0.5 rounded border text-[10px] flex items-center gap-1 transition-colors ${
                      linkMeshAxes
                        ? 'bg-[#2D8CEB]/20 border-[#2D8CEB]/70 text-[#93C5FD]'
                        : 'bg-[#2B2B2B] border-[#444444] text-[#9E9E9E] hover:text-white'
                    }`}
                  >
                    {linkMeshAxes ? (
                      <Link2 className="w-3 h-3" />
                    ) : (
                      <Unlink2 className="w-3 h-3" />
                    )}
                    <span>{linkMeshAxes ? 'Linked' : 'Free'}</span>
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="custom-mesh-cols"
                      className="w-11 text-[10px] text-[#A8A8A8] shrink-0"
                    >
                      Cols (X)
                    </label>
                    <input
                      type="range"
                      aria-label="Custom mesh columns slider"
                      min={MESH_MIN_SUBDIV}
                      max={MESH_MAX_SUBDIV}
                      value={parsedCols}
                      onChange={(e) => {
                        const nextC = clampMeshDimension(e.target.value, parsedCols);
                        const nextR = linkMeshAxes ? nextC : parsedRows;
                        setCustomMeshCols(String(nextC));
                        if (linkMeshAxes) setCustomMeshRows(String(nextR));
                        commitCustomMesh(nextC, nextR);
                      }}
                      className="flex-1 accent-[#2D8CEB] h-1.5 cursor-pointer"
                    />
                    <input
                      id="custom-mesh-cols"
                      data-testid="custom-mesh-cols-input"
                      type="number"
                      min={MESH_MIN_SUBDIV}
                      max={MESH_MAX_SUBDIV}
                      value={customMeshCols}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomMeshCols(val);
                        if (linkMeshAxes) setCustomMeshRows(val);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const c = clampMeshDimension(customMeshCols, selectedLayer.meshCols);
                          const r = linkMeshAxes
                            ? c
                            : clampMeshDimension(customMeshRows, selectedLayer.meshRows);
                          commitCustomMesh(c, r);
                        }
                      }}
                      className="w-12 px-1.5 py-0.5 rounded bg-[#181818] border border-[#444444] focus:border-[#2D8CEB] focus:outline-none text-right font-mono text-[11px] text-[#F0F0F0]"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="custom-mesh-rows"
                      className="w-11 text-[10px] text-[#A8A8A8] shrink-0"
                    >
                      Rows (Y)
                    </label>
                    <input
                      type="range"
                      aria-label="Custom mesh rows slider"
                      min={MESH_MIN_SUBDIV}
                      max={MESH_MAX_SUBDIV}
                      value={parsedRows}
                      onChange={(e) => {
                        const nextR = clampMeshDimension(e.target.value, parsedRows);
                        const nextC = linkMeshAxes ? nextR : parsedCols;
                        setCustomMeshRows(String(nextR));
                        if (linkMeshAxes) setCustomMeshCols(String(nextC));
                        commitCustomMesh(nextC, nextR);
                      }}
                      className="flex-1 accent-[#2D8CEB] h-1.5 cursor-pointer"
                    />
                    <input
                      id="custom-mesh-rows"
                      data-testid="custom-mesh-rows-input"
                      type="number"
                      min={MESH_MIN_SUBDIV}
                      max={MESH_MAX_SUBDIV}
                      value={customMeshRows}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomMeshRows(val);
                        if (linkMeshAxes) setCustomMeshCols(val);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const r = clampMeshDimension(customMeshRows, selectedLayer.meshRows);
                          const c = linkMeshAxes
                            ? r
                            : clampMeshDimension(customMeshCols, selectedLayer.meshCols);
                          commitCustomMesh(c, r);
                        }
                      }}
                      className="w-12 px-1.5 py-0.5 rounded bg-[#181818] border border-[#444444] focus:border-[#2D8CEB] focus:outline-none text-right font-mono text-[11px] text-[#F0F0F0]"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-0.5">
                  <span className="font-mono text-[9.5px] text-[#8E8E8E]">
                    {vertCount} verts · {triCount} tris
                  </span>
                  <button
                    type="button"
                    data-testid="apply-custom-mesh-btn"
                    onClick={() => {
                      const c = clampMeshDimension(customMeshCols, selectedLayer.meshCols);
                      const r = clampMeshDimension(customMeshRows, selectedLayer.meshRows);
                      commitCustomMesh(c, r);
                    }}
                    className="px-2.5 py-1 rounded bg-[#2D8CEB] hover:bg-[#3B9BF8] text-white text-[10.5px] font-medium transition-colors"
                  >
                    Apply Mesh
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* BASIC MORPHING & ADD MORPH POINT COMPACT CONTEXT BAR */}
        {activeTool === 'basic_morph' && selectedLayer && (
          <div className="fixed left-1/2 -translate-x-1/2 top-[92px] z-[70] px-3 py-1.5 rounded-[6px] bg-[#222222]/95 border border-[#454545] flex items-center gap-3 text-[11px] shadow-lg">
            <span className="text-[#CCCCCC]">
              Drag grid box handles on <strong className="text-white">{selectedLayer.name}</strong>
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdatePuppet((doc) => ({
                  ...doc,
                  layers: doc.layers.map((l) =>
                    l.id === selectedLayer.id
                      ? { ...l, basicLattice: createDefaultBasicLattice(3, 3) }
                      : l
                  ),
                }))
              }
              className="px-2 py-0.5 rounded bg-[#333333] hover:bg-[#444444] text-[#ECECEC] text-[10px]"
            >
              Reset Grid
            </button>
          </div>
        )}

        {activeTool === 'add_morph_point' && selectedLayer && (
          <div className="fixed left-1/2 -translate-x-1/2 top-[92px] z-[70] px-3 py-1.5 rounded-[6px] bg-[#222222]/95 border border-[#454545] flex items-center gap-3 text-[11px] shadow-lg">
            <span className="text-[#CCCCCC]">
              Click layer to add rest pin ({selectedLayer.morphPins.length} pins). Switch to Main Cursor to Move, Rotate &amp; Scale.
            </span>
            {selectedLayer.morphPins.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  recordUndoSnapshot('clear_morph_pins');
                  onUpdatePuppet((doc) => ({
                    ...doc,
                    layers: doc.layers.map((l) =>
                      l.id === selectedLayer.id ? { ...l, morphPins: [] } : l
                    ),
                  }));
                  setSelectedPinId(null);
                }}
                className="px-2 py-0.5 rounded bg-[#4A2525] hover:bg-[#662D2D] text-[#FECACA] text-[10px]"
              >
                Clear Pins
              </button>
            )}
          </div>
        )}

        {activeTool === 'cursor' &&
          selectedLayer &&
          selectedLayer.morphPins.length > 0 && (() => {
            const activePin =
              selectedLayer.morphPins.find((p) => p.id === selectedPinId) ??
              selectedLayer.morphPins[selectedLayer.morphPins.length - 1];
            const activeIdx =
              selectedLayer.morphPins.findIndex((p) => p.id === activePin.id) + 1;
            const moved = isMorphPinMoved(activePin);
            return (
              <div
                data-testid="morph-pin-context-bar"
                className="fixed left-1/2 -translate-x-1/2 top-[92px] z-[70] px-3 py-1.5 rounded-[6px] bg-[#222222]/95 border border-[#454545] flex items-center gap-2.5 text-[11px] shadow-lg whitespace-nowrap"
              >
                <span className="text-[#D4D4D4] font-medium">
                  Pin {activeIdx}/{selectedLayer.morphPins.length}
                </span>
                <span className="font-mono text-[10px] text-[#75DC6B]">
                  {moved
                    ? `Pos ${Math.round(activePin.dx)},${Math.round(activePin.dy)} · ${(activePin.rotation ?? 0).toFixed(0)}° · ${Math.round((activePin.scale ?? 1) * 100)}%`
                    : 'Anchor (Fixed)'}
                </span>
                <span className="text-[10px] text-[#8E8E8E] hidden xl:inline">
                  Dot: Move · Box: Scale · Blue/Ring: Rotate
                </span>
                <button
                  type="button"
                  onClick={() => {
                    recordUndoSnapshot('morph_pin_reset');
                    onUpdatePuppet((doc) => ({
                      ...doc,
                      layers: doc.layers.map((l) =>
                        l.id === selectedLayer.id
                          ? {
                              ...l,
                              morphPins: l.morphPins.map((p) =>
                                p.id === activePin.id
                                  ? { ...p, dx: 0, dy: 0, rotation: 0, scale: 1 }
                                  : p
                              ),
                            }
                          : l
                      ),
                    }));
                  }}
                  className="px-2 py-0.5 rounded bg-[#333333] hover:bg-[#444444] text-[#ECECEC] text-[10px]"
                >
                  Reset Pin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    recordUndoSnapshot('delete_morph_pin');
                    const remaining = selectedLayer.morphPins.filter(
                      (p) => p.id !== activePin.id
                    );
                    onUpdatePuppet((doc) => ({
                      ...doc,
                      layers: doc.layers.map((l) =>
                        l.id === selectedLayer.id
                          ? { ...l, morphPins: remaining }
                          : l
                      ),
                    }));
                    setSelectedPinId(remaining[remaining.length - 1]?.id ?? null);
                  }}
                  className="px-2 py-0.5 rounded bg-[#4A2525] hover:bg-[#662D2D] text-[#FECACA] text-[10px]"
                >
                  Delete Pin
                </button>
              </div>
            );
          })()}

        {/* BRUSH MORPH RIGHT-CLICK POPOVER (Size & Hardness) */}
        {brushPopoverPos && (
          <div
            data-testid="brush-morph-popover"
            style={{ left: `${brushPopoverPos.x}px`, top: `${brushPopoverPos.y}px` }}
            className="fixed z-[85] w-[220px] p-3 rounded-[6px] bg-[#202020]/98 border border-[#4A4A4A] shadow-2xl space-y-2.5 text-[11px]"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#F0F0F0]">
                Brush Morph Settings
              </span>
              <button
                type="button"
                onClick={() => setBrushPopoverPos(null)}
                className="text-[10px] text-[#9A9A9A] hover:text-white"
              >
                Done
              </button>
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-[#A8A8A8]">
                <span>Brush Size</span>
                <span className="font-mono text-[#ECECEC]">{brushSize}px</span>
              </div>
              <input
                type="range"
                aria-label="Brush size"
                min={20}
                max={180}
                step={2}
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
                className="w-full studio-slider"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-[#A8A8A8]">
                <span>Brush Hardness</span>
                <span className="font-mono text-[#ECECEC]">
                  {Math.round(brushHardness * 100)}%
                </span>
              </div>
              <input
                type="range"
                aria-label="Brush hardness"
                min={0.1}
                max={1}
                step={0.05}
                value={brushHardness}
                onChange={(e) => setBrushHardness(parseFloat(e.target.value))}
                className="w-full studio-slider"
              />
            </div>
          </div>
        )}

        {/* TOP-RIGHT CHANGE BACKGROUND BUTTON + GALLERY VIDEO SETTINGS (Matching 1.png) */}
        <div className="fixed right-3 top-[46px] z-[65] flex items-center gap-1.5">
          {effect.galleryBackground?.mediaType === 'video' && (
            <button
              type="button"
              onClick={() => setShowVideoBgPopup((v) => !v)}
              aria-pressed={showVideoBgPopup}
              className={`px-2 py-1.5 rounded-[5px] border text-[11px] font-medium transition-colors whitespace-nowrap shadow-md ${
                showVideoBgPopup
                  ? 'bg-[#2D8CEB] border-[#5AA7F6] text-white'
                  : 'bg-[#242424]/95 hover:bg-[#323232] border-[#444444] text-[#D8D8D8]'
              }`}
            >
              Video Settings
            </button>
          )}
          {effect.galleryBackground?.mediaType === 'image' && (
            <label
              title="Composite this gallery image directly onto the After Effects Solid Layer"
              className="px-2 py-1.5 rounded-[5px] bg-[#242424]/95 border border-[#444444] text-[10px] text-[#D8D8D8] flex items-center gap-1.5 cursor-pointer shadow-md whitespace-nowrap"
            >
              <input
                type="checkbox"
                checked={effect.galleryBackground.showOnSolidLayer}
                onChange={(e) =>
                  onUpdateEffect((eff) => ({
                    ...eff,
                    galleryBackground: eff.galleryBackground
                      ? {
                          ...eff.galleryBackground,
                          showOnSolidLayer: e.target.checked,
                        }
                      : null,
                  }))
                }
                className="accent-[#2D8CEB]"
              />
              Show on Solid Layer
            </label>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowBgMenu((v) => !v)}
              className="px-2.5 py-1.5 rounded-[5px] bg-[#242424]/95 hover:bg-[#323232] border border-[#444444] text-[11px] font-medium text-[#E8E8E8] flex items-center gap-1.5 shadow-md transition-colors whitespace-nowrap"
            >
              <ImageIcon className="w-3.5 h-3.5 text-[#2D8CEB]" />
              Change Background
            </button>

            {showBgMenu && (
              <div
                role="menu"
                aria-label="Viewport backgrounds"
                className="absolute right-0 mt-1.5 w-[228px] p-1 rounded-[6px] bg-[#222222] border border-[#454545] shadow-2xl space-y-0.5 text-[11px]"
              >
                {BACKGROUNDS.map((bg) => (
                  <button
                    key={bg.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowBgMenu(false);
                      if (bg.id === 'gallery') {
                        galleryFileInputRef.current?.click();
                      } else {
                        setViewportBg(bg.id);
                        onFlashStatus(`Background set to "${bg.label}".`);
                      }
                    }}
                    className={`w-full px-2.5 py-1.5 rounded text-left whitespace-nowrap transition-colors ${
                      viewportBg === bg.id
                        ? 'bg-[#2D8CEB] text-white font-medium'
                        : 'text-[#DCDCDC] hover:bg-[#333333]'
                    }`}
                  >
                    {bg.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* VIDEO BACKGROUND POPUP TAB (Opens when Gallery Video is loaded) */}
        {showVideoBgPopup &&
          effect.galleryBackground &&
          effect.galleryBackground.mediaType === 'video' && (
            <VideoBgPopup
              config={effect.galleryBackground}
              fps={composition.fps}
              onUpdate={(patch) =>
                onUpdateEffect((eff) => ({
                  ...eff,
                  galleryBackground: eff.galleryBackground
                    ? { ...eff.galleryBackground, ...patch }
                    : null,
                }))
              }
              onClose={() => setShowVideoBgPopup(false)}
            />
          )}

        {/* 4 DRAGGABLE, RESIZABLE, MINIMIZABLE FLOATING PANELS (Matching 3.png) */}
        <FloatingPanel
          layout={panels.psd}
          title="PSD File"
          minWidth={200}
          minHeight={220}
          onUpdateLayout={updatePanelLayout}
          onFocus={focusPanel}
        >
          <PsdPanelContent
            puppet={puppet}
            selectedLayerId={selectedLayerId}
            selectedLayerIds={selectedLayerIds}
            thumbnailSize={thumbnailSize}
            onChangeThumbnailSize={(size) => {
              setThumbnailSize(size);
              onFlashStatus(`PSD Thumbnail size set to "${size}".`);
            }}
            onSelectLayers={(primaryId, ids) => {
              setSelectedLayerId(primaryId);
              setSelectedLayerIds(ids);
            }}
            onToggleLayerVisibility={(id) =>
              onUpdatePuppet((doc) => ({
                ...doc,
                layers: doc.layers.map((l) =>
                  l.id === id ? { ...l, visible: !l.visible } : l
                ),
              }))
            }
            onReorderLayer={handleReorderLayer}
            onMoveLayerStep={handleMoveLayerStep}
            onSetLayerParent={handleSetLayerParent}
            onImportNewPsdFile={onImportNewPsdFile}
            onRenewPsdFile={onRenewPsdFile}
            onSimulatePsdUpdate={onSimulatePsdUpdate}
            onGroupSelectedLayers={handleGroupLayersAction}
          />
        </FloatingPanel>

        <FloatingPanel
          layout={panels.parameter}
          title="Parameter"
          minWidth={240}
          minHeight={260}
          onUpdateLayout={updatePanelLayout}
          onFocus={focusPanel}
        >
          <ParameterPanelContent
            puppet={puppet}
            selectedParamId={selectedParamId}
            selectedLayerId={selectedLayerId}
            physicsParamOffsets={livePhysicsParamOffsets}
            showLinkedPad={showLinkedPad}
            expressions={expressions}
            onToggleLinkedPad={() => setShowLinkedPad((v) => !v)}
            onSelectParam={setSelectedParamId}
            onChangeParamValue={handleParamChange}
            onTouchParamForConnect={handleTouchParamForConnect}
            onApplyKeyformPreset={handleApplyKeyformPreset}
            onReflectKeyform={handleReflectKeyform}
            onApplyExpression={handleApplyExpression}
            onSaveCustomExpression={handleSaveCustomExpression}
            onDeleteCustomExpression={handleDeleteCustomExpression}
            onGenerateAutoBlink={handleGenerateAutoBlink}
            onAddKeyformPoint={(paramId, val) => {
              recordUndoSnapshot('add_keyform_point');
              const layer = puppet.layers.find((l) => l.id === selectedLayerId);
              const targetId = layer?.parentDeformerId ?? 'def_head';
              onUpdatePuppet((doc) => {
                const param = doc.parameters.find((p) => p.id === paramId);
                if (!param) return doc;
                const res = addKeyformPointToParameter(
                  param,
                  doc.keyforms,
                  'deformer',
                  targetId,
                  val
                );
                return {
                  ...doc,
                  parameters: doc.parameters.map((p) =>
                    p.id === paramId ? res.parameter : p
                  ),
                  keyforms: res.keyforms,
                };
              });
              onFlashStatus(`Added keyform point @ ${val.toFixed(1)} on ${paramId}.`);
            }}
            onDeleteKeyformPoint={(paramId, val) => {
              recordUndoSnapshot('delete_keyform_point');
              const layer = puppet.layers.find((l) => l.id === selectedLayerId);
              onUpdatePuppet((doc) => {
                const param = doc.parameters.find((p) => p.id === paramId);
                if (!param) return doc;
                const res = deleteKeyformPointFromParameter(
                  param,
                  doc.keyforms,
                  layer,
                  val,
                  'parameter'
                );
                return {
                  ...doc,
                  parameters: doc.parameters.map((p) =>
                    p.id === paramId ? res.parameter : p
                  ),
                  keyforms: res.keyforms,
                };
              });
              onFlashStatus(`Deleted keyform point @ ${val.toFixed(1)} on ${paramId}.`);
            }}
            onSwapKeyformPoints={(paramId, a, b) => {
              onUpdatePuppet((doc) => ({
                ...doc,
                keyforms: swapKeyformPoints(doc.keyforms, paramId, a, b),
              }));
              onFlashStatus(`Swapped keyform points ${a} ↔ ${b}.`);
            }}
            onResetKeyformPoint={(paramId, val) => {
              onUpdatePuppet((doc) => ({
                ...doc,
                keyforms: resetKeyformPoint(doc.keyforms, paramId, val),
              }));
              onFlashStatus(`Reset keyform point ${val} to neutral.`);
            }}
            onUpdateParameterMeta={(paramId, patch) => {
              onUpdatePuppet((doc) => ({
                ...doc,
                parameters: doc.parameters.map((p) =>
                  p.id === paramId ? { ...p, ...patch } : p
                ),
              }));
            }}
            onDeleteParameter={(paramId) => {
              recordUndoSnapshot('delete_parameter');
              onUpdateEffect((eff) => {
                const nextTracks = { ...eff.tracks };
                delete nextTracks[paramId];
                return {
                  ...eff,
                  tracks: nextTracks,
                  puppet: {
                    ...eff.puppet,
                    parameters: eff.puppet.parameters.filter(
                      (p) => p.id !== paramId
                    ),
                    keyforms: eff.puppet.keyforms.filter(
                      (k) => k.parameterId !== paramId
                    ),
                  },
                };
              });
            }}
            onAddParameter={() => {
              const idx = puppet.parameters.length + 1;
              const newParam: RigParameter = {
                id: `ParamCustom_${Date.now().toString(36)}`,
                name: `Custom Param ${idx}`,
                group: 'Custom',
                folderId: null,
                min: -1,
                max: 1,
                defaultValue: 0,
                value: 0,
                keyforms: [],
              };
              onUpdateEffect((eff) => ({
                ...eff,
                puppet: {
                  ...eff.puppet,
                  parameters: [...eff.puppet.parameters, newParam],
                },
                tracks: {
                  ...eff.tracks,
                  [newParam.id]: {
                    parameterId: newParam.id,
                    stopwatchEnabled: false,
                    keyframes: [],
                  },
                },
              }));
              setSelectedParamId(newParam.id);
              onFlashStatus(`Added "${newParam.name}".`);
            }}
            onAddFolder={() => {
              const count = puppet.parameterFolders.length + 1;
              onUpdatePuppet((doc) => ({
                ...doc,
                parameterFolders: [
                  ...doc.parameterFolders,
                  {
                    id: `folder_${Date.now()}`,
                    name: `Folder ${count}`,
                    color: '#22C55E',
                    collapsed: false,
                  },
                ],
              }));
            }}
            onToggleFolderCollapse={(folderId) => {
              onUpdatePuppet((doc) => ({
                ...doc,
                parameterFolders: doc.parameterFolders.map((f) =>
                  f.id === folderId ? { ...f, collapsed: !f.collapsed } : f
                ),
              }));
            }}
            onChangeFolderColor={(folderId, color) => {
              onUpdatePuppet((doc) => ({
                ...doc,
                parameterFolders: doc.parameterFolders.map((f) =>
                  f.id === folderId ? { ...f, color } : f
                ),
              }));
            }}
          />
        </FloatingPanel>

        {/* FLOATING 2D LINKED BLEND PAD (Opened from Parameter tab) */}
        {showLinkedPad && (
          <LinkedBlendPad
            parameters={puppet.parameters}
            paramXId={linkedParamXId}
            paramYId={linkedParamYId}
            onChangeAxisParams={(xId, yId) => {
              setLinkedParamXId(xId);
              setLinkedParamYId(yId);
            }}
            onChangeValues={(xVal, yVal) => {
              setSelectedParamId(linkedParamXId);
              recordUndoSnapshot('linked_pad');
              const frame = stateRef.current.composition.currentFrame;
              onUpdateEffect((eff) => {
                let nextTracks = eff.tracks;
                if (eff.connectToParameter) {
                  nextTracks = upsertKeyframeAtFrame(
                    nextTracks,
                    linkedParamXId,
                    frame,
                    xVal
                  );
                  nextTracks = upsertKeyframeAtFrame(
                    nextTracks,
                    linkedParamYId,
                    frame,
                    yVal
                  );
                }
                return {
                  ...eff,
                  puppet: {
                    ...eff.puppet,
                    parameters: eff.puppet.parameters.map((p) =>
                      p.id === linkedParamXId
                        ? { ...p, value: xVal }
                        : p.id === linkedParamYId
                          ? { ...p, value: yVal }
                          : p
                    ),
                  },
                  tracks: nextTracks,
                };
              });
            }}
            onClose={() => setShowLinkedPad(false)}
          />
        )}

        <FloatingPanel
          layout={panels.animation}
          title="Animation"
          minWidth={420}
          minHeight={180}
          onUpdateLayout={updatePanelLayout}
          onFocus={focusPanel}
        >
          <AnimationPanelContent
            composition={composition}
            effect={effect}
            selectedParamId={selectedParamId}
            clipboard={clipboard}
            onSelectParam={setSelectedParamId}
            onChangeFrame={handleScrubFrame}
            onChangeFps={(nextFps) => {
              onChangeComposition((prev) => ({ ...prev, fps: nextFps }));
              onFlashStatus(`Timeline FPS updated to ${nextFps} fps.`);
            }}
            onToggleConnectToParameter={(enabled) => {
              onUpdateEffect((eff) => ({
                ...eff,
                connectToParameter: enabled,
              }));
              onFlashStatus(
                enabled
                  ? 'Connected to Parameter: moving sliders now auto-inserts keyframes.'
                  : 'Disconnected from Parameter: move slider then press Add Keyframe.'
              );
            }}
            onTogglePlay={() =>
              onChangeComposition((prev) => ({
                ...prev,
                isPlaying: !prev.isPlaying,
              }))
            }
            onAddKeyframe={handleAddKeyframe}
            onDeleteSelectedKeyframes={handleDeleteSelectedKeyframes}
            onCopySelectedKeyframes={handleCopySelectedKeyframes}
            onPasteKeyframesAtFrame={handlePasteKeyframesAtFrame}
            onMoveSelectedKeyframes={handleMoveSelectedKeyframes}
            onBakePhysicsKeyframes={() => bakePhysicsIntoTimeline('add')}
            onRemovePhysicsKeyframes={removeBakedPhysicsKeyframes}
            onUpdatePhysicsKeyframes={() => bakePhysicsIntoTimeline('update')}
            onToggleKeyframeTarget={() => {
              const nextMode =
                effect.keyframeTarget === 'after_effects'
                  ? 'plugin'
                  : 'after_effects';
              onUpdateEffect((eff) => ({ ...eff, keyframeTarget: nextMode }));
              onFlashStatus(
                nextMode === 'after_effects'
                  ? 'After Effects Native Keyframe Mode enabled — keyframes sync directly to Solid Layer.'
                  : 'Switched back to Plugin Timeline keyframing.'
              );
            }}
            onSendKeyframesToAfterEffects={onExportAeKeyframes}
            curvePresets={curvePresets}
            onApplyKeyframeEasing={handleApplyKeyframeEasing}
            onToggleFavoriteCurve={handleToggleFavoriteCurve}
            onSaveCurvePreset={handleSaveCurvePreset}
            onDeleteCurvePreset={handleDeleteCurvePreset}
            audioTrack={audioTrack}
            onImportAudioFile={handleImportAudioFile}
            onLoadDemoVoice={handleLoadDemoVoice}
            onGenerateLipSync={handleGenerateLipSync}
            onClearAudioTrack={handleClearAudioTrack}
          />
        </FloatingPanel>

        <FloatingPanel
          layout={panels.physics}
          title="Physics"
          minWidth={260}
          minHeight={260}
          onUpdateLayout={updatePanelLayout}
          onFocus={focusPanel}
        >
          <PhysicsPanelContent
            puppet={puppet}
            effect={effect}
            selectedPhysicsGroupId={selectedPhysicsGroupId}
            showPhysicsOverlay={showPhysicsOverlay}
            showPendulumViewer={showPendulumViewer}
            showParamPhysicsPreview={showParamPhysicsPreview}
            physicsParamOffsets={livePhysicsParamOffsets}
            onSelectGroup={setSelectedPhysicsGroupId}
            onToggleShowOverlay={() => setShowPhysicsOverlay((v) => !v)}
            onTogglePendulumViewer={() => setShowPendulumViewer((v) => !v)}
            onToggleParamPhysicsPreview={() =>
              setShowParamPhysicsPreview((v) => !v)
            }
            onTriggerImpulse={() => {
              pendingImpulseRef.current = { x: 42, y: -12 };
              onFlashStatus('Triggered physics impulse shake.');
            }}
            onChangeGlobalPhysics={(patch) =>
              onUpdateEffect((eff) => ({ ...eff, ...patch }))
            }
            onUpdateGroup={(groupId, updater: (g: PhysicsGroup) => PhysicsGroup) =>
              onUpdatePuppet((doc) => ({
                ...doc,
                physicsGroups: doc.physicsGroups.map((g) =>
                  g.id === groupId ? updater(g) : g
                ),
              }))
            }
            onAddPhysicsGroup={() => {
              const idx = puppet.physicsGroups.length + 1;
              const newId = `phys_custom_${Date.now()}`;
              const firstParamId = puppet.parameters[0]?.id;
              const physOutputParamId =
                puppet.parameters.find((p) => p.group === 'Physics')?.id ??
                puppet.parameters[1]?.id ??
                firstParamId;
              onUpdatePuppet((doc) => ({
                ...doc,
                physicsGroups: [
                  ...doc.physicsGroups,
                  {
                    id: newId,
                    name: `Physics Chain ${idx}`,
                    enabled: true,
                    delay: 0.25,
                    anchorX: 512,
                    anchorY: 360,
                    gravityX: 0,
                    gravityY: 1,
                    windScale: 1,
                    inputs: firstParamId
                      ? [
                          {
                            parameterId: firstParamId,
                            type: 'positionX',
                            weight: 1,
                            scale: 1.5,
                          },
                        ]
                      : [],
                    pendulums: [
                      { length: 70, damping: 0.85, stiffness: 18, mass: 0.9 },
                      { length: 65, damping: 0.88, stiffness: 14, mass: 0.75 },
                    ],
                    outputs: physOutputParamId
                      ? [
                          {
                            targetType: 'parameter',
                            targetId: physOutputParamId,
                            property: 'paramValue',
                            pendulumIndex: 1,
                            scale: 0.8,
                          },
                        ]
                      : [],
                  },
                ],
              }));
              setSelectedPhysicsGroupId(newId);
            }}
          />
        </FloatingPanel>

        {/* FLOATING PENDULUM VIEWER SANDBOX (Does not modify original rigged parameters) */}
        {(() => {
          const activePendulumGroup =
            puppet.physicsGroups.find(
              (g) => g.id === selectedPhysicsGroupId
            ) ?? puppet.physicsGroups[0];
          if (!showPendulumViewer || !activePendulumGroup) return null;
          return (
            <PendulumViewerWindow
              group={activePendulumGroup}
              physicsStrength={effect.physicsStrength}
              windStrength={effect.windStrength}
              windTurbulence={effect.windTurbulence}
              onClose={() => setShowPendulumViewer(false)}
            />
          );
        })()}

        {/* FLOATING PARAMETER PHYSICS PREVIEW (Live secondary wiggle monitor) */}
        {showParamPhysicsPreview && (
          <ParameterPhysicsPreviewWindow
            puppet={puppet}
            physicsParamOffsets={livePhysicsParamOffsets}
            onClose={() => setShowParamPhysicsPreview(false)}
          />
        )}

        {/* BOTTOM-LEFT VIEWPORT OVERLAY: Preview Resolution + Live RAM & AE Cache Usage (Matching 1.png & 3.png) */}
        <div className="fixed left-3 bottom-[48px] z-[55] px-2.5 py-1.5 rounded-[5px] bg-[#1C1C1C]/90 border border-[#383838] space-y-1 text-[11px] backdrop-blur-[2px]">
          <div className="flex items-center gap-2">
            <label
              htmlFor="preview-res-select"
              className="text-[#CCCCCC] whitespace-nowrap"
            >
              Select preview:
            </label>
            <select
              id="preview-res-select"
              value={effect.renderQuality}
              onChange={(e) =>
                onUpdateEffect((eff) => ({
                  ...eff,
                  renderQuality: e.target.value as PreviewResolution,
                }))
              }
              className="px-1.5 py-0.5 rounded bg-[#2B2B2B] border border-[#444444] text-[#F0F0F0] text-[11px]"
            >
              <option value="full">Full (100%)</option>
              <option value="half">Half (50%)</option>
              <option value="third">Third (33%)</option>
              <option value="quarter">Quarter (25%)</option>
              <option value="custom">Custom</option>
            </select>
            {effect.renderQuality === 'custom' && (
              <input
                type="number"
                aria-label="Custom preview quality percent"
                min={15}
                max={100}
                value={effect.customQualityPercent}
                onChange={(e) =>
                  onUpdateEffect((eff) => ({
                    ...eff,
                    customQualityPercent: Math.max(
                      15,
                      Math.min(100, parseInt(e.target.value, 10) || 50)
                    ),
                  }))
                }
                className="w-14 px-1.5 py-0.5 rounded bg-[#141414] border border-[#444444] font-mono tabular-nums text-[11px] text-[#F0F0F0]"
              />
            )}
          </div>

          <div
            className="flex items-center gap-2 text-[10px] font-mono tabular-nums text-[#A8A8A8]"
            title={`AE Disk Cache Folder: ${cacheStats.cacheFolderPath}`}
          >
            <span data-testid="ram-usage-readout">
              RAM usage: {formatBytesToMB(cacheStats.ramBytes)}
            </span>
            <span aria-hidden="true">·</span>
            <span>AE Cache: {formatBytesToMB(cacheStats.diskCacheBytes)}</span>
            <button
              type="button"
              onClick={onPurgeCache}
              title="Purge After Effects Memory & Rioka Disk Cache"
              className="ml-1 px-1.5 py-0.5 rounded bg-[#2B2B2B] hover:bg-[#3A3A3A] text-[#D8D8D8] flex items-center gap-1 font-sans"
            >
              <Trash2 className="w-2.5 h-2.5 text-[#F87171]" />
              Purge
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 text-[9px] font-mono tabular-nums text-[#8F8F8F] pt-0.5 border-t border-[#2D2D2D]">
            <span title="Middle-Drag or Shift+Left-Drag: Move · Alt+Left-Drag: Rotate · Scroll: Scale">
              Char: ({effect.offsetX}, {effect.offsetY}) · {effect.rotation}° · {effect.scale}%
            </span>
            {(effect.offsetX !== 0 ||
              effect.offsetY !== 28 ||
              effect.rotation !== 0 ||
              effect.scale !== 100) && (
              <button
                type="button"
                onClick={() =>
                  onUpdateEffect((eff) => ({
                    ...eff,
                    offsetX: 0,
                    offsetY: 28,
                    rotation: 0,
                    scale: 100,
                  }))
                }
                className="text-[#93C5FD] hover:underline font-sans"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM AFTER EFFECTS FOOTER BAR (Reset menu on left, Cancel & Apply on right — Matching 1.png) */}
      <footer className="h-10 shrink-0 px-3 bg-[#232323] border-t border-[#3A3A3A] flex items-center justify-between gap-4 select-none z-[70]">
        {/* Left: Reset to Original Menu */}
        <div className="relative flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowResetMenu((v) => !v)}
            aria-label="Reset options"
            aria-expanded={showResetMenu}
            className="px-2.5 py-1 rounded bg-[#2F2F2F] hover:bg-[#3B3B3B] border border-[#464646] text-[11px] font-medium text-[#E8E8E8] flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#F59E0B]" />
            Reset
          </button>

          {showResetMenu && (
            <div
              role="menu"
              aria-label="Reset actions"
              data-testid="reset-dropdown-menu"
              className="absolute left-0 bottom-10 w-[210px] p-1 rounded-[6px] bg-[#202020] border border-[#464646] shadow-2xl space-y-0.5 text-[11px] z-[90]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onResetAllParameters();
                  setShowResetMenu(false);
                }}
                className="w-full px-2.5 py-1.5 rounded text-left text-[#E8E8E8] hover:bg-[#2D8CEB] hover:text-white transition-colors"
              >
                Reset All Parameter
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onResetAllKeyframes();
                  setShowResetMenu(false);
                }}
                className="w-full px-2.5 py-1.5 rounded text-left text-[#E8E8E8] hover:bg-[#2D8CEB] hover:text-white transition-colors"
              >
                Reset All Keyframe
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onResetAllPhysics();
                  setShowResetMenu(false);
                }}
                className="w-full px-2.5 py-1.5 rounded text-left text-[#E8E8E8] hover:bg-[#2D8CEB] hover:text-white transition-colors"
              >
                Reset All Physics
              </button>
              <div className="my-1 border-t border-[#383838]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onResetAll();
                  setShowResetMenu(false);
                }}
                className="w-full px-2.5 py-1.5 rounded text-left text-[#FCA5A5] hover:bg-[#7F1D1D] hover:text-white font-medium transition-colors"
              >
                Reset All
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  hasCustomPanelLayoutRef.current = false;
                  setPanels(createDefaultPanelLayouts());
                  setShowResetMenu(false);
                  onFlashStatus('Reset floating panel layout.');
                }}
                className="w-full px-2.5 py-1.5 rounded text-left text-[#BFBFBF] hover:bg-[#333333] transition-colors"
              >
                Reset Panel Layout
              </button>
            </div>
          )}

          {statusMessage && (
            <span
              role="status"
              className="text-[11px] text-[#93C5FD] truncate max-w-[460px]"
            >
              {statusMessage}
            </span>
          )}
        </div>

        {/* Right: Cancel & Apply Buttons (Matching 1.png) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 rounded-[5px] bg-[#303030] hover:bg-[#3C3C3C] border border-[#4A4A4A] text-[12px] font-medium text-[#E5E5E5] transition-colors whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            className="px-4 py-1.5 rounded-[5px] bg-[#2D8CEB] hover:bg-[#1E7AD6] text-[12px] font-semibold text-white transition-colors whitespace-nowrap"
          >
            Apply
          </button>
        </div>
      </footer>
    </div>
  );
}
