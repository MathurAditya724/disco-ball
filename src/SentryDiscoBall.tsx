import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

const DEPTH = 0.6;
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

function buildExtrudedGeometry(shapes: THREE.Shape[]): THREE.BufferGeometry {
  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: DEPTH / SVG_SCALE,
    bevelEnabled: true,
    bevelThickness: 0.25,
    bevelSize: 0.25,
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
  return merged;
}

/**
 * Group triangles into coplanar face clusters, then tile each cluster
 * with a uniform grid. This avoids per-triangle tiling issues and
 * produces consistent tile coverage across the entire surface.
 */
function generateTilesFromGeometry(
  geometry: THREE.BufferGeometry
): THREE.Matrix4[] {
  const pos = geometry.getAttribute("position");
  const idx = geometry.index;
  if (!pos || !idx) return [];

  const step = TILE_SIZE + TILE_GAP;

  interface Face {
    verts: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    normal: THREE.Vector3;
    center: THREE.Vector3;
  }

  const faces: Face[] = [];
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();

  for (let i = 0; i < idx.count; i += 3) {
    va.fromBufferAttribute(pos, idx.getX(i));
    vb.fromBufferAttribute(pos, idx.getX(i + 1));
    vc.fromBufferAttribute(pos, idx.getX(i + 2));

    // Use geometric face normal (cross product), not smooth vertex normals
    const edge1 = new THREE.Vector3().subVectors(vb, va);
    const edge2 = new THREE.Vector3().subVectors(vc, va);
    const faceNorm = new THREE.Vector3().crossVectors(edge1, edge2);
    const area = faceNorm.length();
    if (area < 1e-8) continue;
    faceNorm.normalize();

    const center = new THREE.Vector3()
      .addVectors(va, vb)
      .add(vc)
      .divideScalar(3);

    faces.push({
      verts: [va.clone(), vb.clone(), vc.clone()],
      normal: faceNorm,
      center: center,
    });
  }

  // Group faces into coplanar clusters: same normal AND same plane offset
  const clusters: Face[][] = [];
  const assigned = new Array(faces.length).fill(false);
  const normalThreshold = 0.985;
  const planeDistThreshold = 0.015;

  for (let i = 0; i < faces.length; i++) {
    if (assigned[i]) continue;
    const cluster: Face[] = [faces[i]];
    assigned[i] = true;
    const refNormal = faces[i].normal;
    const refPlaneDist = faces[i].center.dot(refNormal);

    for (let j = i + 1; j < faces.length; j++) {
      if (assigned[j]) continue;
      if (refNormal.dot(faces[j].normal) < normalThreshold) continue;
      const planeDist = Math.abs(faces[j].center.dot(refNormal) - refPlaneDist);
      if (planeDist > planeDistThreshold) continue;
      cluster.push(faces[j]);
      assigned[j] = true;
    }
    clusters.push(cluster);
  }

  // For each cluster, build a local 2D coordinate frame and tile it
  const allMatrices: THREE.Matrix4[] = [];
  const globalPlaced = new Set<string>();

  for (const cluster of clusters) {
    if (cluster.length === 0) continue;

    // Average normal for the cluster
    const avgNormal = new THREE.Vector3();
    for (const f of cluster) avgNormal.add(f.normal);
    avgNormal.normalize();

    // Build tangent frame
    const up =
      Math.abs(avgNormal.y) > 0.99
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(up, avgNormal).normalize();
    const bitangent = new THREE.Vector3()
      .crossVectors(avgNormal, tangent)
      .normalize();

    // Project all triangle vertices into 2D and collect triangles
    const tris2d: { a: THREE.Vector2; b: THREE.Vector2; c: THREE.Vector2 }[] = [];
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;

    const refPoint = cluster[0].center;
    for (const face of cluster) {
      const pts2d: THREE.Vector2[] = [];
      for (const v of face.verts) {
        const rel = new THREE.Vector3().subVectors(v, refPoint);
        const u = rel.dot(tangent);
        const vv = rel.dot(bitangent);
        pts2d.push(new THREE.Vector2(u, vv));
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, vv);
        maxV = Math.max(maxV, vv);
      }
      tris2d.push({ a: pts2d[0], b: pts2d[1], c: pts2d[2] });
    }

    // Snap grid to global alignment
    const startU = Math.floor(minU / step) * step;
    const startV = Math.floor(minV / step) * step;

    // Build rotation quaternion for tiles on this cluster
    const lookTarget = new THREE.Vector3().addVectors(refPoint, avgNormal);
    const lookMat = new THREE.Matrix4().lookAt(
      refPoint,
      lookTarget,
      Math.abs(avgNormal.y) > 0.99
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(0, 1, 0)
    );
    const quat = new THREE.Quaternion().setFromRotationMatrix(lookMat);

    for (let u = startU; u <= maxU; u += step) {
      for (let v = startV; v <= maxV; v += step) {
        const pt2d = new THREE.Vector2(u, v);
        let insideAny = false;
        for (const tri of tris2d) {
          if (pointInTriangle2D(pt2d, tri.a, tri.b, tri.c)) {
            insideAny = true;
            break;
          }
        }
        if (!insideAny) continue;

        // Convert back to 3D
        const worldPos = new THREE.Vector3()
          .copy(refPoint)
          .addScaledVector(tangent, u)
          .addScaledVector(bitangent, v)
          .addScaledVector(avgNormal, 0.003);

        // Deduplicate (tiles at cluster boundaries)
        const kx = Math.round(worldPos.x * 500);
        const ky = Math.round(worldPos.y * 500);
        const kz = Math.round(worldPos.z * 500);
        const key = `${kx},${ky},${kz}`;
        if (globalPlaced.has(key)) continue;
        globalPlaced.add(key);

        const mat = new THREE.Matrix4();
        mat.compose(
          worldPos,
          quat,
          new THREE.Vector3(TILE_SIZE, TILE_SIZE, 1)
        );
        allMatrices.push(mat);
      }
    }
  }

  return allMatrices;
}

function pointInTriangle2D(
  p: THREE.Vector2,
  a: THREE.Vector2,
  b: THREE.Vector2,
  c: THREE.Vector2
): boolean {
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(p1: THREE.Vector2, p2: THREE.Vector2, p3: THREE.Vector2): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

function SentryLogoMesh() {
  const groupRef = useRef<THREE.Group>(null);
  const instanceRef = useRef<THREE.InstancedMesh>(null);

  const { matrices, solidGeo } = useMemo(() => {
    const shapes = parseSentryShapes();
    const geo = buildExtrudedGeometry(shapes);
    const mats = generateTilesFromGeometry(geo);
    return { matrices: mats, solidGeo: geo };
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
