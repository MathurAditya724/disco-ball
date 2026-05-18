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

  // Merge geometries - handle both indexed and non-indexed
  let totalVerts = 0;
  let totalIdx = 0;
  let hasIndices = true;
  for (const g of geos) {
    totalVerts += g.getAttribute("position").count;
    if (g.index) {
      totalIdx += g.index.count;
    } else {
      hasIndices = false;
    }
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  let vOff = 0;

  if (hasIndices) {
    const indices = new Uint32Array(totalIdx);
    let iOff = 0;
    let vCount = 0;
    for (const g of geos) {
      const p = g.getAttribute("position");
      const n = g.getAttribute("normal");
      const idx = g.index!;
      for (let i = 0; i < p.count; i++) {
        positions[(vOff + i) * 3] = p.getX(i);
        positions[(vOff + i) * 3 + 1] = p.getY(i);
        positions[(vOff + i) * 3 + 2] = p.getZ(i);
        if (n) {
          normals[(vOff + i) * 3] = n.getX(i);
          normals[(vOff + i) * 3 + 1] = n.getY(i);
          normals[(vOff + i) * 3 + 2] = n.getZ(i);
        }
      }
      for (let i = 0; i < idx.count; i++) {
        indices[iOff + i] = idx.getX(i) + vCount;
      }
      iOff += idx.count;
      vCount += p.count;
      vOff += p.count;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    merged.setIndex(new THREE.BufferAttribute(indices, 1));
    geos.forEach((g) => g.dispose());
    return finalize(merged);
  }

  // Non-indexed: just concatenate position and normal arrays
  for (const g of geos) {
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      positions[(vOff + i) * 3] = p.getX(i);
      positions[(vOff + i) * 3 + 1] = p.getY(i);
      positions[(vOff + i) * 3 + 2] = p.getZ(i);
      if (n) {
        normals[(vOff + i) * 3] = n.getX(i);
        normals[(vOff + i) * 3 + 1] = n.getY(i);
        normals[(vOff + i) * 3 + 2] = n.getZ(i);
      }
    }
    vOff += p.count;
  }
  geos.forEach((g) => g.dispose());

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return finalize(merged);
}

function finalize(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.scale(SVG_SCALE, -SVG_SCALE, SVG_SCALE);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  geo.translate(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + box.max.y) / 2,
    -(box.min.z + box.max.z) / 2
  );
  geo.computeVertexNormals();

  // Triplanar UVs
  const pos = geo.getAttribute("position");
  const norm = geo.getAttribute("normal");
  const uvs = new Float32Array(pos.count * 2);
  const uvScale = 1 / 0.09;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const nz = Math.abs(norm.getZ(i));
    if (nz >= nx && nz >= ny) {
      uvs[i * 2] = pos.getX(i) * uvScale;
      uvs[i * 2 + 1] = pos.getY(i) * uvScale;
    } else if (nx >= ny) {
      uvs[i * 2] = pos.getY(i) * uvScale;
      uvs[i * 2 + 1] = pos.getZ(i) * uvScale;
    } else {
      uvs[i * 2] = pos.getX(i) * uvScale;
      uvs[i * 2 + 1] = pos.getZ(i) * uvScale;
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geo;
}

function createTileTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0a0714";
  ctx.fillRect(0, 0, size, size);

  const g = size * 0.04;
  const w = size - g * 2;
  const r = 8;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(g + r, g);
  ctx.lineTo(g + w - r, g);
  ctx.quadraticCurveTo(g + w, g, g + w, g + r);
  ctx.lineTo(g + w, g + w - r);
  ctx.quadraticCurveTo(g + w, g + w, g + w - r, g + w);
  ctx.lineTo(g + r, g + w);
  ctx.quadraticCurveTo(g, g + w, g, g + w - r);
  ctx.lineTo(g, g + r);
  ctx.quadraticCurveTo(g, g, g + r, g);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createRoughnessTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  const g = size * 0.04;
  const w = size - g * 2;
  const r = 8;
  ctx.fillStyle = "#0a0a0a";
  ctx.beginPath();
  ctx.moveTo(g + r, g);
  ctx.lineTo(g + w - r, g);
  ctx.quadraticCurveTo(g + w, g, g + w, g + r);
  ctx.lineTo(g + w, g + w - r);
  ctx.quadraticCurveTo(g + w, g + w, g + w - r, g + w);
  ctx.lineTo(g + r, g + w);
  ctx.quadraticCurveTo(g, g + w, g, g + w - r);
  ctx.lineTo(g, g + r);
  ctx.quadraticCurveTo(g, g, g + r, g);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function SentryLogoMesh() {
  const groupRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    const shapes = parseSentryShapes();
    return buildGeometry(shapes);
  }, []);

  const tileTex = useMemo(() => createTileTexture(), []);
  const roughTex = useMemo(() => createRoughnessTexture(), []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.25;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry}>
        <meshPhysicalMaterial
          map={tileTex}
          roughnessMap={roughTex}
          color="#9b7ed0"
          metalness={1.0}
          roughness={0.05}
          reflectivity={1.0}
          clearcoat={1.0}
          clearcoatRoughness={0.03}
          envMapIntensity={2.0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export default function SentryDiscoBall() {
  return (
    <>
      <color attach="background" args={["#08050e"]} />
      <ambientLight intensity={1.0} />
      <directionalLight position={[5, 5, 8]} intensity={5} color="#ffffff" />
      <spotLight position={[4, 4, 8]} intensity={200} angle={0.5} penumbra={0.4} color="#ffffff" />
      <spotLight position={[-5, 3, 6]} intensity={120} angle={0.6} penumbra={0.6} color="#d8b4fe" />
      <spotLight position={[2, -3, 6]} intensity={80} angle={0.7} penumbra={0.7} color="#a78bfa" />
      <pointLight position={[-3, -3, 5]} intensity={40} color="#c4b5fd" />
      <pointLight position={[3, 3, 5]} intensity={40} color="#ffffff" />
      <SentryLogoMesh />
      <Environment preset="city" />
    </>
  );
}
