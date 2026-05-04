import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { ArenaLootView } from "../../lib/simulation/types";

const LOOT_COLORS: Record<ArenaLootView["type"], string> = {
  weapon: "#f97316",
  medkit: "#ef4444",
  armor: "#60a5fa",
  tool: "#22c55e",
};

export function LootPickup({ loot }: { loot: ArenaLootView }) {
  const ref = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 1.6;
    ref.current.position.y = loot.position[1] + Math.sin(clock.elapsedTime * 2.4 + loot.position[0]) * 0.08;
  });

  return (
    <group ref={ref} position={loot.position}>
      <mesh castShadow>
        {loot.type === "medkit" ? <boxGeometry args={[0.42, 0.2, 0.42]} /> : <octahedronGeometry args={[0.28]} />}
        <meshStandardMaterial color={LOOT_COLORS[loot.type]} emissive={LOOT_COLORS[loot.type]} emissiveIntensity={0.18} />
      </mesh>
      <Html center distanceFactor={10} position={[0, 0.55, 0]} className="loot-label-wrap">
        <div className={`loot-label ${loot.rarity}`}>{loot.name}</div>
      </Html>
    </group>
  );
}
