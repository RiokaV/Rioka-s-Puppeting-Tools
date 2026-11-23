import type {
  PhysicsGroup,
  PhysicsGroupRuntimeState,
  PhysicsSimulationState,
  PendulumLinkState,
} from '../types/puppet';

export interface PhysicsStepOptions {
  dt: number;
  time: number;
  paramValues: Record<string, number>;
  windStrength: number;
  windTurbulence: number;
  strengthMultiplier: number;
  impulseX?: number;
  impulseY?: number;
}

const MAX_DT = 1 / 24;
const MAX_ANGLE = Math.PI * 0.36;
const MAX_ANGULAR_VELOCITY = 14;
const MAX_DELTA_INPUT_LINEAR = 260;
const MAX_DELTA_INPUT_ANGLE = 200;

export function createInitialPhysicsState(
  groups: PhysicsGroup[]
): PhysicsSimulationState {
  const state: PhysicsSimulationState = {};

  for (const group of groups) {
    let curX = group.anchorX;
    let curY = group.anchorY;
    const links: PendulumLinkState[] = group.pendulums.map((cfg) => {
      curY += cfg.length;
      return {
        angle: 0,
        angularVelocity: 0,
        worldX: curX,
        worldY: curY,
      };
    });

    state[group.id] = {
      groupId: group.id,
      anchorWorldX: group.anchorX,
      anchorWorldY: group.anchorY,
      prevInputX: 0,
      prevInputY: 0,
      prevInputAngle: 0,
      links,
    };
  }

  return state;
}

/**
 * Initializes pendulum physics already settled at the supplied frame-0 parameter values,
 * preventing an artificial velocity spike on frame 0 when the starting pose is non-neutral.
 */
export function createSettledPhysicsState(
  groups: PhysicsGroup[],
  paramValues: Record<string, number>
): PhysicsSimulationState {
  const state = createInitialPhysicsState(groups);
  for (const group of groups) {
    const runtime = state[group.id];
    if (!runtime) continue;
    const initialInput = computeGroupInput(group, paramValues);
    const anchorWorldX = group.anchorX + initialInput.inputX * 0.55;
    const anchorWorldY = group.anchorY + initialInput.inputY * 0.45;
    let curX = anchorWorldX;
    let curY = anchorWorldY;
    const links: PendulumLinkState[] = group.pendulums.map((cfg) => {
      curY += cfg.length;
      return {
        angle: 0,
        angularVelocity: 0,
        worldX: curX,
        worldY: curY,
      };
    });
    state[group.id] = {
      ...runtime,
      anchorWorldX,
      anchorWorldY,
      prevInputX: initialInput.inputX,
      prevInputY: initialInput.inputY,
      prevInputAngle: initialInput.inputAngle,
      links,
    };
  }
  return state;
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(min, Math.min(max, v));
}

function computeGroupInput(
  group: PhysicsGroup,
  paramValues: Record<string, number>
): { inputX: number; inputY: number; inputAngle: number } {
  let inputX = 0;
  let inputY = 0;
  let inputAngle = 0;

  for (const binding of group.inputs) {
    const val = paramValues[binding.parameterId] ?? 0;
    const contribution = val * binding.weight * binding.scale;
    if (binding.type === 'positionX') {
      inputX += contribution;
    } else if (binding.type === 'positionY') {
      inputY += contribution;
    } else if (binding.type === 'angle') {
      inputAngle += contribution;
    }
  }

  return { inputX, inputY, inputAngle };
}

/**
 * Deterministic multi-link damped spring-pendulum integrator with reaction delay.
 * Models Live2D Cubism Physics3 pendulum chains where moving Param 1 drives secondary deformers & Params 2/3.
 */
export function stepPhysicsSimulation(
  groups: PhysicsGroup[],
  prevState: PhysicsSimulationState,
  options: PhysicsStepOptions
): PhysicsSimulationState {
  const safeDt = clamp(options.dt, 0.001, MAX_DT);
  const substeps = 2;
  const subDt = safeDt / substeps;
  const strength = clamp(options.strengthMultiplier, 0, 2.5);
  const nextState: PhysicsSimulationState = {};

  for (const group of groups) {
    const existing = prevState[group.id];
    const baseState: PhysicsGroupRuntimeState =
      existing && existing.links.length === group.pendulums.length
        ? existing
        : createInitialPhysicsState([group])[group.id];

    const rawInput = computeGroupInput(group, options.paramValues);
    // Delay / reaction lag smooths incoming parameter motion
    const delayFactor = clamp(1 - (group.delay ?? 0.25) * 0.72, 0.12, 1);
    const inputX =
      baseState.prevInputX + (rawInput.inputX - baseState.prevInputX) * delayFactor;
    const inputY =
      baseState.prevInputY + (rawInput.inputY - baseState.prevInputY) * delayFactor;
    const inputAngle =
      baseState.prevInputAngle +
      (rawInput.inputAngle - baseState.prevInputAngle) * delayFactor;

    if (!group.enabled || strength <= 0.001) {
      let curX = group.anchorX + inputX * 0.35;
      let curY = group.anchorY + inputY * 0.35;
      const idleLinks: PendulumLinkState[] = group.pendulums.map((cfg) => {
        curY += cfg.length;
        return {
          angle: 0,
          angularVelocity: 0,
          worldX: curX,
          worldY: curY,
        };
      });

      nextState[group.id] = {
        groupId: group.id,
        anchorWorldX: group.anchorX + inputX * 0.35,
        anchorWorldY: group.anchorY + inputY * 0.35,
        prevInputX: inputX,
        prevInputY: inputY,
        prevInputAngle: inputAngle,
        links: idleLinks,
      };
      continue;
    }

    const deltaInputX = clamp(
      (inputX - baseState.prevInputX) / safeDt,
      -MAX_DELTA_INPUT_LINEAR,
      MAX_DELTA_INPUT_LINEAR
    );
    const deltaInputY = clamp(
      (inputY - baseState.prevInputY) / safeDt,
      -MAX_DELTA_INPUT_LINEAR,
      MAX_DELTA_INPUT_LINEAR
    );
    const deltaInputAngle = clamp(
      (inputAngle - baseState.prevInputAngle) / safeDt,
      -MAX_DELTA_INPUT_ANGLE,
      MAX_DELTA_INPUT_ANGLE
    );

    const gust =
      1 +
      options.windTurbulence *
        (0.55 * Math.sin(options.time * 2.7 + group.anchorX * 0.015) +
          0.35 * Math.cos(options.time * 5.3 + group.anchorY * 0.02));
    const windAccel = options.windStrength * group.windScale * gust * 14;

    const impulseX = options.impulseX ?? 0;
    const impulseY = options.impulseY ?? 0;

    const gravityMag = Math.hypot(group.gravityX, group.gravityY) || 1;
    const gravityTargetAngle = Math.atan2(group.gravityX, group.gravityY);

    const links: PendulumLinkState[] = baseState.links.map((l) => ({ ...l }));

    for (let step = 0; step < substeps; step++) {
      let parentAngle = (inputAngle * Math.PI) / 180;
      let parentAngVel = (deltaInputAngle * Math.PI) / 180;

      for (let i = 0; i < group.pendulums.length; i++) {
        const cfg = group.pendulums[i];
        const link = links[i];
        const invMass = 1 / Math.max(0.2, cfg.mass);
        const lengthNorm = Math.max(20, cfg.length) / 60;

        const restAngle = gravityTargetAngle * 0.75 + parentAngle * 0.25;
        const angleError = link.angle - restAngle;

        const restoringAccel =
          (-cfg.stiffness * gravityMag * Math.sin(angleError)) / lengthNorm;

        const inertialExcitation =
          (-deltaInputX * 0.032 * Math.cos(link.angle) +
            deltaInputY * 0.012 * Math.sin(link.angle) -
            parentAngVel * 0.55) *
          invMass *
          strength;

        const externalTorque =
          (windAccel * Math.cos(link.angle) +
            impulseX * 0.35 * Math.cos(link.angle) +
            impulseY * 0.1 * Math.sin(link.angle)) *
          invMass *
          strength;

        const dampingRate = clamp(1 - cfg.damping, 0.02, 0.95) * 18;
        const totalAccel =
          restoringAccel +
          inertialExcitation +
          externalTorque -
          dampingRate * link.angularVelocity;

        link.angularVelocity = clamp(
          link.angularVelocity + totalAccel * subDt,
          -MAX_ANGULAR_VELOCITY,
          MAX_ANGULAR_VELOCITY
        );
        link.angle = clamp(
          link.angle + link.angularVelocity * subDt,
          -MAX_ANGLE,
          MAX_ANGLE
        );

        parentAngle = link.angle;
        parentAngVel = link.angularVelocity;
      }
    }

    const anchorWorldX = group.anchorX + inputX * 0.55;
    const anchorWorldY = group.anchorY + inputY * 0.45;
    let curX = anchorWorldX;
    let curY = anchorWorldY;

    for (let i = 0; i < group.pendulums.length; i++) {
      const cfg = group.pendulums[i];
      const link = links[i];
      curX += Math.sin(link.angle) * cfg.length;
      curY += Math.cos(link.angle) * cfg.length;
      link.worldX = curX;
      link.worldY = curY;
    }

    nextState[group.id] = {
      groupId: group.id,
      anchorWorldX,
      anchorWorldY,
      prevInputX: inputX,
      prevInputY: inputY,
      prevInputAngle: inputAngle,
      links,
    };
  }

  return nextState;
}

export interface PhysicsOutputDelta {
  dx: number;
  dy: number;
  rotation: number;
  bendX: number;
  bendY: number;
  scaleY: number;
}

/**
 * Converts simulated pendulum angles into deformer/layer deltas AND secondary parameter values
 * (Cubism-style: moving Param 1 -> drives Param 2 & Param 3).
 */
export function computePhysicsOutputDeltas(
  groups: PhysicsGroup[],
  simState: PhysicsSimulationState,
  strengthMultiplier: number
): {
  deformers: Record<string, PhysicsOutputDelta>;
  layers: Record<string, PhysicsOutputDelta>;
  parameters: Record<string, number>;
} {
  const deformers: Record<string, PhysicsOutputDelta> = {};
  const layers: Record<string, PhysicsOutputDelta> = {};
  const parameters: Record<string, number> = {};

  const ensure = (
    map: Record<string, PhysicsOutputDelta>,
    id: string
  ): PhysicsOutputDelta => {
    if (!map[id]) {
      map[id] = { dx: 0, dy: 0, rotation: 0, bendX: 0, bendY: 0, scaleY: 0 };
    }
    return map[id];
  };

  for (const group of groups) {
    if (!group.enabled) continue;
    const runtime = simState[group.id];
    if (!runtime) continue;

    for (const out of group.outputs) {
      const link =
        runtime.links[
          Math.min(out.pendulumIndex, Math.max(0, runtime.links.length - 1))
        ];
      if (!link) continue;

      const angleDeg = (link.angle * 180) / Math.PI;
      const normalized = clamp(link.angle / 0.55, -1.5, 1.5);
      const factor = out.scale * strengthMultiplier;

      if (out.targetType === 'parameter' || out.property === 'paramValue') {
        parameters[out.targetId] =
          (parameters[out.targetId] ?? 0) + normalized * factor;
        continue;
      }

      const bucket =
        out.targetType === 'deformer'
          ? ensure(deformers, out.targetId)
          : ensure(layers, out.targetId);

      switch (out.property) {
        case 'rotation':
          bucket.rotation += angleDeg * factor;
          break;
        case 'dx':
          bucket.dx += normalized * 24 * factor;
          break;
        case 'dy':
          bucket.dy += Math.abs(normalized) * 10 * factor;
          break;
        case 'bendX':
          bucket.bendX += normalized * 0.45 * factor;
          break;
        case 'bendY':
          bucket.bendY += Math.abs(normalized) * 0.25 * factor;
          break;
        case 'scaleY':
          bucket.scaleY += Math.abs(normalized) * 0.08 * factor;
          break;
      }
    }
  }

  return { deformers, layers, parameters };
}
