import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { ArenaEventView } from "../../lib/simulation/types";

export function ProjectileEffect({ event }: { event: ArenaEventView }) {
  const ref = useRef<THREE.Mesh>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const startedAt = useMemo(() => performance.now(), [event.id]);
  const from = useMemo(() => new THREE.Vector3(...(event.from ?? event.position ?? [0, 0, 0])), [event.from, event.position]);
  const to = useMemo(() => new THREE.Vector3(...(event.to ?? event.position ?? [0, 0, 0])), [event.to, event.position]);
  const mid = useMemo(() => from.clone().lerp(to, 0.5), [from, to]);
  const length = Math.max(0.2, from.distanceTo(to));
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()), [from, to]);

  useFrame(() => {
    const age = Math.min(1, (performance.now() - startedAt) / 520);
    if (ref.current) {
      const material = ref.current.material as THREE.MeshBasicMaterial;
      material.opacity = 1 - age;
      ref.current.scale.setScalar(1 + age * 0.3);
    }
    if (labelRef.current) {
      labelRef.current.style.opacity = String(1 - age);
      labelRef.current.style.transform = `translateY(${-age * 18}px)`;
    }
  });

  if (!event.position && !event.to) {
    return null;
  }

  return (
    <group>
      {event.kind === "damage" && event.from && event.to && (
        <mesh ref={ref} position={mid} quaternion={quat}>
          <cylinderGeometry args={[0.035, 0.035, length, 8]} />
          <meshBasicMaterial color="#f8fafc" transparent opacity={0.85} />
        </mesh>
      )}
      <Html center position={event.position ?? event.to} className="damage-number-wrap">
        <div ref={labelRef} className={`damage-number ${event.kind}`}>
          {event.label ?? (event.kind === "kill" ? "KO" : "")}
        </div>
      </Html>
    </group>
  );
}
