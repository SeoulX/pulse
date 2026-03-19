"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import type { DashboardStats } from "@/types";
import { useFilteredKey } from "@/lib/hooks/use-filtered-key";

/* ─── messages ─── */
const happyMsg = [
  "What a beautiful day!", "All systems go!", "No fires today!",
  "Time for coffee?", "Smooth sailing~", "Everything is awesome!",
  "*happy dino noises*", "Rawr means hi!", "Servers are vibing!",
  "Hi there!", "All green!", "So peaceful~",
];
const panicMsg = [
  "SOMETHING IS ON FIRE!", "Servers down!", "This is fine...",
  "RED ALERT!", "WHO BROKE IT?!", "PANIC!",
  "Not again...", "Fix it!", "HELP!",
];
const sadMsg = [
  "Everything is broken...", "I give up...", "Send help...",
  "*sob*", "I need a hug...", "Why...",
];

type Mood = "happy" | "panic" | "sad";

/* ─── color palettes ─── */
const palettes = {
  happy: {
    outline: "#1a3a1a",   // dark green-black outline
    dark: "#2d7a2d",      // dark green (spikes, spots)
    mid: "#4caf50",       // medium green (body)
    light: "#6abf69",     // light green (body highlight)
    belly: "#e8deb3",     // tan belly
    bellyLight: "#f0e8c8",// light tan
    eye: "#1a1a2e",       // eye dark
    eyeWhite: "#ffffff",
    eyeShine: "#ffffff",
    cheek: "#f48fb1",
    mouth: "#2d5a2d",
  },
  panic: {
    outline: "#3a2a1a",
    dark: "#c47a00",
    mid: "#ffa726",
    light: "#ffcc02",
    belly: "#fff3cd",
    bellyLight: "#fffde7",
    eye: "#1a1a2e",
    eyeWhite: "#ffffff",
    eyeShine: "#ffffff",
    cheek: "#ef5350",
    mouth: "#5a3a1a",
  },
  sad: {
    outline: "#2a2a3a",
    dark: "#546e7a",
    mid: "#78909c",
    light: "#90a4ae",
    belly: "#cfd8dc",
    bellyLight: "#eceff1",
    eye: "#1a1a2e",
    eyeWhite: "#ffffff",
    eyeShine: "#ffffff",
    cheek: "#ef9a9a",
    mouth: "#455a64",
  },
};

/* ─── pixel art renderer ─── */
// Each frame is an array of strings. Each char = 1 pixel.
// Legend: O=outline, D=dark, M=mid, L=light, B=belly, b=bellyLight,
//         W=eyeWhite, E=eye, S=eyeShine, P=cheek, X=mouth, .=transparent, s=spike/spots

const PX = 2; // scale factor
const W = 20; // sprite width in pixels
const H = 24; // sprite height in pixels

// Idle frame
const IDLE = [
  ".....OOOO.......",
  "....OMMMMO......",
  "...OMLMMLDMO....",
  "..OMLLLMLLLMO...",
  "..OMDDLLLDDMO..",
  ".OMLLLLLLLLLLMO.",
  ".OMWWEMWWEMLLMO.",
  ".OMWSEMWSEMLMO..",
  ".OMLPMLMPMLMO...",
  ".OMLLLXXXLLMO...",
  "..OMLLLLLLMO....",
  "..OOBBBBBBOOMO..",
  "..OBbbbbbbBOMO..",
  "..OBbbbbbbBOO...",
  "..OOBBBBBBO.....",
  "...OMMMMMMO.....",
  "...OMMDMMDMO....",
  "...OMMMMMMMO....",
  "..OOMMMOOMMMOO..",
  "..OMMMO..OMMMO..",
  "..OMMMO..OMMMO..",
  ".OOMMOO..OOMMOO.",
  ".OOOOOO..OOOOOO.",
  "....................",
];

// Walk frame 1 — left foot forward
const WALK1 = [
  ".....OOOO.......",
  "....OMMMMO......",
  "...OMLMMLDMO....",
  "..OMLLLMLLLMO...",
  "..OMDDLLLDDMO..",
  ".OMLLLLLLLLLLMO.",
  ".OMWWEMWWEMLLMO.",
  ".OMWSEMWSEMLMO..",
  ".OMLPMLMPMLMO...",
  ".OMLLLXXXLLMO...",
  "..OMLLLLLLMO....",
  "..OOBBBBBBOOMO..",
  "..OBbbbbbbBOMO..",
  "..OBbbbbbbBOO...",
  "..OOBBBBBBO.....",
  "...OMMMMMMO.....",
  "...OMMDMMDMO....",
  "...OMMMMMMMO....",
  ".OOMMMMO.OMMOO..",
  "OMMMO....OMMMO..",
  "OMMMO....OMMMO..",
  "OOMMOO...OOMMOO.",
  "OOOOOO...OOOOOO.",
  "....................",
];

// Walk frame 2 — passing (legs together)
const WALK2 = [
  "......OOOO......",
  ".....OMMMMO.....",
  "....OMLMMLDMO...",
  "...OMLLLMLLLMO..",
  "...OMDDLLLDDMO.",
  "..OMLLLLLLLLLLMO",
  "..OMWWEMWWEMLLMO",
  "..OMWSEMWSEMLMO.",
  "..OMLPMLMPMLMO..",
  "..OMLLLXXXLLMO..",
  "...OMLLLLLLMO...",
  "...OOBBBBBBOOMO.",
  "...OBbbbbbbBOMO.",
  "...OBbbbbbbBOO..",
  "...OOBBBBBBO....",
  "....OMMMMMMO....",
  "....OMMDMMDMO...",
  "....OMMMMMMMO...",
  "...OOMMOOOMMOO..",
  "...OMMMOOMMMO...",
  "...OMMMOOMMMO...",
  "..OOMMOOOMMOO...",
  "..OOOOOOOOOOOO..",
  "....................",
];

// Walk frame 3 — right foot forward
const WALK3 = [
  ".....OOOO.......",
  "....OMMMMO......",
  "...OMLMMLDMO....",
  "..OMLLLMLLLMO...",
  "..OMDDLLLDDMO..",
  ".OMLLLLLLLLLLMO.",
  ".OMWWEMWWEMLLMO.",
  ".OMWSEMWSEMLMO..",
  ".OMLPMLMPMLMO...",
  ".OMLLLXXXLLMO...",
  "..OMLLLLLLMO....",
  "..OOBBBBBBOOMO..",
  "..OBbbbbbbBOMO..",
  "..OBbbbbbbBOO...",
  "..OOBBBBBBO.....",
  "...OMMMMMMO.....",
  "...OMMDMMDMO....",
  "...OMMMMMMMO....",
  "..OOMMO.OOMMOO..",
  "..OMMMO..OMMMO..",
  "..OMMMO...OMMMO.",
  ".OOMMOO...OOMMOO",
  ".OOOOOO...OOOOOO",
  "....................",
];

// Sleep frame — eyes closed, curled up
const SLEEP = [
  ".....OOOO.......",
  "....OMMMMO......",
  "...OMLMMLDMO....",
  "..OMLLLMLLLMO...",
  "..OMDDLLLDDMO..",
  ".OMLLLLLLLLLLMO.",
  ".OMOOMOOMOLLMO..",
  ".OMLLLLLLLLMO...",
  ".OMLPMLMPMLMO...",
  ".OMLLLLLLLMO....",
  "..OMLLLLLLMO....",
  "..OOBBBBBBOOMO..",
  "..OBbbbbbbBOMO..",
  "..OBbbbbbbBOO...",
  "..OOBBBBBBO.....",
  "...OMMMMMO......",
  "...OMMMMMO......",
  "..OOMMOOOMMOO...",
  "..OOOOOOOOOOOO..",
  "....................",
  "....................",
  "....................",
  "....................",
  "....................",
];

const charToColor: Record<string, (p: typeof palettes.happy) => string> = {
  ".": () => "transparent",
  "O": (p) => p.outline,
  "D": (p) => p.dark,
  "M": (p) => p.mid,
  "L": (p) => p.light,
  "B": (p) => p.belly,
  "b": (p) => p.bellyLight,
  "W": (p) => p.eyeWhite,
  "E": (p) => p.eye,
  "S": (p) => p.eyeShine,
  "P": (p) => p.cheek,
  "X": (p) => p.mouth,
  "s": (p) => p.dark,
  "d": (p) => p.dark,
};

function buildShadow(frameData: string[], pal: typeof palettes.happy): string {
  const shadows: string[] = [];
  for (let y = 0; y < frameData.length; y++) {
    const row = frameData[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const fn = charToColor[ch];
      if (!fn) continue;
      const color = fn(pal);
      if (color === "transparent") continue;
      shadows.push(`${x * PX}px ${y * PX}px 0 0 ${color}`);
    }
  }
  return shadows.join(",");
}

// Pre-flatten frames (each row is a string)
const walkFrames = [IDLE, WALK1, WALK2, WALK3];

function DinoSprite({ mood, animFrame, isSleeping }: { mood: Mood; animFrame: number; isSleeping: boolean }) {
  const pal = palettes[mood];
  const frameData = isSleeping ? SLEEP : walkFrames[animFrame % 4];
  const shadow = buildShadow(frameData, pal);

  return (
    <div style={{ width: W * PX, height: H * PX, position: "relative", imageRendering: "pixelated" }}>
      <div style={{ width: PX, height: PX, boxShadow: shadow, position: "absolute", top: 0, left: 0 }} />
      {/* Tears */}
      {mood === "sad" && !isSleeping && (
        <>
          <div className="animate-dino-tear-left" style={{ position: "absolute", left: 5 * PX, top: 10 * PX, width: PX, height: PX * 2, background: "#42a5f5" }} />
          <div className="animate-dino-tear-right" style={{ position: "absolute", left: 12 * PX, top: 10 * PX, width: PX, height: PX * 2, background: "#42a5f5" }} />
        </>
      )}
      {/* Zzz */}
      {isSleeping && (
        <div className="animate-dino-zzz" style={{ position: "absolute", right: -2 * PX, top: -1 * PX }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 900, color: "#78909c", imageRendering: "auto" }}>z</span>
          <span style={{ fontFamily: "monospace", fontSize: 7, fontWeight: 900, color: "#78909c", position: "relative", top: -4, left: 1, imageRendering: "auto" }}>z</span>
        </div>
      )}
    </div>
  );
}

/* ─── pixel speech bubble ─── */
function PixelBubble({ msg, mood }: { msg: string; mood: Mood }) {
  const bg = mood === "sad" ? "bg-red-50 dark:bg-red-950/90" : mood === "panic" ? "bg-amber-50 dark:bg-amber-950/90" : "bg-emerald-50 dark:bg-emerald-950/90";
  const text = mood === "sad" ? "text-red-700 dark:text-red-300" : mood === "panic" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300";
  const border = mood === "sad" ? "border-red-300 dark:border-red-800" : mood === "panic" ? "border-amber-300 dark:border-amber-800" : "border-emerald-300 dark:border-emerald-800";

  return (
    <div className={`relative ${bg} ${text} ${border} border-2 px-2 py-1 shadow-md`}
      style={{
        imageRendering: "auto",
        clipPath: "polygon(4px 0%, calc(100% - 4px) 0%, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) 100%, 12px 100%, 8px calc(100% + 5px), 8px 100%, 4px 100%, 0% calc(100% - 4px), 0% 4px)",
      }}
    >
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{msg}</span>
    </div>
  );
}

/* ─── main component ─── */
export function DinoMascot() {
  const statsKey = useFilteredKey("/api/stats");
  const { data: stats } = useSWR<DashboardStats>(statsKey);

  const [msg, setMsg] = useState("");
  const [showBubble, setShowBubble] = useState(false);
  const [posX, setPosX] = useState(80);
  const [facingLeft, setFacingLeft] = useState(false);
  const [walking, setWalking] = useState(false);
  const [sleeping, setSleeping] = useState(false);
  const [frame, setFrame] = useState(0);
  const targetX = useRef(80);
  const raf = useRef(0);
  const bubbleTimer = useRef<NodeJS.Timeout>();

  const down = stats?.down ?? 0;
  const total = stats?.total ?? 0;
  const allDown = total > 0 && down === total;
  const someDown = down > 0 && !allDown;
  const mood: Mood = allDown ? "sad" : someDown ? "panic" : "happy";

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), 180);
    return () => clearInterval(id);
  }, []);

  // Error sound — plays each time dino says a panic/sad message
  const errorAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio("/sounds/error.mp3");
    audio.volume = 0.5;
    errorAudio.current = audio;
  }, []);

  const say = useCallback((pool: string[], playSound = false) => {
    clearTimeout(bubbleTimer.current);
    setMsg(pool[Math.floor(Math.random() * pool.length)]);
    setShowBubble(true);
    if (playSound && errorAudio.current) {
      errorAudio.current.currentTime = 0;
      errorAudio.current.play().catch(() => {});
    }
    bubbleTimer.current = setTimeout(() => setShowBubble(false), 5000);
  }, []);

  const pickBehavior = useCallback(() => {
    setSleeping(false);
    if (mood === "sad") { setWalking(false); say(sadMsg, true); return; }
    if (mood === "panic") {
      const maxW = typeof window !== "undefined" ? window.innerWidth - 120 : 600;
      targetX.current = Math.random() * maxW + 40;
      setWalking(true); say(panicMsg, true); return;
    }
    const r = Math.random();
    if (r < 0.4) {
      const maxW = typeof window !== "undefined" ? window.innerWidth - 120 : 600;
      targetX.current = Math.random() * maxW + 40;
      setWalking(true);
    } else if (r < 0.6) {
      setWalking(false); say(happyMsg);
    } else if (r < 0.75) {
      setWalking(false); setSleeping(true);
    } else {
      const maxW = typeof window !== "undefined" ? window.innerWidth - 120 : 600;
      targetX.current = Math.random() * maxW + 40;
      setWalking(true);
    }
  }, [mood, say]);

  useEffect(() => {
    pickBehavior();
    const id = setInterval(pickBehavior, mood === "panic" ? 6000 : 8000);
    return () => clearInterval(id);
  }, [pickBehavior, mood]);

  useEffect(() => {
    if (!walking) { cancelAnimationFrame(raf.current); return; }
    const speed = mood === "panic" ? 3 : 1.2;
    let active = true;
    function step() {
      if (!active) return;
      setPosX((x) => {
        const diff = targetX.current - x;
        if (Math.abs(diff) < 3) { setWalking(false); return x; }
        setFacingLeft(diff < 0);
        return x + (diff > 0 ? speed : -speed);
      });
      raf.current = requestAnimationFrame(step);
    }
    raf.current = requestAnimationFrame(step);
    return () => { active = false; cancelAnimationFrame(raf.current); };
  }, [walking, mood]);

  useEffect(() => {
    if (!walking) return;
    const id = setInterval(() => say(someDown ? panicMsg : happyMsg, someDown), 8000);
    return () => clearInterval(id);
  }, [walking, someDown, say]);

  if (!stats || total === 0) return null;

  const bob = walking ? (frame % 2 === 0 ? -1 : 1) : 0;

  return (
    <div
      className="fixed bottom-1 z-50"
      style={{ left: posX, transition: walking ? "none" : "left 0.3s" }}
    >
      <div className={`pointer-events-none mb-1 transition-all duration-300 ${
        showBubble && !sleeping ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-90"
      }`}>
        <PixelBubble msg={msg} mood={mood} />
      </div>

      <div
        className="cursor-pointer"
        style={{
          transform: `scaleX(${facingLeft ? -1 : 1}) translateY(${bob}px)`,
          transition: "transform 0.1s",
        }}
        title="Click me!"
        onClick={() => say(mood === "sad" ? sadMsg : mood === "panic" ? panicMsg : happyMsg)}
      >
        <DinoSprite mood={mood} animFrame={walking ? frame : 0} isSleeping={sleeping} />
      </div>

    </div>
  );
}
