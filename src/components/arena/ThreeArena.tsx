import { Environment, Grid } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import * as THREE from "three";
import { ARENA_WORLD_SIZE } from "../../lib/simulation/simulationTo3D";
import type { ArenaViewModel, CameraMode } from "../../lib/simulation/types";
import { ArenaCreature } from "./ArenaCreature";
import { ArenaEventMarker } from "./ArenaEventMarker";
import { BotAvatar } from "./BotAvatar";
import { LootPickup } from "./LootPickup";
import { ProjectileEffect } from "./ProjectileEffect";
import { SpectatorCamera } from "./SpectatorCamera";

export function ThreeArena({
  arena,
  cameraMode,
  selectedBotId,
  cameraResetToken,
  onSelectBot,
  onClearSelection,
}: {
  arena: ArenaViewModel;
  cameraMode: CameraMode;
  selectedBotId: string | null;
  cameraResetToken: number;
  onSelectBot: (botId: string) => void;
  onClearSelection: () => void;
}) {
  const recentVisualEvents = arena.events
    .filter((event) => ["damage", "kill", "loot", "winner", "player", "system", "avoid"].includes(event.kind))
    .slice(0, 10);

  return (
    <div className="three-arena">
      <Canvas shadows={{ type: THREE.PCFShadowMap }} camera={{ position: [0, 28, 31], fov: 46 }} onPointerMissed={onClearSelection}>
        <color attach="background" args={["#0b1110"]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[12, 18, 8]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} />
        <Suspense fallback={null}>
          <Environment preset="night" />
        </Suspense>
        <SpectatorCamera
          mode={cameraMode}
          selectedBotId={selectedBotId}
          bots={arena.bots}
          events={arena.events}
          resetToken={cameraResetToken}
        />
        <group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[ARENA_WORLD_SIZE, ARENA_WORLD_SIZE]} />
            <meshStandardMaterial color="#233126" roughness={0.94} />
          </mesh>
          {arena.zones.map((zone) => (
            <mesh key={zone.id} position={zone.position} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={zone.size} />
              <meshStandardMaterial color={zone.color} transparent opacity={0.42} roughness={1} />
            </mesh>
          ))}
          <Grid args={[ARENA_WORLD_SIZE, ARENA_WORLD_SIZE]} cellSize={2.5} sectionSize={10} fadeDistance={52} fadeStrength={1.6} infiniteGrid={false} position={[0, 0.018, 0]} />
          <ArenaWalls />
          <ArenaObstacles />
          {arena.arenaEvents.map((event) => (
            <ArenaEventMarker key={event.id} event={event} />
          ))}
          {arena.loot.map((loot) => (
            <LootPickup key={loot.id} loot={loot} />
          ))}
          {arena.creatures.map((creature) => (
            <ArenaCreature key={creature.id} creature={creature} />
          ))}
          {arena.bots.map((bot) => (
            <BotAvatar key={bot.id} bot={bot} onSelect={onSelectBot} />
          ))}
          {recentVisualEvents.map((event) => (
            <ProjectileEffect key={event.id} event={event} />
          ))}
        </group>
      </Canvas>
    </div>
  );
}

function ArenaWalls() {
  const half = ARENA_WORLD_SIZE / 2;
  const wall = 0.45;
  return (
    <group>
      <mesh position={[0, 0.7, -half]} castShadow receiveShadow>
        <boxGeometry args={[ARENA_WORLD_SIZE, 1.4, wall]} />
        <meshStandardMaterial color="#3f3f46" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.7, half]} castShadow receiveShadow>
        <boxGeometry args={[ARENA_WORLD_SIZE, 1.4, wall]} />
        <meshStandardMaterial color="#3f3f46" roughness={0.75} />
      </mesh>
      <mesh position={[-half, 0.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[wall, 1.4, ARENA_WORLD_SIZE]} />
        <meshStandardMaterial color="#3f3f46" roughness={0.75} />
      </mesh>
      <mesh position={[half, 0.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[wall, 1.4, ARENA_WORLD_SIZE]} />
        <meshStandardMaterial color="#3f3f46" roughness={0.75} />
      </mesh>
    </group>
  );
}

function ArenaObstacles() {
  const obstacles = [
    [-10, 0.5, -8, 4.2, 1, 1.5],
    [8, 0.65, -5, 1.6, 1.3, 5.4],
    [-6, 0.45, 8, 5.4, 0.9, 1.5],
    [11, 0.9, 10, 2.4, 1.8, 2.4],
    [0, 0.45, 0, 3.2, 0.9, 3.2],
  ];

  return (
    <group>
      {obstacles.map(([x, y, z, sx, sy, sz], index) => (
        <mesh key={index} position={[x, y, z]} castShadow receiveShadow>
          <boxGeometry args={[sx, sy, sz]} />
          <meshStandardMaterial color={index % 2 ? "#52525b" : "#57534e"} roughness={0.86} />
        </mesh>
      ))}
    </group>
  );
}
