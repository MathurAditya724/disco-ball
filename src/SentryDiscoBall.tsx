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

function createDiscoMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#9b7ed0"),
    metalness: 1.0,
    roughness: 0.03,
    reflectivity: 1.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    envMapIntensity: 2.5,
    side: THREE.DoubleSide,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tileSize = { value: 0.09 };
    shader.uniforms.grooveWidth = { value: 0.007 };

    // Add varyings to vertex shader
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      `
      varying vec3 vWorldPos;
      varying vec3 vWorldNorm;
      void main() {
      `
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `
      #include <worldpos_vertex>
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vWorldNorm = normalize(mat3(modelMatrix) * normal);
      `
    );

    // Inject tile pattern into fragment shader
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `
      uniform float tileSize;
      uniform float grooveWidth;
      varying vec3 vWorldPos;
      varying vec3 vWorldNorm;

      float discoTilePattern(vec3 pos, vec3 norm) {
        vec3 absN = abs(norm);
        vec2 uv;
        if (absN.z >= absN.x && absN.z >= absN.y) {
          uv = pos.xy;
        } else if (absN.x >= absN.y) {
          uv = pos.yz;
        } else {
          uv = pos.xz;
        }
        vec2 cell = fract(uv / tileSize);
        float hg = grooveWidth / tileSize * 0.5;
        float gx = smoothstep(0.0, hg, cell.x) * smoothstep(0.0, hg, 1.0 - cell.x);
        float gy = smoothstep(0.0, hg, cell.y) * smoothstep(0.0, hg, 1.0 - cell.y);
        return gx * gy;
      }

      // Per-tile normal variation for disco ball shimmer
      vec3 perturbNormal(vec3 norm, vec3 pos) {
        vec3 absN = abs(norm);
        vec2 uv;
        if (absN.z >= absN.x && absN.z >= absN.y) uv = pos.xy;
        else if (absN.x >= absN.y) uv = pos.yz;
        else uv = pos.xz;
        vec2 cellId = floor(uv / tileSize);
        float h1 = fract(sin(dot(cellId, vec2(127.1, 311.7))) * 43758.5453);
        float h2 = fract(sin(dot(cellId, vec2(269.5, 183.3))) * 43758.5453);
        return normalize(norm + 0.06 * vec3(h1 - 0.5, h2 - 0.5, 0.0));
      }

      void main() {
      `
    );

    // After normal mapping, perturb the normal per-tile for varied reflections
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `
      #include <normal_fragment_maps>
      normal = perturbNormal(vWorldNorm, vWorldPos);
      `
    );

    // Modify diffuse color and roughness based on tile pattern
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      float tileMask = discoTilePattern(vWorldPos, vWorldNorm);
      // Grooves: dark and rough. Tiles: bright and mirror-like.
      vec3 grooveCol = vec3(0.02, 0.015, 0.03);
      diffuseColor.rgb = mix(grooveCol, diffuseColor.rgb, tileMask);
      `
    );

    // Also vary roughness: grooves are matte, tiles are mirror
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `
      #include <roughnessmap_fragment>
      roughnessFactor = mix(0.9, roughnessFactor, tileMask);
      `
    );

    // Vary metalness too
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <metalnessmap_fragment>",
      `
      #include <metalnessmap_fragment>
      metalnessFactor = mix(0.1, metalnessFactor, tileMask);
      `
    );
  };

  return mat;
}

function SentryLogoMesh() {
  const groupRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    const shapes = parseSentryShapes();
    return buildExtrudedGeometry(shapes);
  }, []);

  const material = useMemo(() => createDiscoMaterial(), []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.25;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} material={material} />
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
