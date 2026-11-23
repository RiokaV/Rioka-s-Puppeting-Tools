import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyNewPsdImportToEffect,
  buildDemoPsdLayers,
  mergeRenewedPsdLayers,
} from './psdPipeline';
import {
  createDefaultPuppetDocument,
  createDefaultPuppetEffect,
  createInitialComposition,
} from '../state/defaultProject';
import { evaluatePuppetRig } from './rigging';
import { createInitialPhysicsState } from './physics';
import { buildAppliedParamsTxt } from './rpfCodec';

test('renewable PSD merge preserves existing layer IDs, deformers, mesh divisions, and vertex edits', () => {
  const doc = createDefaultPuppetDocument();

  // Simulate user editing a vertex offset and mesh grid on Hair_Front_Bangs
  const targetIdx = doc.layers.findIndex(
    (l) => l.psdLayerName === 'Hair_Front_Bangs'
  );
  assert.ok(targetIdx >= 0);
  const originalId = doc.layers[targetIdx].id;
  const originalDeformer = doc.layers[targetIdx].parentDeformerId;
  doc.layers[targetIdx].vertexOffsets[0] = { dx: 12.5, dy: -6.25 };

  // Renew with Festival PSD + an extra newly added PSD layer
  const festivalLayers = buildDemoPsdLayers('festival');
  festivalLayers.push({
    psdLayerName: 'Accessory_Lantern',
    name: 'Festival Hairpin',
    x: 560,
    y: 260,
    width: 80,
    height: 80,
    opacity: 1,
    visible: true,
    zIndex: festivalLayers.length,
    textureDataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  });

  const renewed = mergeRenewedPsdLayers(
    doc,
    festivalLayers,
    'Rioka_Festival_Rev2.psd',
    2048,
    2048,
    'demo-festival'
  );

  assert.equal(renewed.manifest.revision, doc.psd.revision + 1);
  assert.equal(renewed.manifest.matchedLayers, doc.layers.length);
  assert.equal(renewed.manifest.addedLayers, 1);

  const renewedBangs = renewed.layers.find(
    (l) => l.psdLayerName === 'Hair_Front_Bangs'
  );
  assert.ok(renewedBangs);
  assert.equal(renewedBangs.id, originalId);
  assert.equal(renewedBangs.parentDeformerId, originalDeformer);
  assert.deepEqual(renewedBangs.vertexOffsets[0], { dx: 12.5, dy: -6.25 });
  assert.equal(renewedBangs.psdStatus, 'matched');

  const addedPin = renewed.layers.find(
    (l) => l.psdLayerName === 'Accessory_Lantern'
  );
  assert.ok(addedPin);
  assert.equal(addedPin.psdStatus, 'added');
});

test('importing a new PSD clears default parameters, folders, keyforms, tracks, physics and turns Auto-Breath OFF', () => {
  const baseEffect = createDefaultPuppetEffect();
  assert.ok(baseEffect.puppet.parameters.length > 0);
  assert.equal(baseEffect.autoBreath, true);

  const imported = applyNewPsdImportToEffect(
    baseEffect,
    [
      {
        psdLayerName: 'Body_Layer',
        name: 'Body Layer',
        x: 512,
        y: 620,
        width: 400,
        height: 460,
        opacity: 1,
        visible: true,
        zIndex: 0,
        textureDataUrl:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
      },
      {
        psdLayerName: 'Head_Layer',
        name: 'Head Layer',
        x: 512,
        y: 360,
        width: 300,
        height: 300,
        opacity: 1,
        visible: true,
        zIndex: 1,
        textureDataUrl:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
      },
    ],
    'My_Custom_Character.psd',
    1600,
    1600
  );

  assert.equal(imported.puppet.name, 'My_Custom_Character');
  assert.equal(imported.puppet.psd.fileName, 'My_Custom_Character.psd');
  assert.equal(imported.puppet.psd.sourceType, 'user-psd');
  assert.equal(imported.puppet.psd.revision, 1);
  assert.equal(imported.puppet.layers.length, 2);

  // All built-in parameters, folders, keyforms, physics groups, and tracks are cleared
  assert.equal(imported.puppet.parameters.length, 0);
  assert.equal(imported.puppet.parameterFolders.length, 0);
  assert.equal(imported.puppet.keyforms.length, 0);
  assert.equal(imported.puppet.physicsGroups.length, 0);
  assert.deepEqual(imported.tracks, {});

  // Automatic breathing is OFF by default after importing a new PSD
  assert.equal(imported.autoBreath, false);

  // Exported AE params text reflects autoBreath=0 and paramCount=0
  const comp = createInitialComposition();
  const txtOff = buildAppliedParamsTxt(comp, imported, 0);
  assert.match(txtOff, /^autoBreath=0$/m);
  assert.match(txtOff, /^paramCount=0$/m);

  // When Auto-Breath is OFF, rig stays completely still
  const physState = createInitialPhysicsState(imported.puppet.physicsGroups);
  const rigStill = evaluatePuppetRig(imported.puppet, {}, [], physState, 0);
  assert.equal(rigStill.deformerTransforms.def_body.dy, 0);
  assert.equal(rigStill.deformerTransforms.def_body.scaleY, 1);

  // When user toggles Auto-Breath back ON, procedural breathing fallback animates torso & head
  const toggledOn = { ...imported, autoBreath: true };
  const txtOn = buildAppliedParamsTxt(comp, toggledOn, 0);
  assert.match(txtOn, /^autoBreath=1$/m);

  const rigBreathing = evaluatePuppetRig(
    toggledOn.puppet,
    { ParamBreath: 0.7 },
    [],
    physState,
    0
  );
  assert.ok(
    rigBreathing.deformerTransforms.def_body.dy < -5,
    'expected torso lift when Auto-Breath is toggled ON for a custom PSD'
  );
  assert.ok(
    rigBreathing.deformerTransforms.def_body.scaleY > 1.01,
    'expected subtle chest expansion when Auto-Breath is toggled ON for a custom PSD'
  );
  assert.ok(
    rigBreathing.deformerTransforms.def_head.dy < -2,
    'expected subtle head lift when Auto-Breath is toggled ON for a custom PSD'
  );
});

