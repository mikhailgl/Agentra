import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { ArenaMarkerView } from "../../lib/simulation/types";

const MARKER_COLORS: Record<string, string> = {
  monster_spawn: "#ef4444",
  rare_loot_drop: "#facc15",
  danger_zone: "#fb7185",
  bounty_target: "#f97316",
  sudden_death: "#e879f9",
};

export function ArenaEventMarker({ event }: { event: ArenaMarkerView }) {
  const ringRef = useRef<THREE.Mesh>(null);
  if (!event.position) return null;

  const color = MARKER_COLORS[event.type] ?? "#f8fafc";

  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 4) * 0.06;
    ringRef.current.scale.setScalar(pulse);
  });

  return (
    <group position={event.position}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[Math.max(0.55, (event.radius ?? 1) * 0.82), Math.max(0.8, event.radius ?? 1), 72]} />
        <meshBasicMaterial color={color} transparent opacity={event.type === "danger_zone" ? 0.72 : 0.58} side={THREE.DoubleSide} />
      </mesh>
      {event.type === "danger_zone" && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
          <circleGeometry args={[event.radius ?? 1, 72]} />
          <meshBasicMaterial color={color} transparent opacity={0.18} />
        </mesh>
      )}
      <mesh position={[0, 1.1, 0]}>
        <octahedronGeometry args={[0.34]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      <Html center distanceFactor={12} position={[0, 1.72, 0]} className="arena-marker-label-wrap">
        <div className={`arena-marker-label ${event.severity ?? "major"}`}>
          <strong>{event.title}</strong>
          <span>{event.description}</span>
        </div>
      </Html>
    </group>
  );
}
