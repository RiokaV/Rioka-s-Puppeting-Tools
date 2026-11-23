import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialComposition } from '../state/defaultProject';
import {
  applySavedStudioStateToComposition,
  countTotalTrackKeyframes,
  serializeStudioStateForInstance,
} from './studioStateSync';
import {
  createSettledPhysicsState,
  stepPhysicsSimulation,
} from './physics';
import { applyMeshWarpLocal, evaluateTrackAtFrame } from './rigging';
import { upsertKeyframeAtFrame } from './morphTools';
import { buildAppliedParamsTxt } from './rpfCodec';
import { buildAeSdkFiles } from './aeSdkGenerator';

test('Bug #1: createSettledPhysicsState eliminates frame-0 kick and clamps fast head swings', () => {
  const comp = createInitialComposition();
  const effect = comp.layers[0].effect!;
  const groups = effect.puppet.physicsGroups;

  const settled = createSettledPhysicsState(groups, {
    ParamAngleX: -30,
    ParamAngleY: 15,
    ParamAngleZ: -12,
  });

  // Every group's prevInput should match frame-0 pose so there is zero frame-0 impulse
  for (const g of groups) {
    const gs = settled[g.id];
    assert.ok(gs, `Settled state missing group ${g.id}`);
    for (const p of gs.links) {
      assert.equal(p.angle, 0);
      assert.equal(p.angularVelocity, 0);
    }
  }

  // Step through a sharp -30 -> +30 swing and verify angles stay attached and bounded
  let state = settled;
  for (let f = 1; f <= 45; f++) {
    const x = f < 15 ? -30 : f < 30 ? 30 : 0;
    state = stepPhysicsSimulation(groups, state, {
      dt: 1 / 30,
      time: f / 30,
      paramValues: { ParamAngleX: x, ParamAngleY: 0, ParamAngleZ: 0 },
      windStrength: effect.windStrength,
      windTurbulence: effect.windTurbulence,
      strengthMultiplier: 1.0,
    });
    for (const g of groups) {
      for (const p of state[g.id].links) {
        assert.ok(Number.isFinite(p.angle), 'Pendulum angle must stay finite');
        assert.ok(
          Math.abs(p.angle) <= Math.PI * 0.36 + 1e-4,
          `Pendulum angle ${p.angle} exceeded safe twin-tail attachment bound`
        );
      }
    }
  }
});

test('Bug #1: applyMeshWarpLocal with anchorBendAtPivotZero keeps twin-tail root anchored at ribbon', () => {
  const warp = { bendX: 0.9, bendY: 0.2, squeezeX: 0, squeezeY: 0 };

  // Above or at pivot (ny <= 0): root stays 100% anchored with zero bendX displacement
  const rootPt = applyMeshWarpLocal(0, -0.4, 80, 140, warp, true);
  assert.equal(rootPt.x, 0, 'Twin-tail root above pivot must not drift horizontally');

  const pivotPt = applyMeshWarpLocal(0, 0, 80, 140, warp, true);
  assert.equal(pivotPt.x, 0, 'Twin-tail pivot must remain pinned');

  // Lower tip (ny = 1.0): curves smoothly in bendX direction
  const tipPt = applyMeshWarpLocal(0, 1.0, 80, 140, warp, true);
  assert.ok(tipPt.x > 20, `Lower twin-tail tip should sway smoothly, got dx=${tipPt.x}`);
});

test('Bug #2: buildAppliedParamsTxt exports autoBreath flag cleanly', () => {
  const comp = createInitialComposition();
  const effect = comp.layers[0].effect!;

  const enabledTxt = buildAppliedParamsTxt(comp, { ...effect, autoBreath: true }, 90);
  assert.match(enabledTxt, /^autoBreath=1$/m);
  assert.match(enabledTxt, /^frameCount=90$/m);

  const disabledTxt = buildAppliedParamsTxt(comp, { ...effect, autoBreath: false }, 0);
  assert.match(disabledTxt, /^autoBreath=0$/m);
});

test('Bug #3: non-Head-X/Y parameters auto-record and evaluate keyframes accurately across frames', () => {
  const comp = createInitialComposition();
  const effect = comp.layers[0].effect!;
  let tracks = { ...effect.tracks };

  const testedParams: Array<{ id: string; v0: number; v30: number }> = [
    { id: 'ParamAngleZ', v0: -15, v30: 20 },
    { id: 'ParamEyeLOpen', v0: 1, v30: 0 },
    { id: 'ParamEyeballX', v0: -0.8, v30: 0.8 },
    { id: 'ParamBodyAngleX', v0: -6, v30: 8 },
    { id: 'ParamMouthOpenY', v0: 0.1, v30: 0.9 },
    { id: 'ParamBreath', v0: 0, v30: 1 },
    { id: 'ParamCustom_Test', v0: -0.5, v30: 0.75 },
  ];

  for (const item of testedParams) {
    tracks = upsertKeyframeAtFrame(tracks, item.id, 0, item.v0);
    tracks = upsertKeyframeAtFrame(tracks, item.id, 30, item.v30);
    assert.equal(tracks[item.id].stopwatchEnabled, true);
    assert.equal(tracks[item.id].keyframes.length, 2);
    assert.equal(evaluateTrackAtFrame(tracks[item.id], 0, 0), item.v0);
    assert.equal(evaluateTrackAtFrame(tracks[item.id], 30, 0), item.v30);
    const mid = evaluateTrackAtFrame(tracks[item.id], 15, 0);
    const lo = Math.min(item.v0, item.v30);
    const hi = Math.max(item.v0, item.v30);
    assert.ok(mid >= lo && mid <= hi, `Midpoint ${mid} out of range [${lo}, ${hi}] for ${item.id}`);
  }
});

test('Bug #4: per-Solid-Layer state persists all keyframes across Apply and resets cleanly for new Solid Layers', () => {
  const comp = createInitialComposition();
  const effect = comp.layers[0].effect!;

  // New Solid Layer starts clean with 0 keyframes
  assert.equal(countTotalTrackKeyframes(effect.tracks), 0);

  // User animates multiple parameters and enables Connect to Parameter
  let tracks = { ...effect.tracks };
  tracks = upsertKeyframeAtFrame(tracks, 'ParamAngleX', 0, -24);
  tracks = upsertKeyframeAtFrame(tracks, 'ParamAngleX', 30, 28);
  tracks = upsertKeyframeAtFrame(tracks, 'ParamBodyAngleX', 15, 7.5);
  tracks = upsertKeyframeAtFrame(tracks, 'ParamMouthOpenY', 20, 0.85);

  const editedEffect = {
    ...effect,
    connectToParameter: true,
    autoBreath: true,
    physicsStrength: 0.85,
    tracks,
    puppet: {
      ...effect.puppet,
      parameters: effect.puppet.parameters.map((p) =>
        p.id === 'ParamAngleX' ? { ...p, value: 28 } : p
      ),
    },
  };

  const savedJson = serializeStudioStateForInstance(
    { ...comp, fps: 24, currentFrame: 30 },
    editedEffect
  );

  // Re-opening Studio on the SAME Solid Layer restores all keyframes & settings
  const freshBaseSameLayer = createInitialComposition();
  const restored = applySavedStudioStateToComposition(freshBaseSameLayer, savedJson);
  assert.equal(restored.restored, true);
  assert.equal(restored.keyframeCount, 4);
  assert.equal(restored.composition.fps, 24);
  assert.equal(restored.composition.currentFrame, 30);

  const restoredEffect = restored.composition.layers[0].effect!;
  assert.equal(restoredEffect.connectToParameter, true);
  assert.equal(restoredEffect.physicsStrength, 0.85);
  assert.equal(restoredEffect.tracks.ParamAngleX.keyframes.length, 2);
  assert.equal(restoredEffect.tracks.ParamBodyAngleX.keyframes.length, 1);
  assert.equal(restoredEffect.tracks.ParamMouthOpenY.keyframes.length, 1);

  // Adding the plugin to a NEW Solid Layer returns {"found":false} -> stays clean with 0 keyframes
  const freshBaseNewLayer = createInitialComposition();
  const newLayerResult = applySavedStudioStateToComposition(
    freshBaseNewLayer,
    JSON.stringify({ found: false })
  );
  assert.equal(newLayerResult.restored, false);
  assert.equal(newLayerResult.keyframeCount, 0);
  assert.equal(
    countTotalTrackKeyframes(newLayerResult.composition.layers[0].effect!.tracks),
    0
  );
});

test('C++ AE SDK & Offline Studio Host emit per-instance persistence, live breathing, and premul bilinear fixes', () => {
  const comp = createInitialComposition();
  const files = buildAeSdkFiles(comp, comp.layers[0].effect!.puppet);
  const findFile = (suffix: string) =>
    files.find((f) => f.path.endsWith(suffix))?.content ?? '';

  const header = findFile('RiokasPuppetingTools.h');
  const pipl = findFile('RiokasPuppetingToolsPiPL.r');
  const cpp = findFile('RiokasPuppetingTools.cpp');
  const host = findFile('RiokaStudioMain.cpp');

  // PiPL & header outFlags must stay strictly identical (0x02000004 = 33554436)
  assert.ok(header.includes('PF_OutFlag_DEEP_COLOR_AWARE | PF_OutFlag_NON_PARAM_VARY'));
  assert.ok(pipl.includes('0x02000004'));
  assert.ok(header.includes('struct RiokaSequenceData'));

  // Per-Solid-Layer sequence lifecycle & instanceId routing
  assert.ok(cpp.includes('PF_Cmd_SEQUENCE_SETUP'));
  assert.ok(cpp.includes('PF_Cmd_SEQUENCE_RESETUP'));
  assert.ok(cpp.includes('PF_Cmd_SEQUENCE_FLATTEN'));
  assert.ok(cpp.includes('PF_Cmd_SEQUENCE_SETDOWN'));
  assert.ok(cpp.includes('--ae-modal --instance='));

  // Exact Studio FPS sync, live Solid Layer breathing, premul bilinear, no bogus windWave
  assert.ok(cpp.includes('std::llround(timeSec * static_cast<double>(applied.fps))'));
  assert.ok(cpp.includes('autoBreath'));
  assert.ok(cpp.includes('breathAnchorY'));
  assert.ok(cpp.includes('WritePremulRawPixel'));
  assert.ok(!cpp.includes('windWave'), 'Whole-body windWave sway must be removed');

  // Standalone Studio host per-instance state endpoints
  assert.ok(host.includes('--instance='));
  assert.ok(host.includes('/api/load-studio-state'));
  assert.ok(host.includes('/api/save-studio-state'));
  assert.ok(host.includes('studio_state.json'));

  // Browser isolation & standalone lifecycle (must NEVER scan desktop window titles or close Opera/user browser)
  assert.ok(
    !host.includes('FindExistingStudioWindow'),
    'Must not search global desktop window titles (prevents closing user browsers like Opera GX)'
  );
  assert.ok(host.includes('CreateJobObjectA'));
  assert.ok(host.includes('AssignProcessToJobObject'));
  assert.ok(host.includes('JobObjectBasicProcessIdList'));
  assert.ok(host.includes('CloseOwnedStudioWindows'));
  assert.ok(host.includes('RuntimeSessions'));
  assert.ok(host.includes('--disable-background-mode'));
  assert.ok(host.includes('QueryAppPathRegistry'));
  assert.ok(host.includes('/api/studio-heartbeat'));
  assert.ok(host.includes('/api/studio-unload'));

  const cmake = findFile('CMakeLists.txt');
  assert.ok(cmake.includes('advapi32'));
});
