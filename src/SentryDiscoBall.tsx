import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

const DEPTH = 0.6;
const TILE_SIZE = 0.1;
const TILE_GAP = 0.012;
const SVG_SCALE = 0.1;

const SENTRY_SVG_PATH =
  "M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z";

function parseSentryShapes(): THREE.Shape[] {
  const loader = new SVGLoader();
  const svgData = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 44"><path d="${SENTRY_SVG_PATH}"/></svg>`;
  const data = loader.parse(svgData);

  const shapes: THREE.Shape[] = [];
  for (const path of data.paths) {
    const pathShapes = SVGLoader.createShapes(path);
    shapes.push(...pathShapes);
  }
  return shapes;
}

function isPointInShapes(
  px: number,
  py: number,
  polygons: THREE.Vector2[][]
): boolean {
  for (const poly of polygons) {
    if (isPointInPolygon(px, py, poly)) return true;
  }
  return false;
}

function isPointInPolygon(
  px: number,
  py: number,
  polygon: THREE.Vector2[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function shapesToPolygons(shapes: THREE.Shape[]): THREE.Vector2[][] {
  return shapes.map((shape) => shape.getPoints(120));
}

function generateTileMatrices(
  shapes: THREE.Shape[],
  centerX: number,
  centerY: number
): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = [];
  const tileStep = TILE_SIZE + TILE_GAP;
  const halfDepth = DEPTH / 2;
  const polygons = shapesToPolygons(shapes);

  // Bounding box in scaled SVG coordinates
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const poly of polygons) {
    for (const p of poly) {
      minX = Math.min(minX, p.x * SVG_SCALE);
      maxX = Math.max(maxX, p.x * SVG_SCALE);
      minY = Math.min(minY, p.y * SVG_SCALE);
      maxY = Math.max(maxY, p.y * SVG_SCALE);
    }
  }

  // Scale polygons for hit testing in world space
  const scaledPolygons = polygons.map((poly) =>
    poly.map((p) => new THREE.Vector2(p.x * SVG_SCALE, p.y * SVG_SCALE))
  );

  // --- Front face (normal +Z) ---
  for (let x = minX; x <= maxX; x += tileStep) {
    for (let y = minY; y <= maxY; y += tileStep) {
      if (!isPointInShapes(x, y, scaledPolygons)) continue;
      const mat = new THREE.Matrix4();
      mat.compose(
        new THREE.Vector3(x - centerX, -(y - centerY), halfDepth + 0.004),
        new THREE.Quaternion(),
        new THREE.Vector3(TILE_SIZE, TILE_SIZE, 1)
      );
      matrices.push(mat);
    }
  }

  // --- Back face (normal -Z) ---
  const backQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI
  );
  for (let x = minX; x <= maxX; x += tileStep) {
    for (let y = minY; y <= maxY; y += tileStep) {
      if (!isPointInShapes(x, y, scaledPolygons)) continue;
      const mat = new THREE.Matrix4();
      mat.compose(
        new THREE.Vector3(x - centerX, -(y - centerY), -halfDepth - 0.004),
        backQ,
        new THREE.Vector3(TILE_SIZE, TILE_SIZE, 1)
      );
      matrices.push(mat);
    }
  }

  // --- Side faces (along outlines) ---
  for (const poly of scaledPolygons) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const eDx = b.x - a.x;
      const eDy = b.y - a.y;
      const eLen = Math.sqrt(eDx * eDx + eDy * eDy);
      if (eLen < 0.001) continue;

      // Outward normal (2D perpendicular)
      const nx = -eDy / eLen;
      const ny = eDx / eLen;

      const tilesAlongEdge = Math.max(1, Math.round(eLen / tileStep));
      const tilesAlongDepth = Math.max(1, Math.round(DEPTH / tileStep));

      const edgeTileW = (eLen / tilesAlongEdge) * (TILE_SIZE / tileStep);
      const edgeTileH = (DEPTH / tilesAlongDepth) * (TILE_SIZE / tileStep);

      for (let ei = 0; ei < tilesAlongEdge; ei++) {
        const t = (ei + 0.5) / tilesAlongEdge;
        const ex = a.x + eDx * t - centerX;
        const ey = -(a.y + eDy * t - centerY);

        for (let di = 0; di < tilesAlongDepth; di++) {
          const dt = (di + 0.5) / tilesAlongDepth;
          const ez = -halfDepth + DEPTH * dt;

          const px = ex + nx * 0.004;
          const py = ey - ny * 0.004;

          const angle = Math.atan2(-ny, nx);
          const q = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
            .multiply(
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                Math.PI / 2
              )
            );

          const mat = new THREE.Matrix4();
          mat.compose(
            new THREE.Vector3(px, py, ez),
            q,
            new THREE.Vector3(edgeTileH, edgeTileW, 1)
          );
          matrices.push(mat);
        }
      }
    }
  }

  return matrices;
}

function SentryLogoMesh() {
  const groupRef = useRef<THREE.Group>(null);
  const instanceRef = useRef<THREE.InstancedMesh>(null);

  const { matrices, solidGeo } = useMemo(() => {
    const shapes = parseSentryShapes();

    // Build extruded base geometry
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: DEPTH / SVG_SCALE,
      bevelEnabled: true,
      bevelThickness: 0.3,
      bevelSize: 0.3,
      bevelSegments: 3,
    };

    const geos: THREE.ExtrudeGeometry[] = [];
    for (const shape of shapes) {
      geos.push(new THREE.ExtrudeGeometry(shape, extrudeSettings));
    }
    const merged = mergeBufferGeometries(geos);
    geos.forEach((g) => g.dispose());

    // Scale and center
    merged.scale(SVG_SCALE, -SVG_SCALE, SVG_SCALE);
    merged.computeBoundingBox();
    const box = merged.boundingBox!;
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    merged.translate(-cx, -cy, -cz);
    merged.computeVertexNormals();

    // Compute center in scaled SVG space for tile generation
    let sMinX = Infinity,
      sMaxX = -Infinity,
      sMinY = Infinity,
      sMaxY = -Infinity;
    for (const shape of shapes) {
      const pts = shape.getPoints(120);
      for (const p of pts) {
        sMinX = Math.min(sMinX, p.x * SVG_SCALE);
        sMaxX = Math.max(sMaxX, p.x * SVG_SCALE);
        sMinY = Math.min(sMinY, p.y * SVG_SCALE);
        sMaxY = Math.max(sMaxY, p.y * SVG_SCALE);
      }
    }
    const centerX = (sMinX + sMaxX) / 2;
    const centerY = (sMinY + sMaxY) / 2;

    const mats = generateTileMatrices(shapes, centerX, centerY);
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
          color="#0e0a18"
          metalness={0.5}
          roughness={0.6}
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
    const idx = g.index;

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

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices[indexOffset + i] = idx.getX(i) + vertCount;
      }
      indexOffset += idx.count;
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

      <ambientLight intensity={0.5} />

      <directionalLight position={[5, 5, 8]} intensity={3} color="#ffffff" />

      <spotLight
        position={[3, 4, 8]}
        intensity={150}
        angle={0.4}
        penumbra={0.4}
        color="#ffffff"
        castShadow
      />

      <spotLight
        position={[-6, 2, 6]}
        intensity={80}
        angle={0.6}
        penumbra={0.7}
        color="#d8b4fe"
      />

      <spotLight
        position={[0, 2, -6]}
        intensity={60}
        angle={0.8}
        penumbra={0.9}
        color="#a78bfa"
      />

      <pointLight position={[0, -4, 4]} intensity={20} color="#c4b5fd" />

      <SentryLogoMesh />

      <Environment preset="city" />
    </>
  );
}
