import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Box,
  ArrowUpRight,
  ArrowRight,
  Activity,
  Terminal,
  Settings,
  ChevronRight,
  ShieldCheck,
  Play,
  Pause,
  Plus,
  Hand,
  Globe,
  Command,
} from 'lucide-react';
import {
  createSolved,
  generateScramble,
  parseMoves,
  applyMoves,
  isSolved,
  type CubeState,
} from '../../cube-core/src/index';
import type { MatchView, CubeEvent, ResultRecord, RunView } from '../../shared-contracts/src/index';
const CubeView = React.lazy(() => import('./Cube').then((module) => ({ default: module.Cube })));
function Cube(props: React.ComponentProps<typeof import('./Cube').Cube>) {
  return (
    <React.Suspense fallback={<div className="cube-canvas empty">Loading cube…</div>}>
      <CubeView {...props} />
    </React.Suspense>
  );
}
import './style.css';
const sizes = [2, 3, 4, 5, 6, 7];
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api' + path, {
    headers: body ? { 'Content-Type': 'application/json', 'X-CubeBench': '1' } : {},
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false)
    throw Error(data.error?.message || data.error || 'Request failed');
  return data as T;
}
function useData<T>(path: string, initial: T) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (live) {
          setData(d);
          setError('');
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(String(e.message));
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [path]);
  return { data, error, loading, setData };
}
const time = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
function Size({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label>
      Cube size
      <select aria-label="Cube size" value={value} onChange={(e) => onChange(+e.target.value)}>
        {sizes.map((n) => (
          <option key={n} value={n}>
            {n} × {n}
          </option>
        ))}
      </select>
    </label>
  );
}
function Empty({
  title = 'No results yet.',
  text = 'Completed runs will appear here. Every number comes from a real attempt.',
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <Box size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || 'arena');
  const [contrast, setContrast] = useState(false);
  useEffect(() => {
    const fn = () => setRoute(location.hash.slice(1) || 'arena');
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  const section = route.split('/')[0];
  const nav = [
    ['arena', 'Arena', Box],
    ['human', 'Human solve', Hand],
    ['results/sprint', 'Sprint results', Activity],
    ['results/live', 'Live results', Activity],
    ['leaderboard/verified', 'Verified board', ShieldCheck],
    ['leaderboard/community', 'Community board', Globe],
    ['guide', 'MCP guide', Terminal],
    ['settings', 'Runner settings', Settings],
  ] as const;
  return (
    <div className={contrast ? 'app contrast' : 'app'}>
      <aside>
        <a className="brand" href="#arena">
          <span className="logo">
            <Box size={23} />
          </span>
          CubeBench
        </a>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {nav.map(([url, title, Icon]) => (
            <a key={url} className={route === url ? 'selected' : ''} href={'#' + url}>
              <Icon size={18} />
              {title}
              {route === url && <span className="nav-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="engine-dot" /> Local arena<p>Provider neutral. Open by design.</p>
          <button className="text-button" onClick={() => setContrast(!contrast)}>
            High contrast: {contrast ? 'on' : 'off'}
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>
              {section === 'human' ? 'Human solve' : section === 'arena' ? 'Arena' : section}
            </span>
          </div>
          <div className="header-tools">
            <button
              className="text-button"
              aria-label="Toggle high contrast"
              aria-pressed={contrast}
              onClick={() => setContrast(!contrast)}
            >
              Contrast
            </button>
            <a href="#guide" className="header-link">
              <span className="engine-dot" /> MCP ready <ArrowUpRight size={14} />
            </a>
          </div>
        </header>
        <div className="content">
          {section === 'arena' ? (
            <Arena />
          ) : section === 'human' ? (
            <Human />
          ) : section === 'create' ? (
            <Create />
          ) : section === 'match' ? (
            <Match id={route.split('/')[1] || ''} />
          ) : section === 'results' ? (
            <Results key={route} league={route.split('/')[1] || 'sprint'} />
          ) : section === 'leaderboard' ? (
            <Leaderboard key={route} classification={route.split('/')[1] || 'verified'} />
          ) : section === 'run' ? (
            <Replay id={route.split('/')[1] || ''} />
          ) : section === 'settings' ? (
            <SettingsPage />
          ) : (
            <Guide />
          )}
        </div>
        <footer>
          <span>
            CubeBench <span className="muted">/</span> A clearer measure of reasoning.
          </span>
          <span>ENGINE v1.0 · 2–7 LAYERS</span>
        </footer>
      </main>
    </div>
  );
}
function Arena() {
  const { data, error } = useData<{ matches: MatchView[] }>('/matches', { matches: [] });
  const cube = useMemo(() => generateScramble(3, 'cubebench-home', 9).state, []);
  return (
    <>
      <div className="eyebrow">
        <span /> THE REASONING ARENA
      </div>
      <div className="hero">
        <div className="hero-copy">
          <h1>
            Small cube.
            <br />
            <span>Big benchmark.</span>
          </h1>
          <p>
            A level playing field for human intuition and machine reasoning. Same scramble. Clear
            rules. Every move accounted for.
          </p>
          <div className="actions">
            <a href="#create" className="button primary">
              Create match <ArrowUpRight size={17} />
            </a>
            <a href="#human" className="button">
              Solve it yourself <ArrowRight size={17} />
            </a>
          </div>
          <div className="hero-proof">
            <ShieldCheck size={15} /> Reproducible scrambles <i /> Verifiable results
          </div>
        </div>
        <div className="hero-visual">
          <div className="orb" />
          <Cube initial={cube} />
          <span className="visual-tag">
            <span className="engine-dot" /> 3 × 3 · READY TO REASON
          </span>
          <span className="orbit-note">DRAG TO EXPLORE ↗</span>
        </div>
      </div>
      <div className="format-grid">
        <a href="#create" className="format-card">
          <span className="format-icon">
            <Command />
          </span>
          <div>
            <div className="eyebrow">01 / ONE SHOT</div>
            <h2>Sprint</h2>
            <p>
              One complete solution. One submission.
              <br />
              Think it through. Make it count.
            </p>
          </div>
          <ArrowUpRight className="card-arrow" />
          <div className="card-bottom">
            FULL SEQUENCE <span>WALL-CLOCK RANKED</span>
          </div>
        </a>
        <a href="#create" className="format-card">
          <span className="format-icon blue">
            <Activity />
          </span>
          <div>
            <div className="eyebrow">02 / STEP BY STEP</div>
            <h2>Live</h2>
            <p>
              Observe, turn, adapt. Solve interactively
              <br />
              with up to 12 moves per batch.
            </p>
          </div>
          <ArrowUpRight className="card-arrow" />
          <div className="card-bottom">
            INTERACTIVE BATCHES <span>WALL-CLOCK RANKED</span>
          </div>
        </a>
        <a href="#human" className="format-card practice-card">
          <span className="format-icon amber">
            <Hand />
          </span>
          <div>
            <div className="eyebrow">YOUR MOVE</div>
            <h2>Human workshop</h2>
            <p>
              Find your rhythm, learn a sequence,
              <br />
              or chase your personal best.
            </p>
          </div>
          <ArrowUpRight className="card-arrow" />
          <div className="card-bottom">
            2 × 2 → 7 × 7 <span>PRACTICE ONLY</span>
          </div>
        </a>
      </div>
      <div className="section-heading">
        <div>
          <h2>
            In the arena <span className="count">{data.matches.length}</span>
          </h2>
          <p>Follow the reasoning. Watch the moves.</p>
        </div>
        <a className="text-link" href="#create">
          New match <Plus size={16} />
        </a>
      </div>
      <section className="panel">
        {error && <p className="error">{error}</p>}
        {!data.matches.length ? (
          <Empty
            title="The arena is yours."
            text="Start a match, connect a runner, and put reasoning in motion."
          />
        ) : (
          data.matches.map((m) => (
            <a className="list-row" href={'#match/' + m.match_id} key={m.match_id}>
              <span className="small-icon">
                <Box />
              </span>
              <div>
                <strong>
                  {m.league === 'live' ? 'Live' : 'Sprint'} · {m.size} × {m.size}
                </strong>
                <p>
                  {m.entrant_count} entrants · {m.trial_count} trials
                </p>
              </div>
              <span className="pill">{m.status}</span>
              <ArrowUpRight size={18} />
            </a>
          ))
        )}
      </section>
      <div className="connect-banner">
        <Terminal />
        <div>
          <h3>Bring your own intelligence.</h3>
          <p>
            Connect any compatible MCP harness. The hosted community endpoint is open; you bring the
            model and prompt.
          </p>
        </div>
        <a href="#guide" className="button">
          Read the MCP guide <ArrowUpRight size={16} />
        </a>
      </div>
    </>
  );
}
type Solve = {
  id: string;
  size: number;
  seed: string | null;
  scramble: string;
  moves: string;
  elapsed_ms: number;
  created_at: string;
};
function Human() {
  const [size, setSize] = useState(3);
  const [source, setSource] = useState('random');
  const [seed, setSeed] = useState('');
  const [custom, setCustom] = useState('');
  const [moveInput, setMoveInput] = useState('');
  const [scramble, setScramble] = useState('');
  const [preview, setPreview] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const previewInitial = useMemo(() => createSolved(size), [size]);
  const previewMoves = useMemo(() => parseMoves(scramble, size), [scramble, size]);
  const [currentSeed, setCurrentSeed] = useState<string | null>(null);
  const [initial, setInitial] = useState(() => createSolved(3));
  const [sequence, setSequence] = useState<string[]>([]);
  const [redo, setRedo] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeed] = useState(220);
  const [labels, setLabels] = useState(false);
  const [message, setMessage] = useState('Ready. Choose a scramble to begin.');
  const [saved, setSaved] = useState(false);
  const { data, setData } = useData<{ solves: Solve[] }>('/human/solves', { solves: [] });
  const moves = useMemo(() => parseMoves(sequence.join(' '), size), [sequence, size]);
  const state = useMemo(() => applyMoves(initial, moves), [initial, moves]);
  const solved = sequence.length > 0 && isSolved(state);
  useEffect(() => {
    if (!started || paused || solved || preview) return;
    let prev = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      setElapsed((v) => v + now - prev);
      prev = now;
    }, 40);
    return () => clearInterval(timer);
  }, [started, paused, solved, preview]);
  const turn = (notation: string) => {
    if (paused) return;
    setPreview(false);
    setStarted(true);
    setSequence((s) => [...s, notation]);
    setRedo([]);
    setSaved(false);
    setMessage('Move accepted: ' + notation);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input,textarea,select,button') ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if ('rludfb'.includes(e.key.toLowerCase()) && e.key.length === 1) {
        e.preventDefault();
        turn(e.key.toUpperCase() + (e.shiftKey ? "'" : ''));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const begin = (n = size, override?: string) => {
    try {
      let next: string;
      let nextSeed: string | null = null;
      if (override !== undefined) next = override;
      else if (source === 'custom') next = custom;
      else {
        nextSeed = source === 'seed' ? seed : crypto.randomUUID();
        if (!nextSeed) throw Error('Enter a seed first.');
        next = generateScramble(n, nextSeed).scramble;
      }
      const state = applyMoves(createSolved(n), parseMoves(next, n));
      setPreview(false);
      setSize(n);
      setInitial(state);
      setScramble(next);
      setCurrentSeed(nextSeed);
      setSequence([]);
      setRedo([]);
      setElapsed(0);
      setStarted(false);
      setPaused(false);
      setSaved(false);
      setMessage(
        next ? 'Scramble ready. First move starts the timer.' : 'Ready. Cube reset to solved.',
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const save = async () => {
    try {
      const result = await api<{ solve: Solve }>('/human/solves', {
        size,
        seed: currentSeed,
        scramble,
        moves: sequence.join(' '),
        elapsed_ms: elapsed,
      });
      setData({ solves: [result.solve, ...data.solves] });
      setSaved(true);
      setMessage('Solved. Saved to your practice history.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <>
      <div className="eyebrow">
        HUMAN WORKSHOP <span className="pill">PRACTICE ONLY</span>
      </div>
      <div className="page-heading">
        <div>
          <h1>Your next personal best.</h1>
          <p>No competitors. No pressure. Just you and the cube.</p>
        </div>
      </div>
      <div className="workshop">
        <section className="panel stage">
          <div className="stage-top">
            <span className="pill">
              {size} × {size} / FREE PLAY
            </span>
            <label className="check">
              <input
                type="checkbox"
                checked={labels}
                onChange={(e) => setLabels(e.target.checked)}
              />{' '}
              Color labels
            </label>
          </div>
          <div hidden={preview}>
            <Cube initial={initial} moves={moves} speed={speed} labels={labels} onTurn={turn} />
          </div>
          {preview && (
            <Cube
              key={previewVersion}
              initial={previewInitial}
              moves={previewMoves}
              speed={speed}
              labels={labels}
            />
          )}
          {preview && (
            <div className="playback">
              <p>Scramble preview · personal timer paused</p>
              <button className="button" onClick={() => setPreview(false)}>
                Return to solve
              </button>
            </div>
          )}
          <div className="stage-hint">Drag to orbit · Scroll to zoom · Tap a face to turn</div>
          <div className="timer">
            <div data-testid="human-time" aria-label="Personal solve timer">
              {time(elapsed)}
            </div>
            <span>
              {preview
                ? 'PREVIEW · PERSONAL TIMER PAUSED'
                : solved
                  ? 'SOLVED'
                  : paused
                    ? 'PAUSED'
                    : started
                      ? 'SOLVING'
                      : 'READY WHEN YOU ARE'}
            </span>
          </div>
          <div className="stage-stats">
            <div>
              <strong data-testid="move-count">{sequence.length}</strong>
              <span>MOVES</span>
            </div>
            <div>
              <strong>
                {data.solves.filter((s) => s.size === size).length
                  ? time(
                      Math.min(
                        ...data.solves.filter((s) => s.size === size).map((s) => s.elapsed_ms),
                      ),
                    )
                  : '—'}
              </strong>
              <span>PERSONAL BEST</span>
            </div>
            <button className="button" onClick={() => setPaused(!paused)}>
              {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </section>
        <section className="panel controls">
          <h2>Make your move</h2>
          <p className="muted">Keyboard R L U D F B · Shift for inverse</p>
          <div className="move-grid">
            {['U', 'R', 'F', 'D', 'L', 'B'].map((face) => (
              <React.Fragment key={face}>
                <button aria-label={'Turn ' + face} disabled={paused} onClick={() => turn(face)}>
                  {face}
                </button>
                <button
                  aria-label={'Turn ' + face + "'"}
                  disabled={paused}
                  onClick={() => turn(face + "'")}
                >
                  {face}′
                </button>
              </React.Fragment>
            ))}
          </div>
          <div className="actions">
            <button
              className="button"
              disabled={!sequence.length}
              onClick={() => {
                setRedo((r) => [sequence.at(-1)!, ...r]);
                setSequence((s) => s.slice(0, -1));
                setSaved(false);
              }}
            >
              Undo
            </button>
            <button
              className="button"
              disabled={!redo.length}
              onClick={() => {
                setSequence((s) => [...s, redo[0]!]);
                setRedo((r) => r.slice(1));
              }}
            >
              Redo
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const parsed = parseMoves(moveInput, size);
                for (const move of parsed) turn(move.notation);
                setMoveInput('');
              } catch (error) {
                setMessage((error as Error).message);
              }
            }}
          >
            <label>
              Move sequence
              <input
                aria-label="Move sequence"
                value={moveInput}
                onChange={(e) => setMoveInput(e.target.value)}
                placeholder="R U R' · Rw · 2R"
              />
            </label>
            <button className="button" disabled={paused || !moveInput.trim()}>
              Apply sequence
            </button>
          </form>
          <label>
            Turn animation
            <input
              aria-label="Animation speed"
              type="range"
              min="60"
              max="600"
              value={speed}
              onChange={(e) => setSpeed(+e.target.value)}
            />
          </label>
          <hr />
          <div className="two-col">
            <Size value={size} onChange={(n) => begin(n, '')} />
            <label>
              Scramble source
              <select
                aria-label="Scramble source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="random">Random</option>
                <option value="seed">Seeded</option>
                <option value="custom">Custom sequence</option>
              </select>
            </label>
          </div>
          {source === 'seed' && (
            <label>
              Seed
              <input
                aria-label="Seed"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="e.g. morning-practice"
              />
            </label>
          )}
          {source === 'custom' && (
            <label>
              Custom sequence
              <input
                aria-label="Custom sequence"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="R U R' U'"
              />
            </label>
          )}
          <div className="actions">
            <button className="button primary" onClick={() => begin()}>
              New scramble
            </button>
            <button className="button" onClick={() => begin(size, '')}>
              Reset to solved
            </button>
          </div>
          <p className="small muted">
            New scramble and reset end this attempt and reset the timer.
          </p>
          <div className="scramble">
            <span>SCRAMBLE</span>
            <code data-testid="scramble">{scramble || 'Solved state'}</code>
          </div>
          <div className="actions">
            <button
              className="button"
              disabled={!scramble}
              onClick={() => {
                setPreviewVersion((v) => v + 1);
                setPreview(true);
              }}
            >
              Play scramble
            </button>
            <button
              className="text-button"
              onClick={() => {
                localStorage.setItem('cubebench-scramble', JSON.stringify({ size, scramble }));
                setMessage('Scramble saved locally.');
              }}
            >
              Save scramble
            </button>
            <button
              className="text-button"
              onClick={() => {
                try {
                  const s = JSON.parse(localStorage.getItem('cubebench-scramble') || 'null');
                  if (s) begin(s.size, s.scramble);
                  else setMessage('No saved scramble yet.');
                } catch {
                  setMessage('Saved scramble could not be read.');
                }
              }}
            >
              Replay saved
            </button>
          </div>
          <p role="status" aria-live="polite" className={solved ? 'success' : 'status'}>
            {solved
              ? 'Solved! ' + (saved ? 'Saved to practice history.' : 'Save your completed attempt.')
              : message}
          </p>
          {solved && (
            <button className="button primary" disabled={saved} onClick={() => void save()}>
              {saved ? 'Saved' : 'Save completed solve'}
            </button>
          )}
        </section>
      </div>
      <div className="section-heading">
        <div>
          <h2>Your practice history</h2>
          <p>Personal progress, kept separate from benchmark rankings.</p>
        </div>
      </div>
      <section className="panel">
        {!data.solves.length ? (
          <Empty
            title="A fresh start."
            text="Your saved, server-validated solves and personal bests will appear here."
          />
        ) : (
          data.solves.map((s) => (
            <div className="list-row" key={s.id}>
              <Box />
              <div>
                <strong>
                  {s.size} × {s.size} · {time(s.elapsed_ms)}
                </strong>
                <p>
                  {s.moves.split(' ').length} moves · {new Date(s.created_at).toLocaleDateString()}
                </p>
              </div>
              <button className="button" onClick={() => begin(s.size, s.scramble)}>
                Replay scramble
              </button>
            </div>
          ))
        )}
      </section>
    </>
  );
}
function Create() {
  const [size, setSize] = useState(3);
  const [league, setLeague] = useState('sprint');
  const [entrants, setEntrants] = useState(1);
  const [trials, setTrials] = useState(1);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ match_id: string; participants: unknown[] } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setCreated(
        await api('/matches', {
          league,
          size,
          entrant_count: entrants,
          trial_count: trials,
          ranked: false,
          warmup: false,
          visibility: 'public',
          limits: { time_ms: 300000, moves: 1000, tool_calls: 200 },
        }),
      );
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="eyebrow">NEW MATCH</div>
      <h1>Set the challenge.</h1>
      <p>Fresh scrambles. Equal conditions. Independent reasoning.</p>
      <div className="workshop">
        <form className="panel controls" onSubmit={submit}>
          <h2>Match configuration</h2>
          <label>
            League
            <select aria-label="League" value={league} onChange={(e) => setLeague(e.target.value)}>
              <option value="sprint">Sprint · One complete submission</option>
              <option value="live">Live · Interactive batches</option>
            </select>
          </label>
          <Size value={size} onChange={setSize} />
          <div className="two-col">
            <label>
              Entrants
              <input
                type="number"
                min="1"
                max="8"
                value={entrants}
                onChange={(e) => setEntrants(+e.target.value)}
                required
              />
            </label>
            <label>
              Trials
              <input
                type="number"
                min="1"
                max="20"
                value={trials}
                onChange={(e) => setTrials(+e.target.value)}
                required
              />
            </label>
          </div>
          <div className="notice">
            <ShieldCheck />
            <p>
              Browser matches enter the community class. Verified rankings require a trusted runner
              identity.
            </p>
          </div>
          <p className="muted">Each attempt: 5 minutes · 1,000 moves · 200 tool calls</p>
          <button className="button primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create match'} <ArrowRight size={16} />
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </form>
        <section className="panel controls">
          <h2>{created ? 'Your match is ready.' : 'Fair from the first turn.'}</h2>
          {created ? (
            <>
              <a className="button primary" href={'#match/' + created.match_id}>
                Open match <ArrowRight size={16} />
              </a>
              <p>
                Copy these participant credentials into the clients you want to compare. They are
                shown only here and are never stored in the browser. Each token starts one entrant
                round.
              </p>
              <pre aria-label="Participant credentials">{JSON.stringify(created, null, 2)}</pre>
            </>
          ) : (
            <>
              <p>
                All entrants in a round receive exactly the same scramble. Seeds stay hidden until
                the match completes.
              </p>
              <ol className="steps">
                <li>Create your match</li>
                <li>Give each client its participant token</li>
                <li>Open the spectator preview and start runs through MCP</li>
                <li>Review signed results</li>
              </ol>
              <a href="#guide" className="text-link">
                Connect a runner <ArrowUpRight size={16} />
              </a>
            </>
          )}
        </section>
      </div>
    </>
  );
}
function useEvents(id: string) {
  const [events, setEvents] = useState<CubeEvent[]>([]);
  const [connection, setConnection] = useState('Connecting');
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cursor = 0;
    const merge = (incoming: CubeEvent[]) =>
      setEvents((old) =>
        [...new Map([...old, ...incoming].map((e) => [e.id, e])).values()].sort(
          (a, b) => a.id - b.id,
        ),
      );
    api<{ events: CubeEvent[]; cursor: number }>('/matches/' + id + '/events?after=0')
      .then((history) => {
        if (stopped) return;
        merge(history.events);
        cursor = history.cursor;
        const connect = () => {
          if (stopped) return;
          socket = new WebSocket(
            `${location.origin.replace(/^http/, 'ws')}/api/matches/${id}/ws?after=${cursor}`,
          );
          socket.onopen = () => setConnection('Connected');
          socket.onmessage = (event) => {
            try {
              const incoming = JSON.parse(event.data) as CubeEvent;
              cursor = Math.max(cursor, incoming.id);
              merge([incoming]);
            } catch {
              setConnection('Invalid event');
            }
          };
          socket.onerror = () => setConnection('Reconnecting');
          socket.onclose = () => {
            if (!stopped) {
              setConnection('Reconnecting');
              retry = setTimeout(connect, 1000);
            }
          };
        };
        connect();
      })
      .catch(() => setConnection('Connection unavailable'));
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [id]);
  return { events, connection };
}
function Match({ id }: { id: string }) {
  const { data, error, setData } = useData<{ match: MatchView | null }>('/matches/' + id, {
    match: null,
  });
  const { events, connection } = useEvents(id);
  const [visualPause, setVisualPause] = useState(false);
  const [seek, setSeek] = useState<number | null>(null);
  const [selectedRun, setSelectedRun] = useState('');
  useEffect(() => {
    if (!events.length) return;
    const pending = setTimeout(() => {
      void api<{ match: MatchView }>('/matches/' + id)
        .then(setData)
        .catch(() => {});
    }, 500);
    return () => clearTimeout(pending);
  }, [events.length, id, setData]);
  const match = data.match;
  const [snapshotAt, setSnapshotAt] = useState(() => performance.now());
  const [displayNow, setDisplayNow] = useState(() => performance.now());
  useEffect(() => {
    const now = performance.now();
    setSnapshotAt(now);
    setDisplayNow(now);
  }, [match]);
  const hasActiveRuns = match?.runs.some((run) => run.status === 'active');
  useEffect(() => {
    if (!hasActiveRuns) return;
    const timer = setInterval(() => setDisplayNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [hasActiveRuns]);
  const visible = events.slice(0, seek ?? events.length);
  const runId = selectedRun || match?.runs[0]?.run_id || events.find((e) => e.run_id)?.run_id;
  const runEvents = visible.filter((e) => e.run_id === runId);
  const selected = match?.runs.find((run) => run.run_id === runId);
  const completed = match?.status === 'completed';
  const liveState =
    runEvents.find((e) => e.type === 'run_started' && e.state)?.state ||
    runEvents.find((e) => e.state)?.state;
  const state = completed ? selected?.state : liveState;
  const moves = completed
    ? ''
    : runEvents
        .filter((e) => e.type === 'move_accepted' && e.move)
        .map((e) => e.move!)
        .join(' ');
  return (
    <>
      <div className="eyebrow">
        MATCH SPECTATOR <span className="pill">{connection}</span>
      </div>
      <h1>{match?.league === 'live' ? 'Live' : 'Sprint'} in the arena.</h1>
      <p>
        {completed
          ? 'Match complete. Showing the final committed cube state; open a run to replay its moves.'
          : 'Official clocks keep running while visual playback is paused.'}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="workshop">
        <section className="panel stage">
          {state ? (
            <Cube
              initial={state as CubeState}
              moves={parseMoves(moves, state.size)}
              paused={visualPause}
            />
          ) : (
            <Empty
              title="Waiting for the first reveal."
              text="Cube states stay hidden until every entrant has started the round."
            />
          )}
          <div className="playback">
            {!completed && (
              <>
                <button className="button" onClick={() => setVisualPause(!visualPause)}>
                  {visualPause ? 'Resume playback' : 'Pause playback'}
                </button>
                <label>
                  Event playback
                  <input
                    aria-label="Event playback"
                    type="range"
                    min="0"
                    max={events.length}
                    value={seek ?? events.length}
                    onChange={(e) => setSeek(+e.target.value)}
                  />
                </label>
                <button className="text-button" onClick={() => setSeek(null)}>
                  Jump to live
                </button>
              </>
            )}
          </div>
        </section>
        <section className="panel controls">
          <h2>Run activity</h2>
          <p>Live elapsed is a display estimate. Final times are server-verified.</p>
          <label>
            Spectator entrant
            <select
              aria-label="Spectator entrant"
              value={runId || ''}
              onChange={(e) => {
                setSelectedRun(e.target.value);
                setSeek(null);
              }}
            >
              {match?.runs.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {r.metadata.display_name}
                </option>
              ))}
            </select>
          </label>
          <p>
            {match?.size} × {match?.size} · {match?.entrant_count ?? 0} entrants ·{' '}
            {match?.status ?? 'Loading'}
          </p>
          {match?.runs.map((r) => (
            <a href={'#run/' + r.run_id} className="list-row" key={r.run_id}>
              <div>
                <strong>{r.metadata.display_name}</strong>
                <p>
                  {r.move_count} moves · {r.tool_call_count} calls ·{' '}
                  <span data-testid={'spectator-time-' + r.run_id} aria-live="off">
                    {time(
                      r.elapsed_ms +
                        (r.status === 'active' ? Math.max(0, displayNow - snapshotAt) : 0),
                    )}
                  </span>{' '}
                  · {r.failure || r.status}
                </p>
                <p>
                  {r.status === 'active'
                    ? 'In progress'
                    : r.solved
                      ? '#' +
                        (1 +
                          (match?.runs.filter(
                            (other) =>
                              other.round_id === r.round_id &&
                              other.solved &&
                              other.elapsed_ms < r.elapsed_ms,
                          ).length || 0)) +
                        ' in round'
                      : 'DNF'}
                </p>
              </div>
              <ArrowUpRight size={16} />
            </a>
          ))}
          <div className="event-list">
            {visible
              .slice(-20)
              .reverse()
              .map((e) => (
                <div key={e.id}>
                  <span>{time(e.elapsed_ms)}</span>
                  <code>
                    {e.type.replaceAll('_', ' ')} {e.move}
                  </code>
                </div>
              ))}
          </div>
          {match?.status === 'completed' && (
            <div className="actions">
              <a className="button" href={'/api/matches/' + id + '/export?format=json'}>
                Export signed JSON
              </a>
              <a className="button" href={'/api/matches/' + id + '/export?format=csv'}>
                CSV
              </a>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function Results({ league }: { league: string }) {
  const [size, setSize] = useState<number | 'all'>('all');
  const [classification, setClassification] = useState<'verified' | 'community' | 'all'>('all');
  const query = new URLSearchParams({ league });
  if (size !== 'all') query.set('size', String(size));
  if (classification !== 'all') query.set('result_class', classification);
  const { data, error, loading } = useData<{ results: ResultRecord[] }>(
    `/results?${query.toString()}`,
    { results: [] },
  );
  return (
    <>
      <div className="eyebrow">RESULT EXPLORER / {league.toUpperCase()}</div>
      <h1>Every attempt tells a story.</h1>
      <p>Verified wall-clock duration includes reasoning and tool round trips.</p>
      <div className="filters">
        <label>
          Cube size
          <select
            aria-label="Cube size"
            value={size}
            onChange={(e) => setSize(e.target.value === 'all' ? 'all' : +e.target.value)}
          >
            <option value="all">All sizes</option>
            {sizes.map((n) => (
              <option key={n} value={n}>
                {n} × {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Result class
          <select
            aria-label="Result class"
            value={classification}
            onChange={(e) => setClassification(e.target.value as 'verified' | 'community' | 'all')}
          >
            <option value="verified">Verified</option>
            <option value="community">Community</option>
            <option value="all">All results</option>
          </select>
        </label>
      </div>
      <section className="panel">
        {error && <p className="error">{error}</p>}
        {loading ? (
          <Empty title="Loading results…" text="Reading completed signed attempts." />
        ) : data.results.length ? (
          data.results.map((r) => (
            <a className="list-row" key={r.result_id} href={'#run/' + r.run_id}>
              <div>
                <strong>{r.metadata.display_name}</strong>
                <p>
                  {r.size} × {r.size} · {r.failure} · {r.move_count} moves · {r.tool_call_count}{' '}
                  calls
                </p>
              </div>
              <strong>{time(r.elapsed_ms)}</strong>
              <span className="pill">{r.verification}</span>
              <ArrowUpRight size={17} />
            </a>
          ))
        ) : (
          <Empty />
        )}
      </section>
    </>
  );
}
type BoardRow = {
  competitor: string;
  identity_key: string;
  attempts: number;
  completed: number;
  completion_rate: number;
  median_ms: number | null;
  best_run_id: string | null;
};
function Leaderboard({ classification }: { classification: string }) {
  const [size, setSize] = useState(3);
  const [league, setLeague] = useState(classification === 'community' ? 'live' : 'sprint');
  const { data, error, loading } = useData<{ rows: BoardRow[] }>(
    `/leaderboard?league=${league}&result_class=${classification}&size=${size}`,
    { rows: [] },
  );
  return (
    <>
      <div className="eyebrow">{classification.toUpperCase()} LEADERBOARD</div>
      <h1>Reasoning, on the record.</h1>
      <p>
        {classification === 'verified'
          ? 'Trusted runner identities. Signed, independently inspectable results.'
          : 'Self-reported competitor identities. Community results remain in their own class.'}
      </p>
      <div className="filters">
        <label>
          League
          <select aria-label="League" value={league} onChange={(e) => setLeague(e.target.value)}>
            <option value="sprint">Sprint</option>
            <option value="live">Live</option>
          </select>
        </label>
        <Size value={size} onChange={setSize} />
      </div>
      <section className="panel">
        {error && <p className="error">{error}</p>}
        {loading ? (
          <Empty title="Loading leaderboard…" text="Aggregating comparable completed runs." />
        ) : !data.rows.length ? (
          <Empty
            title="An open field."
            text={`No ${classification} ${league} runs for this cube size yet.`}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank / competitor</th>
                  <th>Completion</th>
                  <th>Attempts</th>
                  <th>Median time</th>
                  <th>Replay</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.identity_key}>
                    <td>
                      {i + 1} · {r.competitor}
                    </td>
                    <td>{(r.completion_rate * 100).toFixed(0)}%</td>
                    <td>{r.attempts}</td>
                    <td>{r.median_ms === null ? '—' : time(r.median_ms)}</td>
                    <td>{r.best_run_id && <a href={'#run/' + r.best_run_id}>Best run ↗</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
function Replay({ id }: { id: string }) {
  const { data, error } = useData<{ run: RunView | null; events: CubeEvent[] }>('/runs/' + id, {
    run: null,
    events: [],
  });
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(true);
  const run = data.run;
  const accepted = data.events
    .filter((e) => e.type === 'move_accepted' && e.move)
    .map((e) => e.move!);
  useEffect(() => {
    if (paused || index >= accepted.length) return;
    const t = setTimeout(() => setIndex((i) => i + 1), 400);
    return () => clearTimeout(t);
  }, [paused, index, accepted.length]);
  const initial = useMemo(() => {
    if (!run) return createSolved(3);
    if (run.scramble) return applyMoves(createSolved(run.size), run.scramble);
    return data.events.find((event) => event.type === 'run_started')?.state ?? run.state;
  }, [run, data.events]);
  return (
    <>
      <div className="eyebrow">RUN REPLAY</div>
      <h1>A closer look at every turn.</h1>
      {error && <p className="error">{error}</p>}
      <div className="workshop">
        <section className="panel stage">
          <Cube
            initial={initial}
            moves={parseMoves(accepted.slice(0, index).join(' '), initial.size)}
          />
          <div className="playback">
            <button className="button" onClick={() => setPaused(!paused)}>
              {paused ? 'Play replay' : 'Pause replay'}
            </button>
            <label>
              Move timeline
              <input
                aria-label="Move timeline"
                type="range"
                min="0"
                max={accepted.length}
                value={index}
                onChange={(e) => {
                  setIndex(+e.target.value);
                  setPaused(true);
                }}
              />
            </label>
            <span>
              {index} / {accepted.length}
            </span>
          </div>
        </section>
        <section className="panel controls">
          <h2>{run?.metadata.display_name || 'Loading run…'}</h2>
          <p>
            {run?.league} · {run?.verification} · {run?.failure || run?.status}
          </p>
          <div className="timer">
            {time(run?.elapsed_ms || 0)}
            <span>OFFICIAL WALL CLOCK</span>
          </div>
          <p>
            {run?.move_count ?? 0} moves · {run?.tool_call_count ?? 0} calls
          </p>
          <div className="scramble">
            <span>ORIGINAL SCRAMBLE</span>
            <code>{run?.scramble ?? 'Hidden until the round is complete'}</code>
          </div>
          <h3>Accepted sequence</h3>
          <code className="sequence">{accepted.join(' ') || 'No accepted moves'}</code>
          <a href={'#match/' + run?.match_id} className="button">
            View match
          </a>
        </section>
      </div>
    </>
  );
}
function Guide() {
  return (
    <>
      <div className="eyebrow">MCP GUIDE</div>
      <h1>Bring your own intelligence.</h1>
      <p>
        Your harness handles inference. CubeBench supplies the challenge and measures the result.
      </p>
      <div className="workshop">
        <section className="panel controls">
          <h2>01 / Connect your harness</h2>
          <p>
            Point a Streamable HTTP MCP client at this server. Hosted community access is public, so
            no bearer token is required to connect.
          </p>
          <pre>
            {JSON.stringify(
              {
                url: location.origin + '/mcp',
              },
              null,
              2,
            )}
          </pre>
          <p>
            For local stdio clients, use the gateway with CUBEBENCH_URL and CUBEBENCH_TOKEN in the
            harness environment. Local authoritative mode still uses access credentials.
          </p>
          <pre>npm run mcp:stdio</pre>
          <p>Provider credentials stay in your harness. CubeBench never calls a model API.</p>
        </section>
        <section className="panel controls">
          <h2>02 / Run the protocol</h2>
          <ol className="steps">
            <li>
              <code>cubebench_get_rules</code>
              <p>Read the format, notation, and limits.</p>
            </li>
            <li>
              <code>cubebench_create_match</code>
              <p>
                Save the match and participant credentials. Open the returned{' '}
                <code>spectator_url</code> in a browser before starting. Share that preview URL with
                observers or keep it open while multiple clients run the same round.
              </p>
            </li>
            <li>
              <code>cubebench_start_run</code>
              <p>
                Redeem a participant token. The official timer starts and the scrambled facelet
                state is returned; the generating sequence stays hidden until the round ends.
              </p>
            </li>
            <li>
              <code>cubebench_submit_solution</code>
              <p>Sprint: one submission ends the attempt.</p>
              <code>cubebench_apply_moves</code>
              <p>Live: send legal moves up to the remaining move budget. Playback queues them.</p>
            </li>
            <li>
              <code>cubebench_get_results</code>
              <p>Inspect signed completed results.</p>
            </li>
          </ol>
        </section>
      </div>
      <section className="panel controls">
        <h2>Previewing multiple clients</h2>
        <p>
          Create one entrant per client. Every participant token is single-use and bound to its
          entrant and round, while all entrants receive the same scramble. Start each client with
          its own token, then watch the shared <code>spectator_url</code>: the board shows committed
          moves, run status, timing, and standings as they arrive.
        </p>
        <p>
          The preview is for observation only. Pausing or seeking the animation never changes the
          official timer or benchmark state, and the scramble remains hidden until the round’s
          visibility rules allow it.
        </p>
      </section>
      <section className="panel controls">
        <h2>Equal conditions, explicit limits.</h2>
        <p>
          Every authorized run operation consumes a tool call. Time includes reasoning, reads, and
          round trips. Invalid moves terminate the attempt. There is no solver tool, reset, retry,
          or pause for official runs.
        </p>
        <p>
          Notation: U R F D L B; prime for inverse; 2 for half turns. Larger cubes support wide and
          inner layer notation according to the versioned rules. Seeded scrambles are reproducible
          legal move sequences, not uniformly random cube states.
        </p>
      </section>
    </>
  );
}
function SettingsPage() {
  const { data, error } = useData<{
    mcp_url?: string;
    oauth_enabled?: boolean;
    public_key?: string;
    versions?: Record<string, string>;
  }>('/config', {});
  return (
    <>
      <div className="eyebrow">RUNNER SETTINGS</div>
      <h1>Your harness. Your control.</h1>
      <p>Inspect the public community endpoint and verify results outside the browser.</p>
      <div className="workshop">
        <section className="panel controls">
          <h2>Connection</h2>
          {error && <p className="error">{error}</p>}
          <label>
            MCP endpoint
            <input readOnly value={data.mcp_url || location.origin + '/mcp'} />
          </label>
          <p>Hosted community MCP: public · OAuth: {data.oauth_enabled ? 'enabled' : 'disabled'}</p>
          <h3>Provision a local runner</h3>
          <pre>npm run auth:issue -- --name my-runner --role runner</pre>
          <p>
            Run this on the server. Store the token in your MCP client environment. Browser sessions
            cannot issue runner or administrator credentials.
          </p>
        </section>
        <section className="panel controls">
          <h2>Result verification</h2>
          <p>Immutable result records use Ed25519 signatures and a tamper-evident event chain.</p>
          <label>
            Server public key
            <textarea readOnly rows={6} value={data.public_key || 'Loading public key…'} />
          </label>
          <h3>Versions</h3>
          {Object.entries(data.versions || {}).map(([k, v]) => (
            <div className="version" key={k}>
              <span>{k}</span>
              <code>{v}</code>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
