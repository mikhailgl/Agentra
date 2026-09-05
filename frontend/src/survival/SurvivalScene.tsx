import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Color, Group, InstancedMesh, Object3D, PCFShadowMap, Vector3 } from "three";
import { isDaylight, isWater } from "../game/survival/types";
import type {
  Resource,
  Structure,
  SurvivalSnapshot,
} from "../game/survival/types";

type World = SurvivalSnapshot["world"];
type Bot = World["bots"][number];

function ContextStatus({ onLost }: { onLost: (lost: boolean) => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      onLost(true);
    };
    const restored = () => onLost(false);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl, onLost]);
  return null;
}

function CameraReset({ token }: { token: number }) {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.position.set(27, 23, 31);
    camera.lookAt(11.5, 0, 11.5);
  }, [camera, token]);
  return null;
}

const Ground = memo(function Ground({ size }: { size: number }) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const obj = new Object3D();
    for (let x = 0; x < size; x++)
      for (let z = 0; z < size; z++) {
        const water = isWater({ x, z });
        obj.position.set(x, water ? -0.2 : -0.28, z);
        obj.scale.set(1, water ? 0.12 : 0.5, 1);
        obj.updateMatrix();
        mesh.current.setMatrixAt(x * size + z, obj.matrix);
        mesh.current.setColorAt(
          x * size + z,
          new Color(
            water
              ? "#467e83"
              : ["#74876a", "#7c8d6e", "#819270", "#6e8167"][
                  (x * 7 + z * 3) % 4
                ],
          ),
        );
      }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
  }, [size]);
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, size * size]}
      receiveShadow
    >
      <boxGeometry />
      <meshStandardMaterial roughness={0.95} />
    </instancedMesh>
  );
});

function ResourceModel({ resource: r }: { resource: Resource }) {
  if (r.remaining <= 0)
    return r.kind === "tree" ? (
      <mesh position={[r.x, 0.1, r.z]}>
        <cylinderGeometry args={[0.12, 0.16, 0.2, 6]} />
        <meshStandardMaterial color="#72543b" />
      </mesh>
    ) : null;
  if (r.kind === "tree")
    return (
      <group position={[r.x, 0, r.z]}>
        <mesh position={[0, 0.6, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.17, 1.2, 6]} />
          <meshStandardMaterial color="#73543c" />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0, 1.15 + i * 0.48, 0]} castShadow>
            <coneGeometry args={[0.72 - i * 0.15, 1.2, 5]} />
            <meshStandardMaterial
              color={["#355e50", "#406d55", "#51795a"][i]}
            />
          </mesh>
        ))}
      </group>
    );
  if (r.kind === "rock")
    return (
      <mesh
        position={[r.x, 0.22, r.z]}
        rotation={[0.2, r.x, 0]}
        scale={[0.55, 0.42, 0.48]}
        castShadow
      >
        <dodecahedronGeometry />
        <meshStandardMaterial color="#9c9f94" flatShading />
      </mesh>
    );
  return (
    <group position={[r.x, 0, r.z]}>
      <mesh position={[0, 0.22, 0]} scale={[0.42, 0.3, 0.42]} castShadow>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#697d46" />
      </mesh>
      {[
        [-0.18, 0.35, 0.18],
        [0.2, 0.4, 0.08],
        [0, 0.45, -0.2],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]}>
          <sphereGeometry args={[0.065, 6, 6]} />
          <meshStandardMaterial color="#b35d59" />
        </mesh>
      ))}
    </group>
  );
}

function Building({ structure: s }: { structure: Structure }) {
  if (s.kind === "wall")
    return (
      <mesh position={[s.x, 0.55, s.z]} castShadow>
        <boxGeometry args={[0.96, 1.1, 0.96]} />
        <meshStandardMaterial color="#a37a52" />
      </mesh>
    );
  return (
    <group position={[s.x, 0, s.z]}>
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[1, 0.08, 1]} />
        <meshStandardMaterial color="#a5845b" />
      </mesh>
      {[-0.43, 0.43].flatMap((x) =>
        [-0.43, 0.43].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.5, z]} castShadow>
            <boxGeometry args={[0.1, 1, 0.1]} />
            <meshStandardMaterial color="#785638" />
          </mesh>
        )),
      )}
      <mesh position={[0, 1.02, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[0.85, 0.55, 4]} />
        <meshStandardMaterial color="#b69058" />
      </mesh>
      <pointLight
        position={[0, 0.4, 0]}
        color="#ffc878"
        intensity={0.6}
        distance={2}
      />
    </group>
  );
}

function Character({
  bot,
  selected,
  thinking,
  time,
  onSelect,
}: {
  bot: Bot;
  selected: boolean;
  thinking: boolean;
  time: number;
  onSelect: (id: string) => void;
}) {
  const root = useRef<Group>(null);
  const initialPosition = useRef<[number, number, number]>([bot.x, 0, bot.z]);
  const body = useRef<Group>(null);
  const arm = useRef<Group>(null);
  const leg = useRef<Group>(null);
  const destination = useMemo(
    () => new Vector3(bot.x, 0, bot.z),
    [bot.x, bot.z],
  );
  useFrame(({ clock }, delta) => {
    if (!root.current || !body.current) return;
    const moving = root.current.position.distanceTo(destination) > 0.015;
    if (moving)
      body.current.rotation.y = Math.atan2(
        destination.x - root.current.position.x,
        destination.z - root.current.position.z,
      );
    root.current.position.lerp(destination, 1 - Math.exp(-delta * 8));
    body.current.position.y = moving
      ? Math.abs(Math.sin(clock.elapsedTime * 9)) * 0.025
      : 0;
    body.current.rotation.z = bot.health <= 0 ? Math.PI / 2 : 0;
    if (arm.current)
      arm.current.rotation.x = moving
        ? Math.sin(clock.elapsedTime * 9) * 0.5
        : bot.task?.action.type === "harvest"
          ? Math.sin(clock.elapsedTime * 7) * 0.7 - 0.7
          : 0;
    if (leg.current)
      leg.current.rotation.x = moving
        ? -Math.sin(clock.elapsedTime * 9) * 0.5
        : 0;
  });
  return (
    <group
      ref={root}
      position={initialPosition.current}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(bot.id);
      }}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <ringGeometry args={[0.34, 0.38, 32]} />
        <meshBasicMaterial
          color={bot.color}
          transparent
          opacity={selected ? 1 : 0.35}
        />
      </mesh>
      <group ref={body}>
        <mesh position={[0, 0.48, 0]} castShadow>
          <boxGeometry args={[0.28, 0.36, 0.18]} />
          <meshStandardMaterial color={bot.color} />
        </mesh>
        <mesh position={[0, 0.76, 0]} castShadow>
          <boxGeometry args={[0.23, 0.23, 0.23]} />
          <meshStandardMaterial
            color={bot.id === "moss" ? "#c49c7a" : "#e5bc96"}
          />
        </mesh>
        <mesh position={[0, 0.88, -0.015]}>
          <boxGeometry args={[0.25, 0.08, 0.24]} />
          <meshStandardMaterial color="#453c32" />
        </mesh>
        <group ref={arm} position={[0.21, 0.58, 0]}>
          <mesh position={[0, -0.13, 0]} castShadow>
            <boxGeometry args={[0.11, 0.32, 0.13]} />
            <meshStandardMaterial color={bot.color} />
          </mesh>
          {bot.inventory.axe > 0 && (
            <group position={[0.03, -0.3, 0.12]}>
              <mesh>
                <boxGeometry args={[0.04, 0.34, 0.04]} />
                <meshStandardMaterial color="#73553b" />
              </mesh>
              <mesh position={[0.06, 0.13, 0]}>
                <boxGeometry args={[0.16, 0.12, 0.05]} />
                <meshStandardMaterial color="#a9b4b4" />
              </mesh>
            </group>
          )}
        </group>
        <mesh position={[-0.21, 0.45, 0]} castShadow>
          <boxGeometry args={[0.11, 0.32, 0.13]} />
          <meshStandardMaterial color={bot.color} />
        </mesh>
        <group ref={leg} position={[0.09, 0.3, 0]}>
          <mesh position={[0, -0.13, 0]} castShadow>
            <boxGeometry args={[0.12, 0.3, 0.14]} />
            <meshStandardMaterial color="#3e4946" />
          </mesh>
        </group>
        <mesh position={[-0.09, 0.15, 0]} castShadow>
          <boxGeometry args={[0.12, 0.3, 0.14]} />
          <meshStandardMaterial color="#3e4946" />
        </mesh>
      </group>
      <Html
        position={[0, 1.14, 0]}
        center
        distanceFactor={18}
        style={{ pointerEvents: "none" }}
      >
        <div className={`survival-name ${selected ? "selected" : ""}`}>
          <i style={{ background: bot.color }} />
          {bot.name}
          {thinking ? " ···" : ""}
        </div>
      </Html>
      {bot.speech && bot.speech.until > time && (
        <Html
          position={[0, 1.85, 0]}
          center
          distanceFactor={18}
          style={{ pointerEvents: "none" }}
        >
          <div className="survival-bubble">{bot.speech.message}</div>
        </Html>
      )}
    </group>
  );
}

export default function SurvivalScene({
  world,
  selected,
  thinking,
  onSelect,
  reset,
}: {
  world: World;
  selected: string;
  thinking: string[];
  onSelect: (id: string) => void;
  reset: number;
}) {
  const daylight = isDaylight(world.time);
  // Touch devices have a much smaller GPU budget, especially on iOS.
  const [touchDevice] = useState(() => matchMedia("(pointer: coarse)").matches);
  const [contextLost, setContextLost] = useState(false);
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <Canvas
        key={generation}
        shadows={touchDevice ? false : { type: PCFShadowMap }}
        dpr={touchDevice ? 1 : [1, 1.75]}
        gl={{ antialias: !touchDevice, alpha: false }}
        camera={{ position: [27, 23, 31], fov: 40 }}
        aria-label="Three-dimensional survival island. Select a survivor using the cards beside the world."
      >
        <ContextStatus onLost={setContextLost} />
        <color attach="background" args={[daylight ? "#d4ddce" : "#1b2d3f"]} />
        <fog attach="fog" args={[daylight ? "#d4ddce" : "#1b2d3f", 35, 80]} />
        <ambientLight intensity={daylight ? 1.25 : 0.45} />
        <directionalLight
          position={[6, 22, 6]}
          intensity={daylight ? 2.4 : 0.55}
          color={daylight ? "#ffdfaf" : "#a4caff"}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-24}
          shadow-camera-right={24}
          shadow-camera-top={24}
          shadow-camera-bottom={-24}
          shadow-normalBias={0.035}
        />
        <Ground size={world.size} />
        {world.resources.map((r) => (
          <ResourceModel key={r.id} resource={r} />
        ))}
        {world.structures.map((s) => (
          <Building key={s.id} structure={s} />
        ))}
        {world.bots.map((bot) => (
          <Character
            key={bot.id}
            bot={bot}
            selected={selected === bot.id}
            thinking={thinking.includes(bot.id)}
            time={world.time}
            onSelect={onSelect}
          />
        ))}
        <OrbitControls
          key={reset}
          makeDefault
          target={[11.5, 0, 11.5]}
          minDistance={5}
          maxDistance={45}
          maxPolarAngle={Math.PI * 0.46}
        />
        <CameraReset token={reset} />
      </Canvas>
      {contextLost && (
        <div className="survival-context-status" role="status">
          <p>The 3D view was interrupted.</p>
          <button type="button" onClick={() => {
            setContextLost(false);
            setGeneration((value) => value + 1);
          }}>
            Reload 3D view
          </button>
        </div>
      )}
    </>
  );
}
