import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEasingToKeyframes,
  computeAudioFramePeaks,
  createHistoryStack,
  evaluateCubicBezier,
  generateAutoBlinkKeyframes,
  generateDemoVoiceSamples,
  generateLipSyncKeyframes,
  pushHistorySnapshot,
  redoHistory,
  reflectKeyformDeltas,
  undoHistory,
  wouldCreateLayerParentCycle,
} from './studioFeatures';
import {
  evaluatePuppetRig,
  evaluateTrackAtFrame,
  transformLayerPointToModel,
} from './rigging';
import { createInitialPhysicsState } from './physics';
import { createDefaultPuppetDocument } from '../state/defaultProject';

test('Undo/Redo History: pushes, coalesces continuous drags, undoes and redoes accurately', () => {
  let stack = createHistoryStack<{ count: number }>();
  // Continuous drag with same tag inside 450ms should keep only initial pre-drag snapshot
  stack = pushHistorySnapshot(stack, { count: 0 }, { tag: 'drag', nowMs: 1000 });
  stack = pushHistorySnapshot(stack, { count: 1 }, { tag: 'drag', nowMs: 1100 });
  assert.equal(stack.past.length, 1);

  // Separate discrete action after coalesce window creates a second step
  stack = pushHistorySnapshot(stack, { count: 2 }, { tag: 'expr', nowMs: 2000 });
  assert.equal(stack.past.length, 2);

  const u1 = undoHistory(stack, { count: 3 });
  assert.deepEqual(u1.restored, { count: 2 });
  assert.equal(u1.stack.past.length, 1);
  assert.equal(u1.stack.future.length, 1);

  const u2 = undoHistory(u1.stack, { count: 2 });
  assert.deepEqual(u2.restored, { count: 0 });
  assert.equal(u2.stack.past.length, 0);

  const r1 = redoHistory(u2.stack, { count: 0 });
  assert.deepEqual(r1.restored, { count: 2 });
  assert.equal(r1.stack.past.length, 1);
});

test('Cubic Bezier Easing: evaluates linear, ease, overshoot, and applies to tracks', () => {
  assert.equal(evaluateCubicBezier(0, 0.42, 0, 0.58, 1), 0);
  assert.equal(evaluateCubicBezier(1, 0.42, 0, 0.58, 1), 1);
  // Symmetric easy ease at midpoint should be 0.5
  assert.ok(Math.abs(evaluateCubicBezier(0.5, 0.42, 0, 0.58, 1) - 0.5) < 1e-3);
  // Overshoot anime pop curve should exceed 1.0 before settling at 1.0
  assert.ok(evaluateCubicBezier(0.55, 0.22, 1.35, 0.36, 1.0) > 1.0);

  const baseTracks = {
    ParamAngleX: {
      parameterId: 'ParamAngleX',
      stopwatchEnabled: true,
      keyframes: [
        { id: 'k0', frame: 0, value: 0, easing: 'linear' as const },
        { id: 'k1', frame: 20, value: 30, easing: 'linear' as const },
      ],
    },
  };
  const updated = applyEasingToKeyframes(
    baseTracks,
    [{ parameterId: 'ParamAngleX', keyframeId: 'k0' }],
    'bezier',
    [0.16, 1.0, 0.3, 1.0]
  );
  // Snappy-out at t=0.5 (frame 10) should be far past linear midpoint (15)
  const valAt10 = evaluateTrackAtFrame(updated.ParamAngleX, 10, 0);
  assert.ok(valAt10 > 24, `Expected snappy-out > 24, got ${valAt10}`);
});

test('Bone Parenting: prevents cycles and propagates parent bone transforms to children', () => {
  const doc = createDefaultPuppetDocument();
  const bangs =
    doc.layers.find((l) => l.name === 'Hair Front Bangs') ?? doc.layers[1];
  const clips =
    doc.layers.find((l) => l.name === 'Hair Ribbon Clips') ?? doc.layers[0];

  assert.equal(wouldCreateLayerParentCycle(doc.layers, clips.id, clips.id), true);
  assert.equal(wouldCreateLayerParentCycle(doc.layers, clips.id, bangs.id), false);

  clips.parentLayerId = bangs.id;
  assert.equal(wouldCreateLayerParentCycle(doc.layers, bangs.id, clips.id), true);

  // Move & rotate parent bone (bangs), verify child layer (clips) moves in world space
  bangs.boneTransform = { dx: 40, dy: -20, rotation: 0, scaleX: 1, scaleY: 1 };
  const deformersById = Object.fromEntries(doc.deformers.map((d) => [d.id, d]));
  const layersById = Object.fromEntries(doc.layers.map((l) => [l.id, l]));
  const rig = evaluatePuppetRig(
    doc,
    {},
    doc.physicsGroups,
    createInitialPhysicsState(doc.physicsGroups),
    0
  );

  const childWorld = transformLayerPointToModel(
    { x: clips.x, y: clips.y },
    clips,
    deformersById,
    rig,
    layersById
  );
  assert.ok(
    Math.abs(childWorld.x - (clips.x + 40)) < 1e-4,
    `Expected child X to inherit +40 from parent, got ${childWorld.x}`
  );
  assert.ok(
    Math.abs(childWorld.y - (clips.y - 20)) < 1e-4,
    `Expected child Y to inherit -20 from parent, got ${childWorld.y}`
  );
});

test('Audio Lip-Sync & Auto-Blink: generates speech mouth keyframes and natural eye blinks', () => {
  const samples = generateDemoVoiceSamples(8000, 6);
  const peaks = computeAudioFramePeaks(samples, 8000, 30, 180);
  assert.equal(peaks.length, 181);
  assert.ok(Math.max(...peaks) > 0.9);
  assert.ok(Math.min(...peaks) < 0.05);

  const lipKfs = generateLipSyncKeyframes(peaks);
  assert.ok(lipKfs.length >= 10, `Expected >= 10 lip-sync keyframes, got ${lipKfs.length}`);
  assert.ok(lipKfs.some((k) => k.value > 0.5), 'Expected open mouth peaks');
  assert.ok(lipKfs.some((k) => k.value === 0), 'Expected closed mouth silences');

  const blinks = generateAutoBlinkKeyframes(180, 30, 2.0);
  assert.equal(blinks.eyeL.length, blinks.eyeR.length);
  assert.ok(blinks.eyeL.some((k) => k.value === 0), 'Expected closed blink dips');
  assert.ok(blinks.eyeL.some((k) => k.value === 1), 'Expected open eye baseline');
});

test('Reflect Keyform: mirrors left-side deformation cleanly onto right side', () => {
  const doc = createDefaultPuppetDocument();
  const param = doc.parameters.find((p) => p.id === 'ParamAngleX')!;
  // Modify left keyform (-30) on def_head and reflect minToMax
  const customized = doc.keyforms.map((k) =>
    k.parameterId === 'ParamAngleX' &&
    k.targetId === 'def_head' &&
    k.keyformValue === -30
      ? {
          ...k,
          dx: -55,
          dy: 12,
          rotation: -14,
          skewY: -7,
          meshWarp: { bendX: -0.3, bendY: 0.2, squeezeX: -0.15, squeezeY: 0.05 },
        }
      : k
  );

  const reflected = reflectKeyformDeltas(customized, param, 'minToMax');
  const mirroredRight = reflected.find(
    (k) =>
      k.parameterId === 'ParamAngleX' &&
      k.targetId === 'def_head' &&
      k.keyformValue === 30
  );
  assert.ok(mirroredRight, 'Expected mirrored right keyform at +30');
  assert.equal(mirroredRight.dx, 55);
  assert.equal(mirroredRight.dy, 12);
  assert.equal(mirroredRight.rotation, 14);
  assert.equal(mirroredRight.skewY, 7);
  assert.equal(mirroredRight.meshWarp.bendX, 0.3);
  assert.equal(mirroredRight.meshWarp.bendY, 0.2);
});
