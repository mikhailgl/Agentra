import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { ElementRef } from "react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ArenaBotView, ArenaEventView, CameraMode } from "../../lib/simulation/types";

const tmpTarget = new THREE.Vector3();
const tmpCameraDelta = new THREE.Vector3();
const tmpPoint = new THREE.Vector3();

export function SpectatorCamera({
  mode,
  selectedBotId,
  bots,
  events,
  resetToken,
}: {
  mode: CameraMode;
  selectedBotId: string | null;
  bots: ArenaBotView[];
  events: ArenaEventView[];
  resetToken: number;
}) {
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const selectedBot = bots.find((bot) => bot.id === selectedBotId && bot.alive) ?? null;
  const actionTarget = useMemo(() => {
    return getRecentImportantEventTarget(events) ?? getNearestFightTarget(bots) ?? getDensestClusterTarget(bots);
  }, [bots, events]);
  const leaderTarget = useMemo(() => getLeaderTarget(bots), [bots]);

  useEffect(() => {
    camera.position.set(0, 28, 31);
    camera.lookAt(0, 0, 0);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [camera, resetToken]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const followPosition = selectedBot ? tmpPoint.set(...selectedBot.position).clone() : null;
    const target =
      mode === "follow_bot"
        ? followPosition
        : mode === "follow_action"
          ? actionTarget
          : mode === "follow_leader"
            ? leaderTarget
            : null;
    if (target) {
      tmpTarget.lerpVectors(controls.target, target, Math.min(1, delta * 2.8));
      tmpCameraDelta.subVectors(tmpTarget, controls.target);
      controls.target.copy(tmpTarget);
      camera.position.add(tmpCameraDelta);
    }
    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI * 0.47}
      minDistance={8}
      maxDistance={58}
    />
  );
}

function getRecentImportantEventTarget(events: ArenaEventView[]): THREE.Vector3 | null {
  const event = events.find((candidate) => {
    if (!["kill", "winner", "damage", "betrayal", "player"].includes(candidate.kind)) return false;
    if (candidate.kind === "damage" && Math.abs(Number(candidate.label?.replace("-", "") ?? 0)) < 20) return false;
    return Boolean(candidate.position ?? candidate.to ?? candidate.from);
  });

  if (!event) return null;
  if (event.position) return new THREE.Vector3(...event.position);
  if (event.from && event.to) {
    return new THREE.Vector3(...event.from).lerp(new THREE.Vector3(...event.to), 0.5);
  }
  return new THREE.Vector3(...(event.to ?? event.from ?? [0, 0, 0]));
}

function getNearestFightTarget(bots: ArenaBotView[]): THREE.Vector3 | null {
  const fight = bots
    .filter((bot) => bot.alive && bot.behavior === "attacking" && bot.targetPosition)
    .map((bot) => {
      const from = new THREE.Vector3(...bot.position);
      const to = new THREE.Vector3(...(bot.targetPosition as [number, number, number]));
      const distance = from.distanceTo(to);
      return { center: from.lerp(to, 0.5), distance };
    })
    .sort((left, right) => left.distance - right.distance)[0];

  return fight?.center ?? null;
}

function getDensestClusterTarget(bots: ArenaBotView[]): THREE.Vector3 | null {
  const living = bots.filter((bot) => bot.alive);
  if (living.length === 0) return null;
  if (living.length === 1) return new THREE.Vector3(...living[0].position);

  const cluster = living
    .map((bot) => {
      const center = new THREE.Vector3(...bot.position);
      let score = 0;
      let count = 1;
      for (const other of living) {
        if (other.id === bot.id) continue;
        const distance = center.distanceTo(new THREE.Vector3(...other.position));
        if (distance <= 8) {
          score += 1 / Math.max(0.75, distance);
          count += 1;
        }
      }
      return { bot, score, count };
    })
    .sort((left, right) => right.count - left.count || right.score - left.score)[0];

  const nearby = living.filter((bot) => new THREE.Vector3(...bot.position).distanceTo(new THREE.Vector3(...cluster.bot.position)) <= 8);
  const center = nearby.reduce((sum, bot) => sum.add(new THREE.Vector3(...bot.position)), new THREE.Vector3());
  return center.multiplyScalar(1 / nearby.length);
}

function getLeaderTarget(bots: ArenaBotView[]): THREE.Vector3 | null {
  const leader = bots
    .filter((bot) => bot.alive)
    .sort((left, right) => getLeaderScore(right) - getLeaderScore(left))[0];
  return leader ? new THREE.Vector3(...leader.position) : null;
}

function getLeaderScore(bot: ArenaBotView): number {
  return bot.kills * 120 + bot.health * 2 + bot.damageDealt + bot.survivalTimeMs / 1000;
}
