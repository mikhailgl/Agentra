import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { ArenaBotView } from "../../lib/simulation/types";
import { FloatingNameplate } from "./FloatingNameplate";
import { HealthBar3D } from "./HealthBar3D";

const tmpPosition = new THREE.Vector3();

export function BotAvatar({
  bot,
  onSelect,
}: {
  bot: ArenaBotView;
  onSelect: (botId: string) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const lowHealth = bot.health <= 28 && bot.alive;
  const status = bot.isWinner
    ? "Winner"
    : !bot.alive
      ? "Out"
      : bot.isNudged
        ? "Nudged"
        : bot.behavior === "attacking"
          ? "Combat"
          : bot.behavior === "fleeing"
            ? "Fleeing"
            : undefined;

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    tmpPosition.set(...bot.position);
    group.position.lerp(tmpPosition, Math.min(1, delta * 9));
    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, bot.rotationY, Math.min(1, delta * 8));
    if (bodyRef.current) {
      bodyRef.current.rotation.z = bot.alive ? 0 : THREE.MathUtils.lerp(bodyRef.current.rotation.z, Math.PI / 2, Math.min(1, delta * 6));
    }
  });

  return (
    <group ref={groupRef} position={bot.position} onClick={(event) => {
      event.stopPropagation();
      onSelect(bot.id);
    }}>
      <mesh position={[0, 0.72, 0]} ref={bodyRef} castShadow>
        <capsuleGeometry args={[0.34, 0.72, 6, 12]} />
        <meshStandardMaterial color={bot.alive ? bot.color : "#64748b"} roughness={0.62} metalness={0.08} />
      </mesh>
      <mesh position={[0, 1.22, 0.28]} castShadow>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshStandardMaterial color={lowHealth ? "#fecaca" : "#f8fafc"} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.75, 0.43]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, bot.weaponName === "Bow" ? 0.9 : 0.55, 8]} />
        <meshStandardMaterial color="#d6d3d1" />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.62, 32]} />
        <meshBasicMaterial
          color={bot.isWinner ? "#facc15" : bot.isSelected ? "#38bdf8" : bot.isDrafted ? "#a78bfa" : bot.isBetOn ? "#f59e0b" : "#000000"}
          transparent
          opacity={bot.isSelected || bot.isDrafted || bot.isBetOn || bot.isWinner ? 0.92 : 0}
        />
      </mesh>
      {bot.behavior === "attacking" && bot.alive && (
        <pointLight color="#fb7185" intensity={2.8} distance={3.4} />
      )}
      {lowHealth && <pointLight color="#ef4444" intensity={1.8} distance={2.2} />}
      <HealthBar3D health={bot.health} />
      <FloatingNameplate name={bot.name} level={bot.level} status={status} />
    </group>
  );
}
