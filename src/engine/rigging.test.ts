import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTrackAtFrame,
  interpolateKeyformDeltasForParam,
  evaluatePuppetRig,
  buildDeformedMeshVertices,
} from './rigging';
import { createInitialPhysicsState } from './physics';
import { createDefaultPuppetDocument } from '../state/defaultProject';
import type { ParameterTrack } from '../types/puppet';

test('timeline track evaluates linear, easeInOut, and hold keyframes accurately', () => {
  const track: ParameterTrack = {
    parameterId: 'ParamAngleX',
    stopwatchEnabled: true,
    keyframes: [
      { id: 'k1', frame: 0, value: -20, easing: 'linear' },
      { id: 'k2', frame: 20, value: 20, easing: 'hold' },
      { id: 'k3', frame: 40, value: 0, easing: 'easeInOut' },
    ],
  };

  assert.equal(evaluateTrackAtFrame(track, 0, 99), -20);
  assert.equal(evaluateTrackAtFrame(track, 10, 99), 0);
  assert.equal(evaluateTrackAtFrame(track, 30, 99), 20); // hold keeps k2 value until k3
  assert.equal(evaluateTrackAtFrame(track, 40, 99), 0);
  assert.equal(evaluateTrackAtFrame(track, 100, 99), 0);
});

test('keyform interpolation blends smoothly across parameter range', () => {
  const doc = createDefaultPuppetDocument();
  const faceAngleX = doc.keyforms.filter(
    (k) => k.parameterId === 'ParamAngleX' && k.targetId === 'def_face'
  );

  const midRight = interpolateKeyformDeltasForParam(faceAngleX, 15);
  assert.equal(Math.round(midRight.dx), 13);

  const farLeft = interpolateKeyformDeltasForParam(faceAngleX, -30);
  assert.equal(farLeft.dx, -26);
});

test('rig evaluation and mesh deformation propagate parent deformer hierarchy', () => {
  const doc = createDefaultPuppetDocument();
  const physState = createInitialPhysicsState(doc.physicsGroups);

  const neutral = evaluatePuppetRig(
    doc,
    { ParamAngleX: 0, ParamEyeLOpen: 1 },
    doc.physicsGroups,
    physState,
    0
  );
  const turned = evaluatePuppetRig(
    doc,
    { ParamAngleX: 30, ParamEyeLOpen: 0 },
    doc.physicsGroups,
    physState,
    0
  );

  const deformersById = Object.fromEntries(doc.deformers.map((d) => [d.id, d]));
  const eyeLayer = doc.layers.find((l) => l.psdLayerName === 'Eye_Left')!;
  const neutralVerts = buildDeformedMeshVertices(eyeLayer, deformersById, neutral);
  const turnedVerts = buildDeformedMeshVertices(eyeLayer, deformersById, turned);

  assert.equal(
    neutralVerts.length,
    (eyeLayer.meshCols + 1) * (eyeLayer.meshRows + 1)
  );
  // Turning Head Angle X right (+30) must move the child Eye_Left vertices to the right
  assert.ok(turnedVerts[0].x > neutralVerts[0].x + 25);
  // Closing Eye L (0) must vertically compress the eye mesh height
  const neutralH =
    Math.max(...neutralVerts.map((v) => v.y)) -
    Math.min(...neutralVerts.map((v) => v.y));
  const closedH =
    Math.max(...turnedVerts.map((v) => v.y)) -
    Math.min(...turnedVerts.map((v) => v.y));
  assert.ok(closedH < neutralH * 0.4);
});
