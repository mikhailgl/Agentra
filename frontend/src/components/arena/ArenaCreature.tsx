import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { ArenaCreatureView } from "../../lib/simulation/types";
import { useBufferedTransform } from "./useBufferedTransform";

export function ArenaCreature({ creature }: { creature: ArenaCreatureView }) {
  const { groupRef, initialPosition } = useBufferedTransform(creature.position);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.position.y = creature.position[1] + Math.sin(clock.elapsedTime * 5 + creature.position[0]) * 0.04;
    if (creature.targetPosition) {
      const dx = creature.targetPosition[0] - creature.position[0];
      const dz = creature.targetPosition[2] - creature.position[2];
      groupRef.current.rotation.y = Math.atan2(dx, dz);
    }
  });

  return (
    <group ref={groupRef} position={initialPosition}>
      <mesh castShadow>
        <coneGeometry args={[0.32, 0.72, 5]} />
        <meshStandardMaterial color="#991b1b" emissive="#ef4444" emissiveIntensity={0.28} roughness={0.62} />
      </mesh>
      <mesh position={[0, 0.18, -0.34]} castShadow>
        <boxGeometry args={[0.46, 0.24, 0.34]} />
        <meshStandardMaterial color="#451a1a" roughness={0.7} />
      </mesh>
      <Html center distanceFactor={11} position={[0, 0.82, 0]} className="creature-label-wrap">
        <div className="creature-label">
          <strong>{creature.name}</strong>
          <span>{Math.max(0, Math.round(creature.health))} hp</span>
        </div>
      </Html>
    </group>
  );
}
