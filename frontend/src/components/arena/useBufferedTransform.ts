import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

const DEFAULT_FRAME_SECONDS = 0.5;
const MIN_FRAME_SECONDS = 0.3;
const MAX_FRAME_SECONDS = 0.8;
const BUFFER_MULTIPLIER = 1.08;

type Position = readonly [number, number, number];

export function useBufferedTransform(position: Position, rotationY?: number) {
  const groupRef = useRef<THREE.Group>(null);
  const initialPositionRef = useRef<[number, number, number]>([...position]);
  const fromPositionRef = useRef(new THREE.Vector3(...position));
  const toPositionRef = useRef(new THREE.Vector3(...position));
  const fromRotationRef = useRef(rotationY ?? 0);
  const toRotationRef = useRef(rotationY ?? 0);
  const elapsedRef = useRef(DEFAULT_FRAME_SECONDS);
  const durationRef = useRef(DEFAULT_FRAME_SECONDS);
  const lastArrivalRef = useRef<number | null>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const arrivedAt = performance.now();
    const previousArrival = lastArrivalRef.current;
    const measuredFrameSeconds = previousArrival === null
      ? DEFAULT_FRAME_SECONDS
      : (arrivedAt - previousArrival) / 1_000;

    lastArrivalRef.current = arrivedAt;
    durationRef.current = THREE.MathUtils.clamp(
      measuredFrameSeconds * BUFFER_MULTIPLIER,
      MIN_FRAME_SECONDS,
      MAX_FRAME_SECONDS,
    );
    elapsedRef.current = 0;
    fromPositionRef.current.copy(group.position);
    toPositionRef.current.set(...position);

    if (rotationY !== undefined) {
      const currentRotation = group.rotation.y;
      const shortestTurn = THREE.MathUtils.euclideanModulo(rotationY - currentRotation + Math.PI, Math.PI * 2) - Math.PI;
      fromRotationRef.current = currentRotation;
      toRotationRef.current = currentRotation + shortestTurn;
    }
  }, [position[0], position[1], position[2], rotationY]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    elapsedRef.current += Math.min(delta, 0.1);
    const progress = Math.min(1, elapsedRef.current / durationRef.current);
    group.position.lerpVectors(fromPositionRef.current, toPositionRef.current, progress);
    if (rotationY !== undefined) {
      group.rotation.y = THREE.MathUtils.lerp(fromRotationRef.current, toRotationRef.current, progress);
    }
  });

  return { groupRef, initialPosition: initialPositionRef.current };
}
