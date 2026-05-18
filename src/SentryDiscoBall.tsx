import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

const DEPTH = 0.55;
const TILE_SIZE = 0.09;
const TILE_GAP = 0.01;
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

function isPointInShapes(
  px: number,
  py: number,
  polygons: THREE.Vector2[][]
): boolean {
  for (const poly of polygons) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      if (
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

function generateTileMatrices(
  shapes: THREE.Shape[],
  centerX: number,
  centerY: number
): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = [];
  const step = TILE_SIZE + TILE_GAP;
  const halfDepth = DEPTH / 2;

  const polygons = shapes.map((s) => s.getPoints(150));
  const scaledPolygons = polygons.map((poly) =>
    poly.map((p) => new THREE.Vector2(p.x * SVG_SCALE, p.y * SVG_SCALE))
  );

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of scaledPolygons) {
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }

  // Front face
  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      if (!isPointInShapes(x, y, scaledPolygons)) continue;
      const mat = new THREE.Matrix4();
      mat.compose(
        new THREE.Vector3(x - centerX, -(y - centerY), halfDepth + 0.003),
        new THREE.Quaternion(),
        new THREE.Vector3(TILE_SIZE, TILE_SIZE, 1)
      );
      matrices.push(mat);
    }
  }

  // Back face
  const backQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI
  );
  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      if (!isPointInShapes(x, y, scaledPolygons)) continue;
      const mat = new THREE.Matrix4();
      mat.compose(
        new THREE.Vector3(x - centerX, -(y - centerY), -halfDepth - 0.003),
        backQ,
        new THREE.Vector3(TILE_SIZE, TILE_SIZE, 1)
      );
      matrices.push(mat);
    }
  }

  // Side faces - walk each polygon outline
  for (const poly of scaledPolygons) {
    let accumulated = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const edgeLen = Math.sqrt(dx * dx + dy * dy);
      if (edgeLen < 0.0005) continue;

      // 2D outward normal
      const nx = -dy / edgeLen;
      const ny = dx / edgeLen;

      // Rotation: face normal is (nx, -ny, 0) in world space (Y is flipped)
      // Build a quaternion that orients a Z-facing plane to face outward
      const outward = new THREE.Vector3(nx, -ny, 0).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        outward
      );

      // Place tiles along this edge segment
      const depthTiles = Math.max(1, Math.round(DEPTH / step));
      const depthTileSize = (DEPTH / depthTiles) - TILE_GAP;

      // Continue tiling along the perimeter with a running accumulator
      let along = accumulated;
      while (along < accumulated + edgeLen) {
        const localT = along - accumulated;
        const t = localT / edgeLen;
        if (t > 1) break;

        const wx = a.x + dx * t - centerX + nx * 0.003;
        const wy = -(a.y + dy * t - centerY) - (-ny) * 0.003;

        for (let di = 0; di < depthTiles; di++) {
          const dz = -halfDepth + (di + 0.5) * (DEPTH / depthTiles);

          const mat = new THREE.Matrix4();
          mat.compose(
            new THREE.Vector3(wx, wy, dz),
            quat,
            new THREE.Vector3(depthTileSize, TILE_SIZE, 1)
          );
          matrices.push(mat);
        }

        along += step;
      }

      accumulated += edgeLen;
    }
  }

  return matrices;
}

function SentryLogoMesh() {
  const groupRef = useRef<THREE.Group>(null);
  const instanceRef = useRef<THREE.InstancedMesh>(null);

  const { matrices, solidGeo } = useMemo(() => {
    const shapes = parseSentryShapes();

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: DEPTH / SVG_SCALE,
      bevelEnabled: true,
      bevelThickness: 0.2,
      bevelSize: 0.2,
      bevelSegments: 2,
    };

    const geos: THREE.ExtrudeGeometry[] = [];
    for (const shape of shapes) {
      geos.push(new THREE.ExtrudeGeometry(shape, extrudeSettings));
    }
    const merged = mergeBufferGeometries(geos);
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

    // Center in scaled SVG space
    let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
    for (const shape of shapes) {
      for (const p of shape.getPoints(150)) {
        sMinX = Math.min(sMinX, p.x * SVG_SCALE);
        sMaxX = Math.max(sMaxX, p.x * SVG_SCALE);
        sMinY = Math.min(sMinY, p.y * SVG_SCALE);
        sMaxY = Math.max(sMaxY, p.y * SVG_SCALE);
      }
    }
    const cx = (sMinX + sMaxX) / 2;
    const cy = (sMinY + sMaxY) / 2;

    const mats = generateTileMatrices(shapes, cx, cy);
    return { matrices: mats, solidGeo: merged };
  }, []);

  useEffect(() => {
    const mesh = instanceRef.current;
    if (!mesh) return;
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.25;
    }
  });

  const tileGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  return (
    <group ref={groupRef}>
      <mesh geometry={solidGeo}>
        <meshStandardMaterial
          color="#120c1f"
          metalness={0.4}
          roughness={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>

      <instancedMesh
        ref={instanceRef}
        args={[tileGeo, undefined, matrices.length]}
      >
        <meshPhysicalMaterial
          color="#8b6cc1"
          metalness={1.0}
          roughness={0.02}
          reflectivity={1}
          clearcoat={1}
          clearcoatRoughness={0.01}
          envMapIntensity={3.0}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  );
}

function mergeBufferGeometries(
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
