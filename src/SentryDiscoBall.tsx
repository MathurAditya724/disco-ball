import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";

const BALL_RADIUS = 2.2;
const TILE_ROWS = 40;

function isInsideSentryLogo(
  theta: number,
  phi: number,
  radius: number
): boolean {
  const x = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);

  const nx = x / radius;
  const ny = y / radius;
  const nz = z / radius;

  if (nz < 0.15) return false;

  const px = nx / nz;
  const py = ny / nz;

  const scale = 2.8;
  const sx = px * scale;
  const sy = py * scale - 0.15;

  return isInSentryShape(sx, sy);
}

function isInSentryShape(x: number, y: number): boolean {
  const strokeWidth = 0.13;

  if (isOnOuterTriangle(x, y, strokeWidth)) return true;
  if (isOnMiddleArc(x, y, strokeWidth)) return true;
  if (isOnInnerArc(x, y, strokeWidth)) return true;

  return false;
}

function isOnOuterTriangle(x: number, y: number, sw: number): boolean {
  const topY = 1.3;
  const baseY = -1.0;
  const halfBase = 1.25;

  const height = topY - baseY;
  const leftSlope = (2 * halfBase) / height;

  const leftEdgeX = -halfBase + leftSlope * (y - baseY);
  const rightEdgeX = halfBase - leftSlope * (y - baseY);

  if (y < baseY || y > topY) return false;

  const onLeft =
    Math.abs(x - leftEdgeX) < sw && y > baseY + 0.05 && y < topY - 0.05;
  const onRight =
    Math.abs(x - rightEdgeX) < sw && y > baseY + 0.05 && y < topY - 0.05;

  const rightLegBottom = y < baseY + 0.35 && y > baseY - 0.05;
  const onBase =
    rightLegBottom &&
    x > rightEdgeX - sw * 1.5 &&
    x < rightEdgeX + halfBase * 0.35;

  const topArea = y > topY - 0.25 && y < topY + 0.05;
  const onTop = topArea && Math.abs(x) < sw * 1.2;

  return onLeft || onRight || onBase || onTop;
}

function isOnMiddleArc(x: number, y: number, sw: number): boolean {
  const cx = -0.45;
  const cy = -0.55;
  const outerR = 1.15;
  const innerR = outerR - sw * 2;

  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  const onArc = dist > innerR && dist < outerR;

  const angle = Math.atan2(y - cy, x - cx);
  const angleDeg = (angle * 180) / Math.PI;

  const inRange = angleDeg > 15 && angleDeg < 115;

  return onArc && inRange;
}

function isOnInnerArc(x: number, y: number, sw: number): boolean {
  const cx = -0.45;
  const cy = -0.55;
  const outerR = 0.65;
  const innerR = outerR - sw * 2;

  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  const onArc = dist > innerR && dist < outerR;

  const angle = Math.atan2(y - cy, x - cx);
  const angleDeg = (angle * 180) / Math.PI;

  const inRange = angleDeg > 10 && angleDeg < 100;

  return onArc && inRange;
}

interface TileData {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  width: number;
  height: number;
  isLogo: boolean;
}

function generateTiles(): TileData[] {
  const tiles: TileData[] = [];

  for (let row = 1; row < TILE_ROWS; row++) {
    const phi = (Math.PI * row) / TILE_ROWS;
    const rowRadius = BALL_RADIUS * Math.sin(phi);
    const circumference = 2 * Math.PI * rowRadius;
    const tileArcHeight = (Math.PI * BALL_RADIUS) / TILE_ROWS;
    const tilesInRow = Math.max(
      6,
      Math.floor(circumference / (tileArcHeight * 0.95))
    );

    for (let col = 0; col < tilesInRow; col++) {
      const theta = (2 * Math.PI * col) / tilesInRow + (row % 2) * 0.02;

      const x = BALL_RADIUS * Math.sin(phi) * Math.cos(theta);
      const y = BALL_RADIUS * Math.cos(phi);
      const z = BALL_RADIUS * Math.sin(phi) * Math.sin(theta);

      const logo = isInsideSentryLogo(theta, phi, BALL_RADIUS);

      const tileWidth = ((2 * Math.PI * rowRadius) / tilesInRow) * 0.88;
      const tileHeight = tileArcHeight * 0.88;

      tiles.push({
        position: new THREE.Vector3(x, y, z),
        normal: new THREE.Vector3(x, y, z).normalize(),
        width: tileWidth,
        height: tileHeight,
        isLogo: logo,
      });
    }
  }

  return tiles;
}

function DiscoTiles() {
  const groupRef = useRef<THREE.Group>(null);
  const tiles = useMemo(() => generateTiles(), []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.15;
    }
  });

  const mirrorTiles = useMemo(() => tiles.filter((t) => !t.isLogo), [tiles]);
  const logoTiles = useMemo(() => tiles.filter((t) => t.isLogo), [tiles]);

  const mirrorGeometries = useMemo(() => {
    return mirrorTiles.map((tile) => {
      const geo = new THREE.PlaneGeometry(tile.width, tile.height);
      const dummy = new THREE.Object3D();
      dummy.position.copy(tile.position);
      dummy.lookAt(tile.position.clone().multiplyScalar(2));
      dummy.updateMatrix();
      geo.applyMatrix4(dummy.matrix);
      return geo;
    });
  }, [mirrorTiles]);

  const mirrorMerged = useMemo(() => {
    if (mirrorGeometries.length === 0) return new THREE.BufferGeometry();
    const merged = mergeGeometries(mirrorGeometries);
    mirrorGeometries.forEach((g) => g.dispose());
    return merged;
  }, [mirrorGeometries]);

  const logoGeometries = useMemo(() => {
    return logoTiles.map((tile) => {
      const geo = new THREE.PlaneGeometry(tile.width, tile.height);
      const dummy = new THREE.Object3D();
      dummy.position.copy(tile.position);
      dummy.lookAt(tile.position.clone().multiplyScalar(2));
      dummy.updateMatrix();
      geo.applyMatrix4(dummy.matrix);
      return geo;
    });
  }, [logoTiles]);

  const logoMerged = useMemo(() => {
    if (logoGeometries.length === 0) return new THREE.BufferGeometry();
    const merged = mergeGeometries(logoGeometries);
    logoGeometries.forEach((g) => g.dispose());
    return merged;
  }, [logoGeometries]);

  return (
    <group ref={groupRef}>
      <mesh geometry={mirrorMerged}>
        <meshPhysicalMaterial
          color="#362d59"
          metalness={0.95}
          roughness={0.05}
          reflectivity={1}
          clearcoat={1}
          clearcoatRoughness={0.05}
          envMapIntensity={2.5}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh geometry={logoMerged}>
        <meshStandardMaterial
          color="#0a0a0a"
          metalness={0.1}
          roughness={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh>
        <sphereGeometry args={[BALL_RADIUS * 0.985, 64, 64]} />
        <meshStandardMaterial
          color="#1a1128"
          metalness={0.3}
          roughness={0.8}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}

function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geometries) {
    totalVerts += g.getAttribute("position").count;
    totalIndices += g.index ? g.index.count : 0;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalIndices);

  let vertexOffset = 0;
  let indexOffset = 0;
  let vertCount = 0;

  for (const g of geometries) {
    const pos = g.getAttribute("position");
    const norm = g.getAttribute("normal");
    const uv = g.getAttribute("uv");
    const idx = g.index;

    for (let i = 0; i < pos.count; i++) {
      positions[(vertexOffset + i) * 3] = pos.getX(i);
      positions[(vertexOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vertexOffset + i) * 3 + 2] = pos.getZ(i);
      if (norm) {
        normals[(vertexOffset + i) * 3] = norm.getX(i);
        normals[(vertexOffset + i) * 3 + 1] = norm.getY(i);
        normals[(vertexOffset + i) * 3 + 2] = norm.getZ(i);
      }
      if (uv) {
        uvs[(vertexOffset + i) * 2] = uv.getX(i);
        uvs[(vertexOffset + i) * 2 + 1] = uv.getY(i);
      }
    }

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices[indexOffset + i] = idx.getX(i) + vertCount;
      }
      indexOffset += idx.count;
    }

    vertCount += pos.count;
    vertexOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeVertexNormals();

  return merged;
}

function Sparkles() {
  const count = 60;
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const sparkleData = useMemo(() => {
    const data = [];
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const r = BALL_RADIUS + 0.3 + Math.random() * 2.5;
      data.push({
        position: new THREE.Vector3(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta)
        ),
        speed: 0.5 + Math.random() * 2,
        offset: Math.random() * Math.PI * 2,
        scale: 0.01 + Math.random() * 0.03,
      });
    }
    return data;
  }, []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const time = clock.getElapsedTime();
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const d = sparkleData[i];
      const brightness = Math.max(0, Math.sin(time * d.speed + d.offset));
      const s = d.scale * brightness * 3;
      dummy.position.copy(d.position);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
    </instancedMesh>
  );
}

function LightRays() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.1;
      groupRef.current.rotation.z = Math.sin(clock.getElapsedTime() * 0.3) * 0.1;
    }
  });

  const rays = useMemo(() => {
    const result = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      result.push({
        rotation: [0, 0, angle] as [number, number, number],
        length: 6 + Math.random() * 3,
      });
    }
    return result;
  }, []);

  return (
    <group ref={groupRef}>
      {rays.map((ray, i) => (
        <mesh key={i} rotation={ray.rotation} position={[0, 0, 0]}>
          <planeGeometry args={[0.02, ray.length]} />
          <meshBasicMaterial
            color="#9c84c9"
            transparent
            opacity={0.08}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

export default function SentryDiscoBall() {
  return (
    <>
      <color attach="background" args={["#050208"]} />
      <fog attach="fog" args={["#050208", 8, 18]} />

      <ambientLight intensity={0.15} />

      <spotLight
        position={[5, 5, 5]}
        intensity={60}
        angle={0.5}
        penumbra={0.5}
        color="#8b6fc0"
        castShadow
      />
      <spotLight
        position={[-4, 3, 4]}
        intensity={40}
        angle={0.6}
        penumbra={0.7}
        color="#c084fc"
      />
      <spotLight
        position={[0, -3, 5]}
        intensity={25}
        angle={0.8}
        penumbra={0.8}
        color="#6d48a8"
      />
      <pointLight position={[3, 0, 4]} intensity={15} color="#ffffff" />
      <pointLight position={[-3, 2, 3]} intensity={10} color="#9f7aea" />

      <DiscoTiles />
      <Sparkles />
      <LightRays />

      <Environment preset="night" />
    </>
  );
}
