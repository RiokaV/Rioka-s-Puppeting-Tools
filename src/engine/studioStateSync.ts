import type {
  ArtMeshLayer,
  CompositionState,
  DeformerNode,
  KeyformDelta,
  ParameterFolder,
  ParameterTrack,
  PhysicsGroup,
  PreviewResolution,
  RigParameter,
  RiokaPuppetEffect,
} from '../types/puppet';

export interface SerializedLayerRigEdit {
  id: string;
  psdLayerName: string;
  visible: boolean;
  opacity: number;
  zIndex: number;
  parentDeformerId: string;
  parentLayerId?: string | null;
  groupLayerId: string | null;
  pivotX: number;
  pivotY: number;
  boneTransform: ArtMeshLayer['boneTransform'];
  meshCols: number;
  meshRows: number;
  vertexOffsets: ArtMeshLayer['vertexOffsets'];
  morphPins: ArtMeshLayer['morphPins'];
  basicLattice: ArtMeshLayer['basicLattice'];
}

export interface SerializedStudioState {
  format: 'RiokaStudioInstanceState';
  version: 1;
  savedAt: string;
  composition: {
    fps: number;
    durationFrames: number;
    currentFrame: number;
  };
  effectSettings: {
    offsetX: number;
    offsetY: number;
    scale: number;
    rotation: number;
    physicsEnabled: boolean;
    physicsStrength: number;
    windStrength: number;
    windTurbulence: number;
    autoBreath: boolean;
    autoBlink: boolean;
    connectToParameter: boolean;
    keyframeTarget: RiokaPuppetEffect['keyframeTarget'];
    renderQuality: PreviewResolution;
    customQualityPercent: number;
  };
  tracks: Record<string, ParameterTrack>;
  puppetRig: {
    parameters: RigParameter[];
    parameterFolders: ParameterFolder[];
    keyforms: KeyformDelta[];
    deformers: DeformerNode[];
    physicsGroups: PhysicsGroup[];
    layerEdits: SerializedLayerRigEdit[];
  };
}

/**
 * Counts total manual + physics keyframes across all parameter tracks.
 */
export function countTotalTrackKeyframes(
  tracks: Record<string, ParameterTrack>
): number {
  let total = 0;
  for (const track of Object.values(tracks)) {
    if (track && Array.isArray(track.keyframes)) {
      total += track.keyframes.length;
    }
  }
  return total;
}

/**
 * Serializes the active Studio animation keyframes, parameters, deformers, physics groups,
 * and mesh/bone edits for a single After Effects Solid Layer instance (omitting heavy base64 textures).
 */
export function serializeStudioStateForInstance(
  comp: CompositionState,
  effect: RiokaPuppetEffect
): string {
  const payload: SerializedStudioState = {
    format: 'RiokaStudioInstanceState',
    version: 1,
    savedAt: new Date().toISOString(),
    composition: {
      fps: Math.max(1, Math.min(120, Math.round(comp.fps || 30))),
      durationFrames: Math.max(1, Math.round(comp.durationFrames || 180)),
      currentFrame: Math.max(
        0,
        Math.min(comp.durationFrames || 180, Math.round(comp.currentFrame || 0))
      ),
    },
    effectSettings: {
      offsetX: effect.offsetX,
      offsetY: effect.offsetY,
      scale: effect.scale,
      rotation: effect.rotation,
      physicsEnabled: effect.physicsEnabled,
      physicsStrength: effect.physicsStrength,
      windStrength: effect.windStrength,
      windTurbulence: effect.windTurbulence,
      autoBreath: effect.autoBreath,
      autoBlink: effect.autoBlink,
      connectToParameter: effect.connectToParameter,
      keyframeTarget: effect.keyframeTarget,
      renderQuality: effect.renderQuality,
      customQualityPercent: effect.customQualityPercent,
    },
    tracks: effect.tracks,
    puppetRig: {
      parameters: effect.puppet.parameters,
      parameterFolders: effect.puppet.parameterFolders,
      keyforms: effect.puppet.keyforms,
      deformers: effect.puppet.deformers,
      physicsGroups: effect.puppet.physicsGroups,
      layerEdits: effect.puppet.layers.map((l) => ({
        id: l.id,
        psdLayerName: l.psdLayerName,
        visible: l.visible,
        opacity: l.opacity,
        zIndex: l.zIndex,
        parentDeformerId: l.parentDeformerId,
        parentLayerId: l.parentLayerId ?? null,
        groupLayerId: l.groupLayerId ?? null,
        pivotX: l.pivotX,
        pivotY: l.pivotY,
        boneTransform: l.boneTransform,
        meshCols: l.meshCols,
        meshRows: l.meshRows,
        vertexOffsets: l.vertexOffsets,
        morphPins: l.morphPins,
        basicLattice: l.basicLattice,
      })),
    },
  };
  return JSON.stringify(payload);
}

/**
 * Restores a previously applied Solid Layer Studio state into a base composition,
 * preserving all animation keyframes, parameter values, rig edits, and settings.
 * Returns { restored: false } if the payload is missing, `{ found: false }`, or invalid.
 */
export function applySavedStudioStateToComposition(
  baseComp: CompositionState,
  rawJson: string | unknown
): {
  restored: boolean;
  composition: CompositionState;
  keyframeCount: number;
} {
  try {
    const parsed =
      typeof rawJson === 'string'
        ? (JSON.parse(rawJson) as Partial<SerializedStudioState> & {
            found?: boolean;
          })
        : (rawJson as Partial<SerializedStudioState> & { found?: boolean });

    if (
      !parsed ||
      parsed.found === false ||
      parsed.format !== 'RiokaStudioInstanceState' ||
      !parsed.puppetRig ||
      !Array.isArray(parsed.puppetRig.parameters)
    ) {
      return { restored: false, composition: baseComp, keyframeCount: 0 };
    }

    const targetLayer =
      baseComp.layers.find(
        (l) => l.id === baseComp.selectedLayerId && l.effect !== null
      ) ?? baseComp.layers.find((l) => l.effect !== null);
    if (!targetLayer || !targetLayer.effect) {
      return { restored: false, composition: baseComp, keyframeCount: 0 };
    }

    const savedTracks = parsed.tracks ?? {};
    const mergedTracks: Record<string, ParameterTrack> = {};
    for (const p of parsed.puppetRig.parameters) {
      const existing = savedTracks[p.id];
      mergedTracks[p.id] = existing
        ? {
            parameterId: p.id,
            stopwatchEnabled: Boolean(existing.stopwatchEnabled),
            keyframes: Array.isArray(existing.keyframes)
              ? [...existing.keyframes].sort((a, b) => a.frame - b.frame)
              : [],
          }
        : {
            parameterId: p.id,
            stopwatchEnabled: false,
            keyframes: [],
          };
    }

    const editById = new Map<string, SerializedLayerRigEdit>();
    const editByName = new Map<string, SerializedLayerRigEdit>();
    if (Array.isArray(parsed.puppetRig.layerEdits)) {
      for (const edit of parsed.puppetRig.layerEdits) {
        editById.set(edit.id, edit);
        editByName.set(edit.psdLayerName, edit);
      }
    }

    const mergedLayers = targetLayer.effect.puppet.layers.map((layer) => {
      const edit =
        editById.get(layer.id) ?? editByName.get(layer.psdLayerName);
      if (!edit) return layer;
      return {
        ...layer,
        visible: edit.visible ?? layer.visible,
        opacity:
          typeof edit.opacity === 'number' ? edit.opacity : layer.opacity,
        zIndex: typeof edit.zIndex === 'number' ? edit.zIndex : layer.zIndex,
        parentDeformerId: edit.parentDeformerId || layer.parentDeformerId,
        parentLayerId: edit.parentLayerId ?? null,
        groupLayerId: edit.groupLayerId ?? null,
        pivotX: typeof edit.pivotX === 'number' ? edit.pivotX : layer.pivotX,
        pivotY: typeof edit.pivotY === 'number' ? edit.pivotY : layer.pivotY,
        boneTransform: edit.boneTransform ?? layer.boneTransform,
        meshCols: edit.meshCols ?? layer.meshCols,
        meshRows: edit.meshRows ?? layer.meshRows,
        vertexOffsets: Array.isArray(edit.vertexOffsets)
          ? edit.vertexOffsets
          : layer.vertexOffsets,
        morphPins: Array.isArray(edit.morphPins)
          ? edit.morphPins
          : layer.morphPins,
        basicLattice: edit.basicLattice ?? layer.basicLattice,
      };
    });

    const es = parsed.effectSettings;
    const nextEffect: RiokaPuppetEffect = {
      ...targetLayer.effect,
      offsetX: typeof es?.offsetX === 'number' ? es.offsetX : targetLayer.effect.offsetX,
      offsetY: typeof es?.offsetY === 'number' ? es.offsetY : targetLayer.effect.offsetY,
      scale: typeof es?.scale === 'number' ? es.scale : targetLayer.effect.scale,
      rotation: typeof es?.rotation === 'number' ? es.rotation : targetLayer.effect.rotation,
      physicsEnabled:
        typeof es?.physicsEnabled === 'boolean'
          ? es.physicsEnabled
          : targetLayer.effect.physicsEnabled,
      physicsStrength:
        typeof es?.physicsStrength === 'number'
          ? es.physicsStrength
          : targetLayer.effect.physicsStrength,
      windStrength:
        typeof es?.windStrength === 'number'
          ? es.windStrength
          : targetLayer.effect.windStrength,
      windTurbulence:
        typeof es?.windTurbulence === 'number'
          ? es.windTurbulence
          : targetLayer.effect.windTurbulence,
      autoBreath:
        typeof es?.autoBreath === 'boolean'
          ? es.autoBreath
          : targetLayer.effect.autoBreath,
      autoBlink:
        typeof es?.autoBlink === 'boolean'
          ? es.autoBlink
          : targetLayer.effect.autoBlink,
      connectToParameter:
        typeof es?.connectToParameter === 'boolean'
          ? es.connectToParameter
          : targetLayer.effect.connectToParameter,
      keyframeTarget:
        es?.keyframeTarget === 'after_effects' || es?.keyframeTarget === 'plugin'
          ? es.keyframeTarget
          : targetLayer.effect.keyframeTarget,
      renderQuality: es?.renderQuality ?? targetLayer.effect.renderQuality,
      customQualityPercent:
        typeof es?.customQualityPercent === 'number'
          ? es.customQualityPercent
          : targetLayer.effect.customQualityPercent,
      tracks: mergedTracks,
      puppet: {
        ...targetLayer.effect.puppet,
        parameters: parsed.puppetRig.parameters,
        parameterFolders: Array.isArray(parsed.puppetRig.parameterFolders)
          ? parsed.puppetRig.parameterFolders
          : targetLayer.effect.puppet.parameterFolders,
        keyforms: Array.isArray(parsed.puppetRig.keyforms)
          ? parsed.puppetRig.keyforms
          : targetLayer.effect.puppet.keyforms,
        deformers: Array.isArray(parsed.puppetRig.deformers)
          ? parsed.puppetRig.deformers
          : targetLayer.effect.puppet.deformers,
        physicsGroups: Array.isArray(parsed.puppetRig.physicsGroups)
          ? parsed.puppetRig.physicsGroups
          : targetLayer.effect.puppet.physicsGroups,
        layers: mergedLayers,
      },
    };

    const nextFps =
      typeof parsed.composition?.fps === 'number'
        ? Math.max(1, Math.min(120, Math.round(parsed.composition.fps)))
        : baseComp.fps;
    const nextDur =
      typeof parsed.composition?.durationFrames === 'number'
        ? Math.max(1, Math.round(parsed.composition.durationFrames))
        : baseComp.durationFrames;
    const nextFrame =
      typeof parsed.composition?.currentFrame === 'number'
        ? Math.max(0, Math.min(nextDur, Math.round(parsed.composition.currentFrame)))
        : baseComp.currentFrame;

    const nextComp: CompositionState = {
      ...baseComp,
      fps: nextFps,
      durationFrames: nextDur,
      currentFrame: nextFrame,
      isPlaying: false,
      layers: baseComp.layers.map((l) =>
        l.id === targetLayer.id ? { ...l, effect: nextEffect } : l
      ),
    };

    return {
      restored: true,
      composition: nextComp,
      keyframeCount: countTotalTrackKeyframes(mergedTracks),
    };
  } catch {
    return { restored: false, composition: baseComp, keyframeCount: 0 };
  }
}
