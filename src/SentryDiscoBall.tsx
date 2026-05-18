import { useRef, useMemo } from "react";
import { useFrame, extend } from "@react-three/fiber";
import { Environment, shaderMaterial } from "@react-three/drei";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

const DEPTH = 0.55;
const SVG_SCALE = 0.1;

const SENTRY_SVG_PATH =
  "M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z";

// Custom shader material that creates a disco-ball tile grid pattern
// procedurally in world space. The entire surface is covered - tiles are
// the reflective mirror areas, grooves are thin dark lines between them.
const DiscoTileMaterial = shaderMaterial(
  {
    tileSize: 0.09,
    grooveWidth: 0.008,
    tileColor: new THREE.Color("#9b7ed0"),
    grooveColor: new THREE.Color("#08050e"),
    envMap: null as THREE.Texture | null,
    envMapIntensity: 2.5,
    lightDir1: new THREE.Vector3(0.4, 0.4, 0.8).normalize(),
    lightDir2: new THREE.Vector3(-0.5, 0.3, 0.6).normalize(),
    lightDir3: new THREE.Vector3(0.2, -0.3, 0.6).normalize(),
    time: 0,
  },
  // Vertex shader
  /* glsl */ `
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying vec3 vViewDir;

    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vViewDir = normalize(cameraPosition - worldPos.xyz);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  // Fragment shader
  /* glsl */ `
    uniform float tileSize;
    uniform float grooveWidth;
    uniform vec3 tileColor;
    uniform vec3 grooveColor;
    uniform float envMapIntensity;
    uniform vec3 lightDir1;
    uniform vec3 lightDir2;
    uniform vec3 lightDir3;
    uniform float time;

    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying vec3 vViewDir;

    // Tile grid in world space - works on every surface automatically
    float tilePattern(vec3 pos, vec3 normal) {
      // Project position onto the two axes perpendicular to the surface normal
      // This makes the grid follow the surface orientation
      vec3 absNormal = abs(normal);

      vec2 uv;
      if (absNormal.z >= absNormal.x && absNormal.z >= absNormal.y) {
        uv = pos.xy;  // Front/back faces
      } else if (absNormal.x >= absNormal.y) {
        uv = pos.yz;  // Left/right side faces
      } else {
        uv = pos.xz;  // Top/bottom faces
      }

      // Create grid
      vec2 cell = fract(uv / tileSize);
      float halfGroove = grooveWidth / tileSize * 0.5;

      // Groove at edges of each cell
      float gx = smoothstep(0.0, halfGroove, cell.x) * smoothstep(0.0, halfGroove, 1.0 - cell.x);
      float gy = smoothstep(0.0, halfGroove, cell.y) * smoothstep(0.0, halfGroove, 1.0 - cell.y);

      return gx * gy;
    }

    void main() {
      vec3 N = normalize(vWorldNormal);
      vec3 V = normalize(vViewDir);

      float tile = tilePattern(vWorldPosition, N);

      // Per-tile slight normal perturbation for varied reflections
      vec2 cellId;
      {
        vec3 absN = abs(N);
        vec2 uv;
        if (absN.z >= absN.x && absN.z >= absN.y) uv = vWorldPosition.xy;
        else if (absN.x >= absN.y) uv = vWorldPosition.yz;
        else uv = vWorldPosition.xz;
        cellId = floor(uv / tileSize);
      }
      float hash1 = fract(sin(dot(cellId, vec2(127.1, 311.7))) * 43758.5453);
      float hash2 = fract(sin(dot(cellId, vec2(269.5, 183.3))) * 43758.5453);
      vec3 perturbedN = normalize(N + 0.04 * vec3(hash1 - 0.5, hash2 - 0.5, 0.0));

      // Lighting
      vec3 R = reflect(-V, perturbedN);

      // Multiple specular highlights
      float spec1 = pow(max(dot(R, lightDir1), 0.0), 80.0);
      float spec2 = pow(max(dot(R, lightDir2), 0.0), 60.0);
      float spec3 = pow(max(dot(R, lightDir3), 0.0), 40.0);

      float diff1 = max(dot(N, lightDir1), 0.0);
      float diff2 = max(dot(N, lightDir2), 0.0) * 0.6;
      float diff3 = max(dot(N, lightDir3), 0.0) * 0.4;
      float diffuse = diff1 + diff2 + diff3;

      // Fresnel for edge reflections
      float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);

      // Environment reflection approximation
      vec3 envColor = mix(
        vec3(0.15, 0.1, 0.25),   // Dark purple ambient
        vec3(0.7, 0.6, 0.9),     // Bright purple highlight
        pow(max(R.y * 0.5 + 0.5, 0.0), 2.0)
      ) * envMapIntensity;

      // Sparkle effect - bright flashes as rotation changes reflection angle
      float sparkle = pow(max(spec1, max(spec2, spec3)), 2.0);
      vec3 sparkleColor = vec3(1.0, 0.95, 1.0) * sparkle * 3.0;

      // Compose tile color
      vec3 mirrorColor = tileColor * (0.3 + diffuse * 0.4)
                       + envColor * (0.5 + fresnel * 0.5)
                       + vec3(1.0) * (spec1 * 1.5 + spec2 * 0.8 + spec3 * 0.5)
                       + sparkleColor;

      // Mix between groove and tile
      vec3 color = mix(grooveColor, mirrorColor, tile);

      // Tone mapping
      color = color / (color + vec3(1.0));

      gl_FragColor = vec4(color, 1.0);
    }
  `
);

extend({ DiscoTileMaterial });

declare module "@react-three/fiber" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ThreeElements {
    discoTileMaterial: object;
  }
}

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
    bevelSegments: 3,
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

function SentryLogoMesh() {
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const shapes = parseSentryShapes();
    return buildExtrudedGeometry(shapes);
  }, []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.25;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry}>
        <discoTileMaterial
          side={THREE.DoubleSide}
          tileSize={0.09}
          grooveWidth={0.006}
          tileColor={new THREE.Color("#9b7ed0")}
          grooveColor={new THREE.Color("#08050e")}
          envMapIntensity={2.5}
        />
      </mesh>
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
