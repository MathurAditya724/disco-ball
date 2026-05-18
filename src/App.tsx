import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import SentryDiscoBall from "./SentryDiscoBall";

function App() {
  return (
    <main className="app">
      <Canvas
        camera={{ position: [0, 0, 7], fov: 50 }}
        gl={{ antialias: true, toneMapping: 3 }}
        dpr={[1, 2]}
      >
        <SentryDiscoBall />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.3}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={(2 * Math.PI) / 3}
        />
      </Canvas>
      <div className="title">
        <h1>SENTRY</h1>
        <p>disco edition</p>
      </div>
    </main>
  );
}

export default App;
