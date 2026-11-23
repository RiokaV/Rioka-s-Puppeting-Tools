import type {
  ArtMeshLayer,
  CompositionState,
  DeformerNode,
  KeyformDelta,
  ParameterFolder,
  ParameterTrack,
  PhysicsGroup,
  PuppetDocument,
  RigParameter,
  RiokaPuppetEffect,
} from '../types/puppet';
import { buildDemoPsdLayers } from '../engine/psdPipeline';
import { createDefaultBasicLattice } from '../engine/morphTools';

const zeroWarp = () => ({ bendX: 0, bendY: 0, squeezeX: 0, squeezeY: 0 });

function kf(
  id: string,
  parameterId: string,
  keyformValue: number,
  targetType: 'deformer' | 'layer',
  targetId: string,
  partial: Partial<
    Omit<
      KeyformDelta,
      'id' | 'parameterId' | 'keyformValue' | 'targetType' | 'targetId'
    >
  >
): KeyformDelta {
  return {
    id,
    parameterId,
    keyformValue,
    targetType,
    targetId,
    dx: partial.dx ?? 0,
    dy: partial.dy ?? 0,
    rotation: partial.rotation ?? 0,
    scaleX: partial.scaleX ?? 0,
    scaleY: partial.scaleY ?? 0,
    skewX: partial.skewX ?? 0,
    skewY: partial.skewY ?? 0,
    opacityDelta: partial.opacityDelta ?? 0,
    meshWarp: { ...zeroWarp(), ...(partial.meshWarp ?? {}) },
  };
}

export function createDefaultPuppetDocument(): PuppetDocument {
  const deformers: DeformerNode[] = [
    {
      id: 'def_body',
      name: 'Body Warp',
      type: 'warp',
      parentId: null,
      pivotX: 512,
      pivotY: 820,
      width: 520,
      height: 520,
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
    {
      id: 'def_chest_ribbon',
      name: 'Chest Ribbon Physics',
      type: 'warp',
      parentId: 'def_body',
      pivotX: 512,
      pivotY: 710,
      width: 190,
      height: 190,
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
    {
      id: 'def_head',
      name: 'Head Rotation',
      type: 'warp',
      parentId: 'def_body',
      pivotX: 512,
      pivotY: 565,
      width: 440,
      height: 440,
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
    {
      id: 'def_hair_back',
      name: 'Hair Back Warp',
      type: 'warp',
      parentId: 'def_head',
      pivotX: 512,
      pivotY: 360,
      width: 460,
      height: 490,
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
    {
      id: 'def_hair_tail_l',
      name: 'Twin-Tail Left Physics',
      type: 'warp',
      parentId: 'def_head',
      pivotX: 382,
      pivotY: 330,
      width: 220,
      height: 450,
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
    {
      id: 'def_hair_tail_r',
      name: 'Twin-Tail Right Physics',
      type: 'warp',
      parentId: 'def_head',
      pivotX: 642,
      pivotY: 330,
      width: 220,
      height: 450,
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
    {
      id: 'def_face',
      name: 'Face Features Warp',
      type: 'warp',
      parentId: 'def_head',
      pivotX: 512,
      pivotY: 430,
      width: 300,
      height: 260,
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
    {
      id: 'def_eye_l',
      name: 'Eye Left Deformer',
      type: 'warp',
      parentId: 'def_face',
      pivotX: 450,
      pivotY: 424,
      width: 110,
      height: 100,
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
    {
      id: 'def_eye_r',
      name: 'Eye Right Deformer',
      type: 'warp',
      parentId: 'def_face',
      pivotX: 574,
      pivotY: 424,
      width: 110,
      height: 100,
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
    {
      id: 'def_mouth',
      name: 'Mouth Deformer',
      type: 'warp',
      parentId: 'def_face',
      pivotX: 512,
      pivotY: 500,
      width: 100,
      height: 70,
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
    {
      id: 'def_hair_front',
      name: 'Hair Front Physics',
      type: 'warp',
      parentId: 'def_head',
      pivotX: 512,
      pivotY: 220,
      width: 380,
      height: 360,
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
    {
      id: 'def_ribbon',
      name: 'Hair Ribbon Accessory',
      type: 'warp',
      parentId: 'def_hair_front',
      pivotX: 512,
      pivotY: 254,
      width: 350,
      height: 130,
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
  ];

  const demoIncoming = buildDemoPsdLayers('classic');
  const layerDeformerMap: Record<
    string,
    { deformerId: string; group: ArtMeshLayer['partGroup']; cols: number; rows: number; pivotY?: number }
  > = {
    Hair_Back: { deformerId: 'def_hair_back', group: 'hair_back', cols: 4, rows: 5, pivotY: 0.2 },
    Hair_TwinTail_L: { deformerId: 'def_hair_tail_l', group: 'hair_back', cols: 3, rows: 6, pivotY: 0.1 },
    Hair_TwinTail_R: { deformerId: 'def_hair_tail_r', group: 'hair_back', cols: 3, rows: 6, pivotY: 0.1 },
    Body_Torso: { deformerId: 'def_body', group: 'body', cols: 4, rows: 4, pivotY: 0.7 },
    Body_Ribbon: { deformerId: 'def_chest_ribbon', group: 'accessories', cols: 3, rows: 4, pivotY: 0.25 },
    Head_Base: { deformerId: 'def_head', group: 'head', cols: 4, rows: 4, pivotY: 0.75 },
    Face_Blush_Nose: { deformerId: 'def_face', group: 'face', cols: 3, rows: 2 },
    Eye_Left: { deformerId: 'def_eye_l', group: 'eyes', cols: 3, rows: 3 },
    Eye_Right: { deformerId: 'def_eye_r', group: 'eyes', cols: 3, rows: 3 },
    Face_Eyebrows: { deformerId: 'def_face', group: 'eyes', cols: 4, rows: 2 },
    Face_Mouth: { deformerId: 'def_mouth', group: 'mouth', cols: 3, rows: 3, pivotY: 0.35 },
    Hair_SideLocks: { deformerId: 'def_hair_front', group: 'hair_front', cols: 4, rows: 5, pivotY: 0.15 },
    Hair_Front_Bangs: { deformerId: 'def_hair_front', group: 'hair_front', cols: 5, rows: 4, pivotY: 0.12 },
    Hair_Ribbon_Top: { deformerId: 'def_ribbon', group: 'accessories', cols: 4, rows: 2, pivotY: 0.5 },
  };

  const layers: ArtMeshLayer[] = demoIncoming.map((inc, idx) => {
    const meta = layerDeformerMap[inc.psdLayerName] ?? {
      deformerId: 'def_head',
      group: 'custom' as const,
      cols: 4,
      rows: 4,
    };
    return {
      id: `layer_${inc.psdLayerName.toLowerCase()}`,
      psdLayerName: inc.psdLayerName,
      name: inc.name,
      partGroup: meta.group,
      zIndex: idx,
      x: inc.x,
      y: inc.y,
      width: inc.width,
      height: inc.height,
      pivotX: 0.5,
      pivotY: meta.pivotY ?? 0.5,
      boneTransform: { dx: 0, dy: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      opacity: inc.opacity,
      visible: inc.visible,
      locked: false,
      parentDeformerId: meta.deformerId,
      groupLayerId: null,
      meshCols: meta.cols,
      meshRows: meta.rows,
      vertexOffsets: Array.from(
        { length: (meta.cols + 1) * (meta.rows + 1) },
        () => ({ dx: 0, dy: 0 })
      ),
      morphPins: [],
      basicLattice: createDefaultBasicLattice(3, 3),
      textureDataUrl: inc.textureDataUrl,
      psdStatus: 'matched',
    };
  });

  const parameterFolders: ParameterFolder[] = [
    {
      id: 'folder_face_head',
      name: 'Folder One',
      color: '#2D8CEB',
      collapsed: false,
    },
  ];

  const parameters: RigParameter[] = [
    { id: 'ParamAngleX', name: 'Head Angle X', group: 'Head', folderId: 'folder_face_head', min: -30, max: 30, defaultValue: 0, value: 0, keyforms: [-30, 0, 30] },
    { id: 'ParamAngleY', name: 'Head Angle Y', group: 'Head', folderId: 'folder_face_head', min: -30, max: 30, defaultValue: 0, value: 0, keyforms: [-30, 0, 30] },
    { id: 'ParamAngleZ', name: 'Head Angle Z', group: 'Head', folderId: 'folder_face_head', min: -30, max: 30, defaultValue: 0, value: 0, keyforms: [-30, 0, 30] },
    { id: 'ParamEyeLOpen', name: 'Eye L Open', group: 'Eyes', folderId: 'folder_face_head', min: 0, max: 1, defaultValue: 1, value: 1, keyforms: [0, 0.5, 1] },
    { id: 'ParamEyeROpen', name: 'Eye R Open', group: 'Eyes', folderId: 'folder_face_head', min: 0, max: 1, defaultValue: 1, value: 1, keyforms: [0, 0.5, 1] },
    { id: 'ParamEyeBallX', name: 'Eyeball X', group: 'Eyes', folderId: 'folder_face_head', min: -1, max: 1, defaultValue: 0, value: 0, keyforms: [-1, 0, 1] },
    { id: 'ParamEyeBallY', name: 'Eyeball Y', group: 'Eyes', folderId: 'folder_face_head', min: -1, max: 1, defaultValue: 0, value: 0, keyforms: [-1, 0, 1] },
    { id: 'ParamBodyAngleX', name: 'Body Angle X', group: 'Body', folderId: null, min: -10, max: 10, defaultValue: 0, value: 0, keyforms: [-10, 0, 10] },
    { id: 'ParamBodyAngleZ', name: 'Body Angle Z', group: 'Body', folderId: null, min: -10, max: 10, defaultValue: 0, value: 0, keyforms: [-10, 0, 10] },
    { id: 'ParamMouthOpenY', name: 'Mouth Open', group: 'Mouth', folderId: null, min: 0, max: 1, defaultValue: 0.25, value: 0.25, keyforms: [0, 0.5, 1] },
    { id: 'ParamMouthForm', name: 'Mouth Smile', group: 'Mouth', folderId: null, min: -1, max: 1, defaultValue: 0.4, value: 0.4, keyforms: [-1, 0, 1] },
    { id: 'ParamBreath', name: 'Breath Cycle', group: 'Body', folderId: null, min: 0, max: 1, defaultValue: 0, value: 0, keyforms: [0, 1] },
    // Secondary Physics-driven Cubism parameters (driven automatically when Param 1 moves!)
    { id: 'ParamHairFrontSway', name: 'Hair Front Sway', group: 'Physics', folderId: null, min: -1, max: 1, defaultValue: 0, value: 0, keyforms: [-1, 0, 1] },
    { id: 'ParamTwinTailSway', name: 'Twin-Tail Sway', group: 'Physics', folderId: null, min: -1, max: 1, defaultValue: 0, value: 0, keyforms: [-1, 0, 1] },
    { id: 'ParamRibbonSway', name: 'Ribbon Sway', group: 'Physics', folderId: null, min: -1, max: 1, defaultValue: 0, value: 0, keyforms: [-1, 0, 1] },
  ];

  // Rich Live2D Cubism keyform bindings for authentic 2.5D head turn, parallax hair, eyes, mouth & breath
  const keyforms: KeyformDelta[] = [
    // --- Head Angle X (-30, 0, +30) ---
    kf('kf_ax_head_l', 'ParamAngleX', -30, 'deformer', 'def_head', { dx: -18, skewY: -3, meshWarp: { bendX: 0, bendY: 0, squeezeX: -0.16, squeezeY: 0 } }),
    kf('kf_ax_head_c', 'ParamAngleX', 0, 'deformer', 'def_head', {}),
    kf('kf_ax_head_r', 'ParamAngleX', 30, 'deformer', 'def_head', { dx: 18, skewY: 3, meshWarp: { bendX: 0, bendY: 0, squeezeX: 0.16, squeezeY: 0 } }),

    kf('kf_ax_face_l', 'ParamAngleX', -30, 'deformer', 'def_face', { dx: -26, scaleX: -0.07 }),
    kf('kf_ax_face_c', 'ParamAngleX', 0, 'deformer', 'def_face', {}),
    kf('kf_ax_face_r', 'ParamAngleX', 30, 'deformer', 'def_face', { dx: 26, scaleX: -0.07 }),

    kf('kf_ax_hf_l', 'ParamAngleX', -30, 'deformer', 'def_hair_front', { dx: -16, scaleX: -0.03 }),
    kf('kf_ax_hf_c', 'ParamAngleX', 0, 'deformer', 'def_hair_front', {}),
    kf('kf_ax_hf_r', 'ParamAngleX', 30, 'deformer', 'def_hair_front', { dx: 16, scaleX: -0.03 }),

    kf('kf_ax_hb_l', 'ParamAngleX', -30, 'deformer', 'def_hair_back', { dx: 14 }),
    kf('kf_ax_hb_c', 'ParamAngleX', 0, 'deformer', 'def_hair_back', {}),
    kf('kf_ax_hb_r', 'ParamAngleX', 30, 'deformer', 'def_hair_back', { dx: -14 }),

    // --- Head Angle Y (-30, 0, +30) ---
    kf('kf_ay_head_d', 'ParamAngleY', -30, 'deformer', 'def_head', { dy: 14, meshWarp: { bendX: 0, bendY: 0.12, squeezeX: 0, squeezeY: -0.14 } }),
    kf('kf_ay_head_c', 'ParamAngleY', 0, 'deformer', 'def_head', {}),
    kf('kf_ay_head_u', 'ParamAngleY', 30, 'deformer', 'def_head', { dy: -14, meshWarp: { bendX: 0, bendY: -0.12, squeezeX: 0, squeezeY: 0.14 } }),

    kf('kf_ay_face_d', 'ParamAngleY', -30, 'deformer', 'def_face', { dy: 24, scaleY: -0.06 }),
    kf('kf_ay_face_c', 'ParamAngleY', 0, 'deformer', 'def_face', {}),
    kf('kf_ay_face_u', 'ParamAngleY', 30, 'deformer', 'def_face', { dy: -22, scaleY: -0.05 }),

    kf('kf_ay_hf_d', 'ParamAngleY', -30, 'deformer', 'def_hair_front', { dy: 12 }),
    kf('kf_ay_hf_c', 'ParamAngleY', 0, 'deformer', 'def_hair_front', {}),
    kf('kf_ay_hf_u', 'ParamAngleY', 30, 'deformer', 'def_hair_front', { dy: -12 }),

    // --- Head Angle Z (-30, 0, +30) ---
    kf('kf_az_head_l', 'ParamAngleZ', -30, 'deformer', 'def_head', { rotation: -16, dx: -10 }),
    kf('kf_az_head_c', 'ParamAngleZ', 0, 'deformer', 'def_head', {}),
    kf('kf_az_head_r', 'ParamAngleZ', 30, 'deformer', 'def_head', { rotation: 16, dx: 10 }),

    // --- Body Angle X (-10, 0, +10) ---
    kf('kf_bx_l', 'ParamBodyAngleX', -10, 'deformer', 'def_body', { dx: -26, skewX: -4, rotation: -3 }),
    kf('kf_bx_c', 'ParamBodyAngleX', 0, 'deformer', 'def_body', {}),
    kf('kf_bx_r', 'ParamBodyAngleX', 10, 'deformer', 'def_body', { dx: 26, skewX: 4, rotation: 3 }),

    // --- Body Angle Z (-10, 0, +10) ---
    kf('kf_bz_l', 'ParamBodyAngleZ', -10, 'deformer', 'def_body', { rotation: -8 }),
    kf('kf_bz_c', 'ParamBodyAngleZ', 0, 'deformer', 'def_body', {}),
    kf('kf_bz_r', 'ParamBodyAngleZ', 10, 'deformer', 'def_body', { rotation: 8 }),

    // --- Eye L Open (0, 0.5, 1) ---
    kf('kf_eyel_0', 'ParamEyeLOpen', 0, 'deformer', 'def_eye_l', { scaleY: -0.88, dy: 8, meshWarp: { bendX: 0, bendY: 0.35, squeezeX: 0, squeezeY: 0 } }),
    kf('kf_eyel_5', 'ParamEyeLOpen', 0.5, 'deformer', 'def_eye_l', { scaleY: -0.42, dy: 4 }),
    kf('kf_eyel_1', 'ParamEyeLOpen', 1, 'deformer', 'def_eye_l', {}),

    // --- Eye R Open (0, 0.5, 1) ---
    kf('kf_eyer_0', 'ParamEyeROpen', 0, 'deformer', 'def_eye_r', { scaleY: -0.88, dy: 8, meshWarp: { bendX: 0, bendY: 0.35, squeezeX: 0, squeezeY: 0 } }),
    kf('kf_eyer_5', 'ParamEyeROpen', 0.5, 'deformer', 'def_eye_r', { scaleY: -0.42, dy: 4 }),
    kf('kf_eyer_1', 'ParamEyeROpen', 1, 'deformer', 'def_eye_r', {}),

    // --- Eyeball X & Y ---
    kf('kf_ebx_l1', 'ParamEyeBallX', -1, 'deformer', 'def_eye_l', { dx: -7 }),
    kf('kf_ebx_l0', 'ParamEyeBallX', 0, 'deformer', 'def_eye_l', {}),
    kf('kf_ebx_l2', 'ParamEyeBallX', 1, 'deformer', 'def_eye_l', { dx: 7 }),
    kf('kf_ebx_r1', 'ParamEyeBallX', -1, 'deformer', 'def_eye_r', { dx: -7 }),
    kf('kf_ebx_r0', 'ParamEyeBallX', 0, 'deformer', 'def_eye_r', {}),
    kf('kf_ebx_r2', 'ParamEyeBallX', 1, 'deformer', 'def_eye_r', { dx: 7 }),

    kf('kf_eby_l1', 'ParamEyeBallY', -1, 'deformer', 'def_eye_l', { dy: 6 }),
    kf('kf_eby_l0', 'ParamEyeBallY', 0, 'deformer', 'def_eye_l', {}),
    kf('kf_eby_l2', 'ParamEyeBallY', 1, 'deformer', 'def_eye_l', { dy: -6 }),
    kf('kf_eby_r1', 'ParamEyeBallY', -1, 'deformer', 'def_eye_r', { dy: 6 }),
    kf('kf_eby_r0', 'ParamEyeBallY', 0, 'deformer', 'def_eye_r', {}),
    kf('kf_eby_r2', 'ParamEyeBallY', 1, 'deformer', 'def_eye_r', { dy: -6 }),

    // --- Mouth Open (0, 0.5, 1) ---
    kf('kf_mo_0', 'ParamMouthOpenY', 0, 'deformer', 'def_mouth', { scaleY: -0.78, scaleX: -0.08, dy: -4 }),
    kf('kf_mo_5', 'ParamMouthOpenY', 0.5, 'deformer', 'def_mouth', { scaleY: -0.25, dy: 1 }),
    kf('kf_mo_1', 'ParamMouthOpenY', 1, 'deformer', 'def_mouth', { scaleY: 0.25, scaleX: 0.08, dy: 5 }),

    // --- Mouth Smile (-1, 0, 1) ---
    kf('kf_mf_sad', 'ParamMouthForm', -1, 'deformer', 'def_mouth', { scaleX: -0.2, dy: 4, meshWarp: { bendX: 0, bendY: -0.45, squeezeX: 0, squeezeY: 0 } }),
    kf('kf_mf_neu', 'ParamMouthForm', 0, 'deformer', 'def_mouth', {}),
    kf('kf_mf_hap', 'ParamMouthForm', 1, 'deformer', 'def_mouth', { scaleX: 0.16, dy: -2, meshWarp: { bendX: 0, bendY: 0.42, squeezeX: 0, squeezeY: 0 } }),

    // --- Breath (0, 1) ---
    kf('kf_br_0', 'ParamBreath', 0, 'deformer', 'def_body', {}),
    kf('kf_br_1', 'ParamBreath', 1, 'deformer', 'def_body', { dy: -10, scaleY: 0.024, scaleX: 0.015 }),
    kf('kf_br_h0', 'ParamBreath', 0, 'deformer', 'def_head', {}),
    kf('kf_br_h1', 'ParamBreath', 1, 'deformer', 'def_head', { dy: -5 }),
    // --- Secondary Physics Parameter Keyforms (Cubism Param 1 -> Param 2 & 3 linkage) ---
    kf('kf_hfs_l', 'ParamHairFrontSway', -1, 'deformer', 'def_hair_front', { dx: -10, rotation: -4, meshWarp: { bendX: -0.25, bendY: 0, squeezeX: 0, squeezeY: 0 } }),
    kf('kf_hfs_c', 'ParamHairFrontSway', 0, 'deformer', 'def_hair_front', {}),
    kf('kf_hfs_r', 'ParamHairFrontSway', 1, 'deformer', 'def_hair_front', { dx: 10, rotation: 4, meshWarp: { bendX: 0.25, bendY: 0, squeezeX: 0, squeezeY: 0 } }),

    kf('kf_tts_l1', 'ParamTwinTailSway', -1, 'deformer', 'def_hair_tail_l', { rotation: -7, meshWarp: { bendX: -0.2, bendY: 0, squeezeX: 0, squeezeY: 0 } }),
    kf('kf_tts_c1', 'ParamTwinTailSway', 0, 'deformer', 'def_hair_tail_l', {}),
    kf('kf_tts_r1', 'ParamTwinTailSway', 1, 'deformer', 'def_hair_tail_l', { rotation: 7, meshWarp: { bendX: 0.2, bendY: 0, squeezeX: 0, squeezeY: 0 } }),
    kf('kf_tts_l2', 'ParamTwinTailSway', -1, 'deformer', 'def_hair_tail_r', { rotation: -7, meshWarp: { bendX: -0.2, bendY: 0, squeezeX: 0, squeezeY: 0 } }),
    kf('kf_tts_c2', 'ParamTwinTailSway', 0, 'deformer', 'def_hair_tail_r', {}),
    kf('kf_tts_r2', 'ParamTwinTailSway', 1, 'deformer', 'def_hair_tail_r', { rotation: 7, meshWarp: { bendX: 0.2, bendY: 0, squeezeX: 0, squeezeY: 0 } }),

    kf('kf_rbs_l', 'ParamRibbonSway', -1, 'deformer', 'def_chest_ribbon', { rotation: -10, meshWarp: { bendX: -0.28, bendY: 0, squeezeX: 0, squeezeY: 0 } }),
    kf('kf_rbs_c', 'ParamRibbonSway', 0, 'deformer', 'def_chest_ribbon', {}),
    kf('kf_rbs_r', 'ParamRibbonSway', 1, 'deformer', 'def_chest_ribbon', { rotation: 10, meshWarp: { bendX: 0.28, bendY: 0, squeezeX: 0, squeezeY: 0 } }),
  ];

  const physicsGroups: PhysicsGroup[] = [
    {
      id: 'phys_hair_front',
      name: 'Hair Front Bangs',
      enabled: true,
      delay: 0.22,
      anchorX: 512,
      anchorY: 220,
      gravityX: 0,
      gravityY: 1,
      windScale: 0.85,
      inputs: [
        { parameterId: 'ParamAngleX', type: 'positionX', weight: 1, scale: 1.4 },
        { parameterId: 'ParamAngleZ', type: 'angle', weight: 1, scale: 0.9 },
        { parameterId: 'ParamBodyAngleX', type: 'positionX', weight: 0.7, scale: 2.2 },
      ],
      pendulums: [
        { length: 65, damping: 0.82, stiffness: 24, mass: 0.85 },
        { length: 60, damping: 0.86, stiffness: 18, mass: 0.65 },
      ],
      outputs: [
        { targetType: 'parameter', targetId: 'ParamHairFrontSway', property: 'paramValue', pendulumIndex: 1, scale: 0.9 },
        { targetType: 'deformer', targetId: 'def_hair_front', property: 'rotation', pendulumIndex: 0, scale: 0.35 },
        { targetType: 'deformer', targetId: 'def_hair_front', property: 'bendX', pendulumIndex: 1, scale: 1.15 },
      ],
    },
    {
      id: 'phys_tail_l',
      name: 'Twin-Tail Left',
      enabled: true,
      delay: 0.32,
      anchorX: 375,
      anchorY: 325,
      gravityX: -0.08,
      gravityY: 1,
      windScale: 1.35,
      inputs: [
        { parameterId: 'ParamAngleX', type: 'positionX', weight: 1, scale: 1.8 },
        { parameterId: 'ParamAngleZ', type: 'angle', weight: 1, scale: 1.15 },
        { parameterId: 'ParamBodyAngleX', type: 'positionX', weight: 1, scale: 2.8 },
      ],
      pendulums: [
        { length: 88, damping: 0.88, stiffness: 16, mass: 1.1 },
        { length: 92, damping: 0.9, stiffness: 13, mass: 0.9 },
        { length: 85, damping: 0.91, stiffness: 11, mass: 0.75 },
      ],
      outputs: [
        { targetType: 'parameter', targetId: 'ParamTwinTailSway', property: 'paramValue', pendulumIndex: 1, scale: 0.65 },
        { targetType: 'deformer', targetId: 'def_hair_tail_l', property: 'rotation', pendulumIndex: 0, scale: 0.42 },
        { targetType: 'deformer', targetId: 'def_hair_tail_l', property: 'bendX', pendulumIndex: 2, scale: 0.95 },
      ],
    },
    {
      id: 'phys_tail_r',
      name: 'Twin-Tail Right',
      enabled: true,
      delay: 0.32,
      anchorX: 649,
      anchorY: 325,
      gravityX: 0.08,
      gravityY: 1,
      windScale: 1.35,
      inputs: [
        { parameterId: 'ParamAngleX', type: 'positionX', weight: 1, scale: 1.8 },
        { parameterId: 'ParamAngleZ', type: 'angle', weight: 1, scale: 1.15 },
        { parameterId: 'ParamBodyAngleX', type: 'positionX', weight: 1, scale: 2.8 },
      ],
      pendulums: [
        { length: 88, damping: 0.88, stiffness: 16, mass: 1.1 },
        { length: 92, damping: 0.9, stiffness: 13, mass: 0.9 },
        { length: 85, damping: 0.91, stiffness: 11, mass: 0.75 },
      ],
      outputs: [
        { targetType: 'parameter', targetId: 'ParamTwinTailSway', property: 'paramValue', pendulumIndex: 1, scale: 0.4 },
        { targetType: 'deformer', targetId: 'def_hair_tail_r', property: 'rotation', pendulumIndex: 0, scale: 0.42 },
        { targetType: 'deformer', targetId: 'def_hair_tail_r', property: 'bendX', pendulumIndex: 2, scale: 0.95 },
      ],
    },
    {
      id: 'phys_ribbon',
      name: 'Ribbons & Outfit Sway',
      enabled: true,
      delay: 0.28,
      anchorX: 512,
      anchorY: 715,
      gravityX: 0,
      gravityY: 1,
      windScale: 1.0,
      inputs: [
        { parameterId: 'ParamBodyAngleX', type: 'positionX', weight: 1, scale: 3.1 },
        { parameterId: 'ParamBodyAngleZ', type: 'angle', weight: 1, scale: 1.2 },
        { parameterId: 'ParamAngleX', type: 'positionX', weight: 0.4, scale: 1.0 },
      ],
      pendulums: [
        { length: 65, damping: 0.84, stiffness: 20, mass: 0.9 },
        { length: 60, damping: 0.87, stiffness: 16, mass: 0.7 },
      ],
      outputs: [
        { targetType: 'parameter', targetId: 'ParamRibbonSway', property: 'paramValue', pendulumIndex: 1, scale: 0.85 },
        { targetType: 'deformer', targetId: 'def_chest_ribbon', property: 'rotation', pendulumIndex: 0, scale: 0.8 },
        { targetType: 'deformer', targetId: 'def_ribbon', property: 'rotation', pendulumIndex: 0, scale: 0.25 },
      ],
    },
  ];

  return {
    id: 'puppet_rioka_v1',
    name: 'Rioka_Character_Rig',
    modelWidth: 1024,
    modelHeight: 1024,
    psd: {
      fileName: 'Rioka_Classic_Rig.psd',
      revision: 1,
      lastUpdated: 'Initial Load',
      width: 2048,
      height: 2048,
      sourceType: 'demo-classic',
      matchedLayers: layers.length,
      addedLayers: 0,
      preservedRigBindings: keyforms.length + 12,
    },
    deformers,
    layers,
    parameterFolders,
    parameters,
    keyforms,
    physicsGroups,
  };
}

export function createDefaultPuppetEffect(): RiokaPuppetEffect {
  const puppet = createDefaultPuppetDocument();

  const tracks: Record<string, ParameterTrack> = {};
  for (const p of puppet.parameters) {
    tracks[p.id] = {
      parameterId: p.id,
      stopwatchEnabled: false,
      keyframes: [],
    };
  }

  // All parameter tracks start clean with zero animation keyframes on first load.

  return {
    id: `eff_${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    puppet,
    renderQuality: 'full',
    customQualityPercent: 100,
    physicsEnabled: true,
    physicsStrength: 1.0,
    windStrength: 0.18,
    windTurbulence: 0.35,
    autoBlink: true,
    autoBreath: true,
    cursorTracking: false,
    keyframeTarget: 'plugin',
    connectToParameter: false,
    offsetX: 0,
    offsetY: 28,
    scale: 100,
    rotation: 0,
    bakedToSolidLayer: false,
    galleryBackground: null,
    tracks,
  };
}

export function createInitialComposition(): CompositionState {
  return {
    name: 'Comp 1 — Rioka Live2D Scene',
    width: 1920,
    height: 1080,
    fps: 30,
    durationFrames: 180,
    currentFrame: 0,
    isPlaying: false,
    loop: true,
    showTransparencyGrid: false,
    showSafeGuides: false,
    zoom: 1,
    selectedLayerId: 'comp_layer_puppet_1',
    layers: [
      {
        id: 'comp_layer_puppet_1',
        name: 'Puppet Solid 01',
        type: 'solid',
        solidColor: '#1E2430',
        width: 1920,
        height: 1080,
        visible: true,
        solo: false,
        locked: false,
        opacity: 100,
        inFrame: 0,
        outFrame: 180,
        effect: createDefaultPuppetEffect(),
      },
      {
        id: 'comp_layer_backdrop',
        name: 'Studio Backdrop Solid',
        type: 'backdrop',
        solidColor: '#171C26',
        width: 1920,
        height: 1080,
        visible: true,
        solo: false,
        locked: false,
        opacity: 100,
        inFrame: 0,
        outFrame: 180,
        effect: null,
      },
    ],
  };
}
