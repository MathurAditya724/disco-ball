# Sentry Disco Ball

The [Sentry](https://sentry.io) logo as an interactive 3D disco ball — built with React, Three.js, and vibes.

Inspired by the Spotify disco ball logo trend.

## Stack

- **React 19** + **TypeScript**
- **Three.js** via `@react-three/fiber` and `@react-three/drei`
- **Vite** for dev/build
- Actual Sentry SVG glyph path parsed with `SVGLoader`, extruded into 3D, and covered in reflective tile panels using triplanar UV mapping

## Run locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). Scroll to zoom, drag to orbit.

## Build

```bash
pnpm build
pnpm preview
```

## License

MIT
