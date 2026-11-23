export type WorkspaceView = 'plugin_window' | 'ae_sdk';

export type StudioToolId =
  | 'cursor'
  | 'mesh_create'
  | 'bone_create'
  | 'group_layer'
  | 'add_morph_point'
  | 'brush_morph'
  | 'basic_morph';

export type PreviewResolution = 'full' | 'half' | 'third' | 'quarter' | 'custom';

export type ViewportBackground =
  | 'ae_composition'
  | 'gallery'
  | 'black'
  | 'ae_dark'
  | 'checkerboard'
  | 'light'
  | 'green_screen';

export type ThumbnailSize = 'none' | 'small' | 'normal' | 'large';

export interface GalleryBackgroundConfig {
  mediaType: 'image' | 'video';
  url: string;
  fileName: string;
  syncWithAnimation: boolean;
  startTimeSec: number;
  startTimeDisplayMode: 'timecode' | 'frame';
  quality: 'full' | 'half' | 'third' | 'quarter';
  showOnSolidLayer: boolean;
}

export interface MeshWarp {
  bendX: number;
  bendY: number;
  squeezeX: number;
  squeezeY: number;
}

export interface Transform2D {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  opacity: number;
}

export interface MorphPinPoint {
  id: string;
  /** Normalized rest position (0..1) inside layer bounds */
  restU: number;
  restV: number;
  /** Deformation displacement in model-space pixels */
  dx: number;
  dy: number;
  /** Local rotation deformation in degrees (default 0) */
  rotation?: number;
  /** Local uniform scale deformation around pin (default 1) */
  scale?: number;
}

export interface BasicMorphLattice {
  cols: number; // default 3 -> 4x4 control handles
  rows: number;
  /** Offsets in model-space pixels for each lattice control handle */
  offsets: Array<{ dx: number; dy: number }>;
}

export interface ArtMeshLayer {
  id: string;
  psdLayerName: string;
  name: string;
  partGroup:
    | 'hair_back'
    | 'body'
    | 'head'
    | 'face'
    | 'eyes'
    | 'mouth'
    | 'hair_front'
    | 'accessories'
    | 'custom';
  zIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pivotX: number; // normalized 0..1 inside bounds (adjustable via Bone Create + Alt)
  pivotY: number;
  boneTransform: {
    dx: number;
    dy: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  };
  opacity: number;
  visible: boolean;
  locked: boolean;
  parentDeformerId: string;
  parentLayerId?: string | null;
  groupLayerId?: string | null;
  meshCols: number;
  meshRows: number;
  vertexOffsets: Array<{ dx: number; dy: number }>;
  morphPins: MorphPinPoint[];
  basicLattice: BasicMorphLattice;
  textureDataUrl: string;
  psdStatus?: 'matched' | 'added' | 'preserved' | 'missing';
}

export interface DeformerNode {
  id: string;
  name: string;
  type: 'warp' | 'rotation' | 'group';
  parentId: string | null;
  pivotX: number;
  pivotY: number;
  width: number;
  height: number;
  baseTransform: Transform2D;
}

export interface ParameterFolder {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

export interface RigParameter {
  id: string;
  name: string;
  group: 'Head' | 'Body' | 'Eyes' | 'Mouth' | 'Physics' | 'Custom';
  folderId: string | null;
  min: number;
  max: number;
  defaultValue: number;
  value: number;
  keyforms: number[];
}

export interface KeyformDelta {
  id: string;
  parameterId: string;
  keyformValue: number;
  targetType: 'deformer' | 'layer';
  targetId: string;
  dx: number;
  dy: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  opacityDelta: number;
  meshWarp: MeshWarp;
}

export interface PhysicsInputBinding {
  parameterId: string;
  type: 'positionX' | 'positionY' | 'angle';
  weight: number;
  scale: number;
}

export interface PhysicsOutputBinding {
  targetType: 'deformer' | 'layer' | 'parameter';
  targetId: string;
  property: 'rotation' | 'dx' | 'dy' | 'bendX' | 'bendY' | 'scaleY' | 'paramValue';
  pendulumIndex: number;
  scale: number;
}

export interface PendulumLinkConfig {
  length: number;
  damping: number;
  stiffness: number;
  mass: number;
}

export interface PhysicsGroup {
  id: string;
  name: string;
  enabled: boolean;
  delay: number; // 0..1 reaction delay / inertia smoothness
  anchorX: number;
  anchorY: number;
  gravityX: number;
  gravityY: number;
  windScale: number;
  inputs: PhysicsInputBinding[];
  pendulums: PendulumLinkConfig[];
  outputs: PhysicsOutputBinding[];
}

export interface PendulumLinkState {
  angle: number;
  angularVelocity: number;
  worldX: number;
  worldY: number;
}

export interface PhysicsGroupRuntimeState {
  groupId: string;
  anchorWorldX: number;
  anchorWorldY: number;
  prevInputX: number;
  prevInputY: number;
  prevInputAngle: number;
  links: PendulumLinkState[];
}

export type PhysicsSimulationState = Record<string, PhysicsGroupRuntimeState>;

export interface PsdManifest {
  fileName: string;
  revision: number;
  lastUpdated: string;
  width: number;
  height: number;
  sourceType: 'demo-classic' | 'demo-festival' | 'user-psd';
  matchedLayers: number;
  addedLayers: number;
  preservedRigBindings: number;
}

export interface PuppetDocument {
  id: string;
  name: string;
  modelWidth: number;
  modelHeight: number;
  psd: PsdManifest;
  deformers: DeformerNode[];
  layers: ArtMeshLayer[];
  parameterFolders: ParameterFolder[];
  parameters: RigParameter[];
  keyforms: KeyformDelta[];
  physicsGroups: PhysicsGroup[];
}

export type KeyframeEasing = 'linear' | 'easeInOut' | 'hold' | 'bezier';

export type CubicBezierTuple = [number, number, number, number];

export interface TimelineKeyframe {
  id: string;
  frame: number;
  value: number;
  easing: KeyframeEasing;
  bezier?: CubicBezierTuple;
  fromPhysics?: boolean;
}

export interface EasingCurvePreset {
  id: string;
  name: string;
  easing: KeyframeEasing;
  bezier: CubicBezierTuple;
  favorite: boolean;
  builtIn?: boolean;
}

export interface ExpressionPreset {
  id: string;
  name: string;
  values: Record<string, number>;
  builtIn?: boolean;
}

export interface AudioTrackConfig {
  fileName: string;
  url: string | null;
  durationSec: number;
  peaks: number[];
  volume: number;
  isDemo?: boolean;
}

export interface ParameterTrack {
  parameterId: string;
  stopwatchEnabled: boolean;
  keyframes: TimelineKeyframe[];
}

export interface RiokaPuppetEffect {
  id: string;
  enabled: boolean;
  puppet: PuppetDocument;
  renderQuality: PreviewResolution;
  customQualityPercent: number;
  physicsEnabled: boolean;
  physicsStrength: number;
  windStrength: number;
  windTurbulence: number;
  autoBlink: boolean;
  autoBreath: boolean;
  cursorTracking: boolean;
  keyframeTarget: 'plugin' | 'after_effects';
  connectToParameter: boolean;
  galleryBackground: GalleryBackgroundConfig | null;
  bakedToSolidLayer?: boolean;
  offsetX: number;
  offsetY: number;
  scale: number;
  rotation: number;
  tracks: Record<string, ParameterTrack>;
}

export interface CompositionLayer {
  id: string;
  name: string;
  type: 'solid' | 'backdrop';
  solidColor: string;
  width: number;
  height: number;
  visible: boolean;
  solo: boolean;
  locked: boolean;
  opacity: number;
  inFrame: number;
  outFrame: number;
  effect: RiokaPuppetEffect | null;
}

export interface CompositionState {
  name: string;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  currentFrame: number;
  isPlaying: boolean;
  loop: boolean;
  showTransparencyGrid: boolean;
  showSafeGuides: boolean;
  zoom: number;
  layers: CompositionLayer[];
  selectedLayerId: string;
}

export interface EvaluatedTargetState {
  dx: number;
  dy: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  opacity: number;
  meshWarp: MeshWarp;
}

export interface EvaluatedRigResult {
  deformerTransforms: Record<string, EvaluatedTargetState>;
  layerTransforms: Record<string, EvaluatedTargetState>;
  physicsParamOffsets: Record<string, number>;
}

export interface FloatingPanelLayout {
  id: 'psd' | 'parameter' | 'animation' | 'physics';
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  zIndex: number;
}

export interface CacheStats {
  ramBytes: number;
  diskCacheBytes: number;
  cachedTextures: number;
  cachedPhysicsFrames: number;
  cacheFolderPath: string;
  lastPurgedAt: string | null;
}
