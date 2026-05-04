export function HealthBar3D({ health }: { health: number }) {
  const ratio = Math.max(0, Math.min(1, health / 100));
  const color = ratio < 0.28 ? "#ef4444" : ratio < 0.55 ? "#f59e0b" : "#22c55e";

  return (
    <group position={[0, 1.48, 0]}>
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[1.04, 0.08, 0.04]} />
        <meshBasicMaterial color="#111827" />
      </mesh>
      <mesh position={[-0.52 + ratio * 0.52, 0, 0]}>
        <boxGeometry args={[ratio, 0.075, 0.045]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}
