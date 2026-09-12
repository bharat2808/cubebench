import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, RoundedBox } from '@react-three/drei';
import { CanvasTexture, Group } from 'three';
import {
  applyMoves,
  faceletGeometry,
  type CubeState,
  type Face,
  type Move,
} from '../../cube-core/src/index';
const colors: Record<Face, string> = {
  U: '#eeeade',
  R: '#e98570',
  F: '#77d9b1',
  D: '#f0cd6e',
  L: '#efa265',
  B: '#75a9e4',
};
class RendererBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
function CubeFallback({ state, onTurn }: { state: CubeState; onTurn?: (face: string) => void }) {
  return (
    <div className="cube-unavailable">
      <p>3D rendering unavailable. Choose ↻ or ↺ on the labeled face you want to turn.</p>
      <div className="cube-net">
        {Object.entries(state.facelets).map(([face, stickers]) => (
          <div className="net-face" key={face}>
            <strong>{face} face</strong>
            <div className="net-face-actions" aria-label={face + ' face moves'}>
              <button
                type="button"
                aria-label={'Turn ' + face + ' clockwise'}
                disabled={!onTurn}
                onClick={() => onTurn?.(face)}
              >
                ↻
              </button>
              <button
                type="button"
                aria-label={'Turn ' + face + ' counterclockwise'}
                disabled={!onTurn}
                onClick={() => onTurn?.(face + "'")}
              >
                ↺
              </button>
            </div>
            <span
              className="net-stickers"
              style={{ gridTemplateColumns: `repeat(${state.size},minmax(0,1fr))` }}
            >
              {stickers.map((color, index) => (
                <span key={index} style={{ background: colors[color] }}>
                  {color}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function Stickers({
  state,
  active,
  progress,
  onTurn,
  labels,
}: {
  state: CubeState;
  active: Move | undefined;
  progress: React.MutableRefObject<number>;
  onTurn?: (face: string) => void;
  labels: boolean;
}) {
  const group = useRef<Group>(null);
  const n = state.size;
  const labelTextures = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(colors).map((face) => {
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 64;
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#132319';
          context.font = 'bold 46px sans-serif';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(face, 32, 34);
          return [face, new CanvasTexture(canvas)];
        }),
      ) as Record<Face, CanvasTexture>,
    [],
  );
  useEffect(
    () => () => Object.values(labelTextures).forEach((texture) => texture.dispose()),
    [labelTextures],
  );
  const stickers = useMemo(
    () =>
      Object.entries(state.facelets).flatMap(([face, values]) =>
        values.map((color, index) => ({
          face: face as Face,
          color,
          g: faceletGeometry(n, face as Face, index),
          index,
        })),
      ),
    [state, n],
  );
  useFrame(() => {
    if (!group.current) return;
    group.current.rotation.set(0, 0, 0);
    if (active) {
      // The engine represents an inverse quarter-turn as three turns so its
      // integer state transition stays canonical. Animate that as -90°/ +90°
      // instead of a visually misleading 270° sweep in the same direction.
      const visualQuarterTurns = ((active.quarterTurns + 2) % 4 + 4) % 4 - 2;
      group.current.rotation[(['x', 'y', 'z'] as const)[active.axis]] =
        (progress.current * visualQuarterTurns * Math.PI) / 2;
    }
  });
  const render = (moving: boolean) =>
    stickers
      .filter((s) => {
        const selected = !!active && active.layers.includes(s.g.position[active.axis]);
        return selected === moving;
      })
      .map((s) => {
        const p = s.g.position.map((v, i) => v - (n - 1) / 2 + s.g.normal[i]! * 0.5) as [
          number,
          number,
          number,
        ];
        const normal = s.g.normal;
        const rotation: [number, number, number] = normal[0]
          ? [0, (normal[0] * Math.PI) / 2, 0]
          : normal[1]
            ? [(-normal[1] * Math.PI) / 2, 0, 0]
            : [0, normal[2] < 0 ? Math.PI : 0, 0];
        return (
          <group key={s.face + s.index} position={p} rotation={rotation}>
            <RoundedBox
              args={[0.91, 0.91, 0.065]}
              radius={0.09}
              smoothness={3}
              onClick={(e) => {
                e.stopPropagation();
                if (e.delta < 5) onTurn?.(s.face);
              }}
            >
              <meshStandardMaterial color={colors[s.color]} roughness={0.3} metalness={0.08} />
            </RoundedBox>
            {labels && (
              <mesh position={[0, 0, 0.04]}>
                <planeGeometry args={[0.4, 0.4]} />
                <meshBasicMaterial map={labelTextures[s.color]} transparent />
              </mesh>
            )}
          </group>
        );
      });
  return (
    <group scale={3 / n}>
      <RoundedBox args={[n - 0.1, n - 0.1, n - 0.1]} radius={0.1}>
        <meshStandardMaterial color="#18231e" />
      </RoundedBox>
      {render(false)}
      <group ref={group}>{render(true)}</group>
    </group>
  );
}
export function Cube({
  initial,
  moves = [],
  speed = 220,
  paused = false,
  animate = true,
  labels = false,
  onTurn,
}: {
  initial: CubeState;
  moves?: Move[];
  speed?: number;
  paused?: boolean;
  animate?: boolean;
  labels?: boolean;
  onTurn?: (face: string) => void;
}) {
  const [state, setState] = useState(initial);
  const [webGL] = useState(supportsWebGL);
  const [contextLost, setContextLost] = useState(false);
  const [index, setIndex] = useState(0);
  const progress = useRef(0);
  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    setState(initial);
    setIndex(0);
    progress.current = 0;
  }, [initial]);
  useEffect(() => {
    if (!animate && index !== moves.length) {
      setState(applyMoves(initial, moves));
      setIndex(moves.length);
      progress.current = 0;
      return;
    }
    if (index > moves.length) {
      setState(applyMoves(initial, moves));
      setIndex(moves.length);
      progress.current = 0;
    }
  }, [animate, moves, index, initial]);
  useEffect(() => {
    if (!animate || paused || index >= moves.length) return;
    let prev = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      progress.current += reduced ? 1 : (now - prev) / speed;
      prev = now;
      if (progress.current >= 1) {
        setState((s) => applyMoves(s, [moves[index]!]));
        setIndex((i) => i + 1);
        progress.current = 0;
      } else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [animate, moves, index, speed, paused, reduced]);
  const fallback = <CubeFallback state={applyMoves(initial, moves)} onTurn={onTurn} />;
  if (!webGL || contextLost) return fallback;
  return (
    <RendererBoundary fallback={fallback}>
      <div
        className="cube-canvas"
        role="img"
        aria-label={`${initial.size} by ${initial.size} interactive cube. Drag to orbit; scroll to zoom. Use face move buttons to turn.`}
      >
        <Canvas
          fallback={<p>3D rendering unavailable. Use the face move buttons.</p>}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener(
              'webglcontextlost',
              (event) => {
                event.preventDefault();
                setContextLost(true);
              },
              { once: true },
            );
          }}
          camera={{ position: [5, 4.1, 5.8], fov: 39 }}
        >
          <ambientLight intensity={1.8} />
          <directionalLight position={[4, 8, 6]} intensity={2.6} />
          <Suspense fallback={null}>
            <Stickers
              state={state}
              active={moves[index]}
              progress={progress}
              onTurn={onTurn}
              labels={labels}
            />
          </Suspense>
          <OrbitControls enablePan={false} minDistance={5} maxDistance={12} />
        </Canvas>
      </div>
    </RendererBoundary>
  );
}
