import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { ElementRef } from "react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ArenaBotView, ArenaEventView, CameraMode } from "../../lib/simulation/types";

const cameraOffset = new THREE.Vector3(0, 7.5, 9);
const tmpTarget = new THREE.Vector3();
const tmpCamera = new THREE.Vector3();

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
  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? null;
  const autoTarget = useMemo(() => {
    const combat = events.find((event) => ["kill", "damage", "loot", "winner"].includes(event.kind) && event.position);
    if (combat?.position) return new THREE.Vector3(...combat.position);
    const lowHealth = bots.find((bot) => bot.alive && bot.health < 30);
    if (lowHealth) return new THREE.Vector3(...lowHealth.position);
    const living = bots.filter((bot) => bot.alive);
    if (living.length <= 2 && living[0]) return new THREE.Vector3(...living[0].position);
    return null;
  }, [bots, events]);

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

    const followPosition = selectedBot ? new THREE.Vector3(...selectedBot.position) : null;
    const target = mode === "follow" ? followPosition : mode === "auto" ? autoTarget : null;
    if (target) {
      tmpTarget.lerpVectors(controls.target, target, Math.min(1, delta * 2.8));
      controls.target.copy(tmpTarget);
      tmpCamera.copy(target).add(cameraOffset);
      camera.position.lerp(tmpCamera, Math.min(1, delta * 2.2));
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
