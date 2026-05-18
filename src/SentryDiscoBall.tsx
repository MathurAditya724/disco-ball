import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

const DEPTH = 0.55;
const SVG_SCALE = 0.1;

const SENTRY_SVG_PATH =
  "M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z";

function parseSentryShapes(): THREE.Shape[] {
  const loader = new SVGLoader();
  const svgData = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 44"><path d="${SENTRY_SVG_PATH}"/></svg>`;
  const data = loader.parse(svgData);
  const shapes: THREE.Shape[] = [];
  for (const path of data.paths) {
    shapes.push(...SVGLoader.createShapes(path));
  }
  return shapes;
}

function buildGeometry(shapes: THREE.Shape[]): THREE.BufferGeometry {
  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: DEPTH / SVG_SCALE,
    bevelEnabled: true,
    bevelThickness: 0.25,
    bevelSize: 0.25,
    bevelSegments: 3,
  };

  const geos: THREE.ExtrudeGeometry[] = [];
  for (const shape of shapes) {
    geos.push(new THREE.ExtrudeGeometry(shape, extrudeSettings));
  }
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());

  merged.scale(SVG_SCALE, -SVG_SCALE, SVG_SCALE);
  merged.computeBoundingBox();
  const box = merged.boundingBox!;
  merged.translate(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + box.max.y) / 2,
    -(box.min.z + box.max.z) / 2
  );
  merged.computeVertexNormals();
  return merged;
}

/**
 * Generate a grid-pattern texture that creates the disco tile look.
 * Each cell is bright (white) with thin dark borders (grooves).
 */
function createTileTexture(
  resolution: number,
  gridCells: number,
  grooveFraction: number
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext("2d")!;

  const cellSize = resolution / gridCells;
  const grooveSize = cellSize * grooveFraction;

  // Fill background with groove color
  ctx.fillStyle = "#0a0714";
  ctx.fillRect(0, 0, resolution, resolution);

  // Draw bright tile cells
  ctx.fillStyle = "#ffffff";
  for (let gx = 0; gx < gridCells; gx++) {
    for (let gy = 0; gy < gridCells; gy++) {
      const x = gx * cellSize + grooveSize / 2;
      const y = gy * cellSize + grooveSize / 2;
      const s = cellSize - grooveSize;

      // Slightly rounded corners for a nicer look
      const r = Math.min(s * 0.08, 3);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + s - r, y);
      ctx.quadraticCurveTo(x + s, y, x + s, y + r);
      ctx.lineTo(x + s, y + s - r);
      ctx.quadraticCurveTo(x + s, y + s, x + s - r, y + s);
      ctx.lineTo(x + r, y + s);
      ctx.quadraticCurveTo(x, y + s, x, y + s - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/**
 * Build a custom UV attribute based on triplanar projection:
 * for each vertex, pick the two world-space axes most perpendicular
 * to the vertex normal, and use them as UV coordinates.
 */
function applyTriplanarUVs(
  geometry: THREE.BufferGeometry,
  tilesPerUnit: number
) {
  const pos = geometry.getAttribute("position");
  const norm = geometry.getAttribute("normal");
  const count = pos.count;
  const uvs = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const nz = Math.abs(norm.getZ(i));

    let u: number, v: number;
    if (nz >= nx && nz >= ny) {
      // Front/back: use XY
      u = pos.getX(i);
      v = pos.getY(i);
    } else if (nx >= ny) {
      // Left/right: use YZ
      u = pos.getY(i);
      v = pos.getZ(i);
    } else {
      // Top/bottom: use XZ
      u = pos.getX(i);
      v = pos.getZ(i);
    }

    uvs[i * 2] = u * tilesPerUnit;
    uvs[i * 2 + 1] = v * tilesPerUnit;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

function SentryLogoMesh() {
  const groupRef = useRef<THREE.Group>(null);

  const { geometry, tileTexture, roughnessTexture } = useMemo(() => {
    const shapes = parseSentryShapes();
    const geo = buildGeometry(shapes);

    // Tile scale: how many tiles per world unit
    const tilesPerUnit = 1 / 0.09;
    applyTriplanarUVs(geo, tilesPerUnit);

    // Color/alpha texture for the tile pattern
    const tileTex = createTileTexture(1024, 1, 0.06);
    tileTex.repeat.set(1, 1);

    // Roughness map: tiles are smooth (dark=low roughness), grooves are rough (bright=high roughness)
    const roughCanvas = document.createElement("canvas");
    roughCanvas.width = 256;
    roughCanvas.height = 256;
    const rctx = roughCanvas.getContext("2d")!;
    const cellSize = 256;
    const grooveSize = cellSize * 0.06;

    // Grooves are rough (white = high roughness)
    rctx.fillStyle = "#ffffff";
    rctx.fillRect(0, 0, 256, 256);

    // Tiles are smooth (black = low roughness)
    rctx.fillStyle = "#0a0a0a";
    const x = grooveSize / 2;
    const y = grooveSize / 2;
    const s = cellSize - grooveSize;
    const r = Math.min(s * 0.08, 6);
    rctx.beginPath();
    rctx.moveTo(x + r, y);
    rctx.lineTo(x + s - r, y);
    rctx.quadraticCurveTo(x + s, y, x + s, y + r);
    rctx.lineTo(x + s, y + s - r);
    rctx.quadraticCurveTo(x + s, y + s, x + s - r, y + s);
    rctx.lineTo(x + r, y + s);
    rctx.quadraticCurveTo(x, y + s, x, y + s - r);
    rctx.lineTo(x, y + r);
    rctx.quadraticCurveTo(x, y, x + r, y);
    rctx.closePath();
    rctx.fill();

    const roughTex = new THREE.CanvasTexture(roughCanvas);
    roughTex.wrapS = THREE.RepeatWrapping;
    roughTex.wrapT = THREE.RepeatWrapping;

    return { geometry: geo, tileTexture: tileTex, roughnessTexture: roughTex };
  }, []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.25;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry}>
        <meshPhysicalMaterial
          color="#9b7ed0"
          map={tileTexture}
          roughnessMap={roughnessTexture}
          metalness={1.0}
          roughness={0.03}
          reflectivity={1.0}
          clearcoat={1.0}
          clearcoatRoughness={0.02}
          envMapIntensity={2.5}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function mergeGeometries(
  geometries: THREE.BufferGeometry[]
): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geometries) {
    totalVerts += g.getAttribute("position").count;
    totalIndices += g.index ? g.index.count : 0;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vertexOffset = 0;
  let indexOffset = 0;
  let vertCount = 0;

  for (const g of geometries) {
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const gIdx = g.index;

    for (let i = 0; i < p.count; i++) {
      positions[(vertexOffset + i) * 3] = p.getX(i);
      positions[(vertexOffset + i) * 3 + 1] = p.getY(i);
      positions[(vertexOffset + i) * 3 + 2] = p.getZ(i);
      if (n) {
        normals[(vertexOffset + i) * 3] = n.getX(i);
        normals[(vertexOffset + i) * 3 + 1] = n.getY(i);
        normals[(vertexOffset + i) * 3 + 2] = n.getZ(i);
      }
    }

    if (gIdx) {
      for (let i = 0; i < gIdx.count; i++) {
        indices[indexOffset + i] = gIdx.getX(i) + vertCount;
      }
      indexOffset += gIdx.count;
    }

    vertCount += p.count;
    vertexOffset += p.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

export default function SentryDiscoBall() {
  return (
    <>
      <color attach="background" args={["#08050e"]} />

      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 8]} intensity={4} color="#ffffff" />

      <spotLight
        position={[4, 4, 8]}
        intensity={180}
        angle={0.5}
        penumbra={0.4}
        color="#ffffff"
        castShadow
      />
      <spotLight
        position={[-5, 3, 6]}
        intensity={100}
        angle={0.6}
        penumbra={0.6}
        color="#d8b4fe"
      />
      <spotLight
        position={[2, -3, 6]}
        intensity={60}
        angle={0.7}
        penumbra={0.7}
        color="#a78bfa"
      />
      <spotLight
        position={[0, 2, -6]}
        intensity={50}
        angle={0.8}
        penumbra={0.9}
        color="#7c3aed"
      />
      <pointLight position={[-3, -3, 5]} intensity={30} color="#c4b5fd" />
      <pointLight position={[3, 3, 5]} intensity={30} color="#ffffff" />

      <SentryLogoMesh />

      <Environment preset="city" />
    </>
  );
}
