import { Html } from "@react-three/drei";

export function FloatingNameplate({
  name,
  level,
  status,
}: {
  name: string;
  level: number;
  status?: string;
}) {
  return (
    <Html center distanceFactor={12} position={[0, 1.85, 0]} className="nameplate-wrap">
      <div className="nameplate">
        <strong>{name}</strong>
        <span>L{level}{status ? ` · ${status}` : ""}</span>
      </div>
    </Html>
  );
}
