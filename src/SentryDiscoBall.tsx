import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";

const DEPTH = 0.5;
const TILE_SIZE = 0.085;
const GAP_FRACTION = 0.84;

/**
 * Build the Sentry logo as THREE.Shape objects.
 *
 * The Sentry logo consists of:
 * 1. An outer chevron/triangle - two thick legs meeting at an apex,
 *    the left leg curves into the bottom-left, the right leg has a
 *    short horizontal foot at bottom-right.
 * 2. A middle arc (larger) curving from bottom-left upward
 * 3. An inner arc (smaller) curving similarly
 *
 * The arcs share a center near the bottom-left of the triangle.
 * The overall shape resembles a stylized "A" with sound-wave arcs.
 */
function buildSentryShapes(): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  const sw = 0.30;

  // --- Part 1: Outer chevron ---
  {
    const shape = new THREE.Shape();

    // Outer triangle vertices
    const apexX = 0, apexY = 2.5;
    const leftX = -2.15, leftY = -1.4;
    const rightX = 2.15, rightY = -1.4;

    // Compute inner offset for thick stroke
    // Left leg: from apex to bottom-left
    const lDx = leftX - apexX, lDy = leftY - apexY;
    const lLen = Math.sqrt(lDx * lDx + lDy * lDy);
    const lPerpX = -lDy / lLen, lPerpY = lDx / lLen;

    // Right leg: from apex to bottom-right
    const rDx = rightX - apexX, rDy = rightY - apexY;
    const rLen = Math.sqrt(rDx * rDx + rDy * rDy);
    const rPerpX = rDy / rLen, rPerpY = -rDx / rLen;

    // Foot lengths
    const footH = 0.50;

    // Outer path: apex -> bottom-left -> foot -> inner-left up to inner-apex -> inner-right down to foot -> bottom-right -> back to apex
    shape.moveTo(apexX, apexY);
    shape.lineTo(leftX, leftY);
    // Left foot (horizontal segment going right)
    shape.lineTo(leftX + footH, leftY);
    // Inner left leg going up to inner apex
    const innerApexX = apexX + lPerpX * sw + rPerpX * sw;
    const innerApexY = apexY + lPerpY * sw * 0.55 + rPerpY * sw * 0.55;
    shape.lineTo(innerApexX, innerApexY);
    // Inner right leg going down
    shape.lineTo(rightX - footH, rightY);
    // Right foot
    shape.lineTo(rightX, rightY);
    // Close back to apex
    shape.lineTo(apexX, apexY);

    shapes.push(shape);
  }

  // --- Part 2: Middle arc ---
  {
    const shape = new THREE.Shape();
    // Arc center is at the bottom-left area (where the left leg meets the ground)
    const cx = -0.68, cy = -1.4;
    const outerR = 1.72;
    const innerR = outerR - sw;
    const startAngle = 0.06;
    const endAngle = Math.PI * 0.48;
    const segments = 48;

    // Outer arc
    for (let i = 0; i <= segments; i++) {
      const t = startAngle + (endAngle - startAngle) * (i / segments);
      const x = cx + outerR * Math.cos(t);
      const y = cy + outerR * Math.sin(t);
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    // Inner arc (reverse)
    for (let i = segments; i >= 0; i--) {
      const t = startAngle + (endAngle - startAngle) * (i / segments);
      shape.lineTo(cx + innerR * Math.cos(t), cy + innerR * Math.sin(t));
    }
    shape.closePath();
    shapes.push(shape);
  }

  // --- Part 3: Inner (smallest) arc ---
  {
    const shape = new THREE.Shape();
    const cx = -0.68, cy = -1.4;
    const outerR = 0.98;
    const innerR = outerR - sw;
    const startAngle = 0.08;
    const endAngle = Math.PI * 0.44;
    const segments = 36;

    for (let i = 0; i <= segments; i++) {
      const t = startAngle + (endAngle - startAngle) * (i / segments);
      const x = cx + outerR * Math.cos(t);
      const y = cy + outerR * Math.sin(t);
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    for (let i = segments; i >= 0; i--) {
      const t = startAngle + (endAngle - startAngle) * (i / segments);
      shape.lineTo(cx + innerR * Math.cos(t), cy + innerR * Math.sin(t));
    }
    shape.closePath();
    shapes.push(shape);
  }

  return shapes;
}

function isPointInShapes(px: number, py: number, shapes: THREE.Shape[]): boolean {
  for (const shape of shapes) {
    if (isPointInShape(px, py, shape)) return true;
  }
  return false;
}

function isPointInShape(px: number, py: number, shape: THREE.Shape): boolean {
  const pts = shape.getPoints(80);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    if (((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function generateAllTiles(shapes: THREE.Shape[]): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = [];
  const tileStep = TILE_SIZE / GAP_FRACTION;
  const halfDepth = DEPTH / 2;
  const tileSize = TILE_SIZE;

  // Bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const shape of shapes) {
    const pts = shape.getPoints(80);
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Front face tiles
  for (let x = minX; x <= maxX; x += tileStep) {
    for (let y = minY; y <= maxY; y += tileStep) {
      if (!isPointInShapes(x, y, shapes)) continue;
      const mat = new THREE.Matrix4();
      mat.compose(
        new THREE.Vector3(x - cx, y - cy, halfDepth + 0.002),
        new THREE.Quaternion(),
        new THREE.Vector3(tileSize, tileSize, 1)
      );
      matrices.push(mat);
    }
  }

  // Back face tiles
  const backQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), Math.PI
  );
  for (let x = minX; x <= maxX; x += tileStep) {
    for (let y = minY; y <= maxY; y += tileStep) {
      if (!isPointInShapes(x, y, shapes)) continue;
      const mat = new THREE.Matrix4();
      mat.compose(
        new THREE.Vector3(x - cx, y - cy, -halfDepth - 0.002),
        backQ,
        new THREE.Vector3(tileSize, tileSize, 1)
      );
      matrices.push(mat);
    }
  }

  // Side (edge) tiles along each shape outline
  for (const shape of shapes) {
    const pts = shape.getPoints(250);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const eDx = b.x - a.x;
      const eDy = b.y - a.y;
      const eLen = Math.sqrt(eDx * eDx + eDy * eDy);
      if (eLen < 0.001) continue;

      const nx = -eDy / eLen;
      const ny = eDx / eLen;

      const tilesAlongEdge = Math.max(1, Math.floor(eLen / tileStep));
      const tilesAlongDepth = Math.max(1, Math.floor(DEPTH / tileStep));

      for (let ei = 0; ei < tilesAlongEdge; ei++) {
        const t = (ei + 0.5) / tilesAlongEdge;
        const ex = a.x + eDx * t - cx;
        const ey = a.y + eDy * t - cy;

        for (let di = 0; di < tilesAlongDepth; di++) {
          const dt = (di + 0.5) / tilesAlongDepth;
          const ez = -halfDepth + DEPTH * dt;

          const px = ex + nx * 0.002;
          const py = ey + ny * 0.002;

          const angle = Math.atan2(ny, nx);
          const q = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), angle
          ).multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0), Math.PI / 2
            )
          );

          const sideTileH = Math.min(
            tileSize,
            (DEPTH / tilesAlongDepth) * GAP_FRACTION
          );
          const sideTileW = Math.min(
            tileSize,
            (eLen / tilesAlongEdge) * GAP_FRACTION
          );

          const mat = new THREE.Matrix4();
          mat.compose(
            new THREE.Vector3(px, py, ez),
            q,
            new THREE.Vector3(sideTileH, sideTileW, 1)
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
    const shapes = buildSentryShapes();

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 2,
    };

    const geos: THREE.ExtrudeGeometry[] = [];
    for (const shape of shapes) {
      geos.push(new THREE.ExtrudeGeometry(shape, extrudeSettings));
    }
    const merged = mergeBufferGeometries(geos);
    geos.forEach((g) => g.dispose());

    merged.computeBoundingBox();
    const box = merged.boundingBox!;
    merged.translate(
      -(box.min.x + box.max.x) / 2,
      -(box.min.y + box.max.y) / 2,
      -(box.min.z + box.max.z) / 2
    );

    const mats = generateAllTiles(shapes);
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
  merged.computeVertexNormals();
  return merged;
}

export default function SentryDiscoBall() {
  return (
    <>
      <color attach="background" args={["#08050e"]} />

      <ambientLight intensity={0.5} />

      {/* Key light - bright white from upper-right */}
      <directionalLight position={[5, 5, 8]} intensity={3} color="#ffffff" />

      {/* Strong front spot for specular highlights */}
      <spotLight
        position={[3, 4, 8]}
        intensity={150}
        angle={0.4}
        penumbra={0.4}
        color="#ffffff"
        castShadow
      />

      {/* Fill from the left - soft purple */}
      <spotLight
        position={[-6, 2, 6]}
        intensity={80}
        angle={0.6}
        penumbra={0.7}
        color="#d8b4fe"
      />

      {/* Rim light from behind for edge definition */}
      <spotLight
        position={[0, 2, -6]}
        intensity={60}
        angle={0.8}
        penumbra={0.9}
        color="#a78bfa"
      />

      {/* Bottom fill */}
      <pointLight position={[0, -4, 4]} intensity={20} color="#c4b5fd" />

      <SentryLogoMesh />

      <Environment preset="city" />
    </>
  );
}
