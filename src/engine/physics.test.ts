import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialPhysicsState,
  stepPhysicsSimulation,
  computePhysicsOutputDeltas,
} from './physics';
import { createDefaultPuppetDocument } from '../state/defaultProject';

test('physics simulation initializes pendulum chains at rest with valid coordinates', () => {
  const doc = createDefaultPuppetDocument();
  const state = createInitialPhysicsState(doc.physicsGroups);

  assert.equal(Object.keys(state).length, doc.physicsGroups.length);
  for (const group of doc.physicsGroups) {
    const runtime = state[group.id];
    assert.ok(runtime);
    assert.equal(runtime.links.length, group.pendulums.length);
    for (const link of runtime.links) {
      assert.equal(link.angle, 0);
      assert.equal(link.angularVelocity, 0);
      assert.ok(Number.isFinite(link.worldX));
      assert.ok(Number.isFinite(link.worldY));
    }
  }
});

test('physics responds to head impulse and wind without producing NaN', () => {
  const doc = createDefaultPuppetDocument();
  let state = createInitialPhysicsState(doc.physicsGroups);

  // Apply sudden head movement and strong wind over 20 steps
  for (let i = 0; i < 20; i++) {
    state = stepPhysicsSimulation(doc.physicsGroups, state, {
      dt: 1 / 60,
      time: i / 60,
      paramValues: { ParamAngleX: i < 10 ? 28 : -28, ParamBodyAngleX: 8 },
      windStrength: 1.4,
      windTurbulence: 0.4,
      strengthMultiplier: 1.0,
      impulseX: i === 0 ? 18 : 0,
    });
  }

  const tailLeft = state.phys_tail_l;
  assert.ok(tailLeft);
  assert.ok(
    Math.abs(tailLeft.links[0].angle) > 0.02,
    'expected twin-tail pendulum to deflect under impulse and wind'
  );
  for (const link of tailLeft.links) {
    assert.ok(Number.isFinite(link.angle));
    assert.ok(Number.isFinite(link.angularVelocity));
  }

  const deltas = computePhysicsOutputDeltas(doc.physicsGroups, state, 1.0);
  assert.ok(deltas.deformers.def_hair_tail_l);
  assert.ok(Math.abs(deltas.deformers.def_hair_tail_l.bendX) > 0.01);
});

test('physics settles back near equilibrium when excitation stops', () => {
  const doc = createDefaultPuppetDocument();
  let state = createInitialPhysicsState(doc.physicsGroups);

  // Excite with impulse
  state = stepPhysicsSimulation(doc.physicsGroups, state, {
    dt: 1 / 60,
    time: 0,
    paramValues: { ParamAngleX: 25 },
    windStrength: 0,
    windTurbulence: 0,
    strengthMultiplier: 1.0,
    impulseX: 22,
  });

  // Let it damp out for 300 frames (5 seconds)
  for (let i = 1; i <= 300; i++) {
    state = stepPhysicsSimulation(doc.physicsGroups, state, {
      dt: 1 / 60,
      time: i / 60,
      paramValues: { ParamAngleX: 0 },
      windStrength: 0,
      windTurbulence: 0,
      strengthMultiplier: 1.0,
    });
  }

  const frontHair = state.phys_hair_front;
  assert.ok(Math.abs(frontHair.links[0].angularVelocity) < 0.05);
  assert.ok(Math.abs(frontHair.links[0].angle) < 0.08);
});
