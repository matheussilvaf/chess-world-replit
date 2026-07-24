import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { CHARACTERS } from '../../game/characters/characterCatalog';
import { ArrowLeft, Crosshair, Circle } from 'lucide-react';

interface CharacterConfig {
  character_id: string;
  origin_x: number;
  origin_y: number;
  body_offset_x: number;
  body_offset_y: number;
  body_radius: number;
}

type DragTarget = 'origin' | 'body' | null;

const CANVAS_SCALE = 3;
const SNAP_DISTANCE = 4;

export function CharacterConfigEditor() {
  const [selectedCharId, setSelectedCharId] = useState<string>(Object.keys(CHARACTERS)[0]);
  const [config, setConfig] = useState<CharacterConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [spriteImage, setSpriteImage] = useState<HTMLImageElement | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [snapping, setSnapping] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const charDef = CHARACTERS[selectedCharId];

  useEffect(() => {
    loadConfig(selectedCharId);
  }, [selectedCharId]);

  useEffect(() => {
    if (!charDef) return;
    const img = new Image();
    img.src = charDef.sheet;
    img.onload = () => setSpriteImage(img);
  }, [charDef]);

  useEffect(() => {
    drawCanvas();
  }, [config, spriteImage, currentFrame, snapping]);

  const loadConfig = async (charId: string) => {
    const { data } = await supabase
      .from('character_configs')
      .select('*')
      .eq('character_id', charId)
      .maybeSingle();

    if (data) {
      setConfig(data as CharacterConfig);
    } else {
      const defaults: CharacterConfig = {
        character_id: charId,
        origin_x: 0.5,
        origin_y: 0.5,
        body_offset_x: 0,
        body_offset_y: 21,
        body_radius: 10,
      };
      setConfig(defaults);
    }
  };

  const saveConfig = useCallback(async (cfg: CharacterConfig) => {
    setSaving(true);
    const { error } = await supabase
      .from('character_configs')
      .upsert({
        ...cfg,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'character_id' });

    setSaving(false);
    if (!error) {
      setLastSaved(new Date().toLocaleTimeString());
    }
  }, []);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !config || !charDef) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fw = charDef.frameWidth;
    const fh = charDef.frameHeight;
    const s = CANVAS_SCALE;

    canvas.width = fw * s;
    canvas.height = fh * s;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw checkerboard background
    const tileSize = 8 * s;
    for (let y = 0; y < canvas.height; y += tileSize) {
      for (let x = 0; x < canvas.width; x += tileSize) {
        const isLight = ((x / tileSize) + (y / tileSize)) % 2 === 0;
        ctx.fillStyle = isLight ? '#1e293b' : '#0f172a';
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }

    // Draw sprite frame
    if (spriteImage) {
      const col = currentFrame % charDef.columns;
      const row = Math.floor(currentFrame / charDef.columns);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        spriteImage,
        col * fw, row * fh, fw, fh,
        0, 0, fw * s, fh * s
      );
    }

    // Draw frame border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, fw * s, fh * s);

    // Snap guides (center lines)
    const centerX = (fw * s) / 2;
    const centerY = (fh * s) / 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, fh * s);
    ctx.moveTo(0, centerY);
    ctx.lineTo(fw * s, centerY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Origin point (CYAN crosshair)
    const ox = config.origin_x * fw * s;
    const oy = config.origin_y * fh * s;

    // Snap indicators
    if (snapping.x) {
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(ox, 0);
      ctx.lineTo(ox, fh * s);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (snapping.y) {
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(0, oy);
      ctx.lineTo(fw * s, oy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw origin crosshair
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox - 10, oy);
    ctx.lineTo(ox + 10, oy);
    ctx.moveTo(ox, oy - 10);
    ctx.lineTo(ox, oy + 10);
    ctx.stroke();

    // Small label
    ctx.font = '10px monospace';
    ctx.fillStyle = '#00ffff';
    ctx.fillText('ORIGIN', ox + 12, oy - 4);

    // Collision body circle (RED)
    const bx = ox + config.body_offset_x * s;
    const by = oy + config.body_offset_y * s;
    const br = config.body_radius * s;

    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.stroke();

    // Body center dot
    ctx.fillStyle = '#ff3333';
    ctx.beginPath();
    ctx.arc(bx, by, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff3333';
    ctx.fillText('BODY', bx + br + 4, by + 4);

    // Foot line (bottom of circle)
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(bx - br - 5, by + br);
    ctx.lineTo(bx + br + 5, by + br);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#00ff00';
    ctx.fillText('FEET', bx + br + 4, by + br + 3);
  };

  const getCanvasPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!config || !charDef) return;
    const pos = getCanvasPos(e);
    const s = CANVAS_SCALE;
    const fw = charDef.frameWidth;
    const fh = charDef.frameHeight;

    const ox = config.origin_x * fw * s;
    const oy = config.origin_y * fh * s;
    const bx = ox + config.body_offset_x * s;
    const by = oy + config.body_offset_y * s;

    const distToOrigin = Math.hypot(pos.x - ox, pos.y - oy);
    const distToBody = Math.hypot(pos.x - bx, pos.y - by);

    if (distToOrigin < 15) {
      setDragTarget('origin');
    } else if (distToBody < config.body_radius * s + 10) {
      setDragTarget('body');
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragTarget || !config || !charDef) return;
    const pos = getCanvasPos(e);
    const s = CANVAS_SCALE;
    const fw = charDef.frameWidth;
    const fh = charDef.frameHeight;

    if (dragTarget === 'origin') {
      let newX = pos.x / (fw * s);
      let newY = pos.y / (fh * s);

      // Snap to center
      const snapX = Math.abs(newX - 0.5) < (SNAP_DISTANCE / fw);
      const snapY = Math.abs(newY - 0.5) < (SNAP_DISTANCE / fh);
      if (snapX) newX = 0.5;
      if (snapY) newY = 0.5;
      setSnapping({ x: snapX, y: snapY });

      newX = Math.max(0, Math.min(1, newX));
      newY = Math.max(0, Math.min(1, newY));

      setConfig({ ...config, origin_x: Math.round(newX * 1000) / 1000, origin_y: Math.round(newY * 1000) / 1000 });
    } else if (dragTarget === 'body') {
      const ox = config.origin_x * fw * s;
      const oy = config.origin_y * fh * s;
      const offsetX = (pos.x - ox) / s;
      const offsetY = (pos.y - oy) / s;
      setConfig({
        ...config,
        body_offset_x: Math.round(offsetX * 10) / 10,
        body_offset_y: Math.round(offsetY * 10) / 10,
      });
    }
  };

  const handleMouseUp = () => {
    if (dragTarget && config) {
      saveConfig(config);
    }
    setDragTarget(null);
    setSnapping({ x: false, y: false });
  };

  const directionNames = charDef?.directions || [];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center gap-4 mb-10">
          <a
            href="/admin"
            className="flex items-center justify-center w-10 h-10 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-300" />
          </a>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <Crosshair className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Character Configuration</h1>
              <p className="text-sm text-slate-400">Define origin point and collision body position</p>
            </div>
          </div>
        </div>

        {/* Status bar */}
        {lastSaved && (
          <div className="mb-6 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-sm text-emerald-400">
              {saving ? 'Saving...' : `Saved at ${lastSaved}`}
            </p>
          </div>
        )}

        {/* Character selector */}
        <div className="mb-6">
          <label className="text-xs text-slate-500 uppercase tracking-wide mb-2 block">Character</label>
          <div className="flex gap-2">
            {Object.keys(CHARACTERS).map((id) => (
              <button
                key={id}
                onClick={() => { setSelectedCharId(id); setCurrentFrame(0); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedCharId === id
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Canvas area */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <h2 className="text-base font-medium text-white mb-4">Frame Preview</h2>

            {/* Direction / Frame picker */}
            <div className="mb-4">
              <label className="text-xs text-slate-500 uppercase tracking-wide mb-2 block">Direction</label>
              <div className="flex flex-wrap gap-1">
                {directionNames.map((dir, i) => (
                  <button
                    key={dir}
                    onClick={() => setCurrentFrame(i * charDef.framesPerDirection)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      Math.floor(currentFrame / charDef.framesPerDirection) === i
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {dir}
                  </button>
                ))}
              </div>
            </div>

            {/* Frame within direction */}
            <div className="mb-4">
              <label className="text-xs text-slate-500 uppercase tracking-wide mb-2 block">
                Frame ({currentFrame % charDef.framesPerDirection + 1}/{charDef.framesPerDirection})
              </label>
              <input
                type="range"
                min="0"
                max={charDef.framesPerDirection - 1}
                value={currentFrame % charDef.framesPerDirection}
                onChange={(e) => {
                  const dirIdx = Math.floor(currentFrame / charDef.framesPerDirection);
                  setCurrentFrame(dirIdx * charDef.framesPerDirection + parseInt(e.target.value));
                }}
                className="w-full h-2 rounded-full appearance-none bg-slate-700 cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500
                  [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
                  [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-cyan-500
                  [&::-moz-range-thumb]:border-none"
              />
            </div>

            {/* The canvas */}
            <div className="flex justify-center bg-slate-950 rounded-lg p-4 border border-slate-800">
              <canvas
                ref={canvasRef}
                className="cursor-crosshair"
                style={{ imageRendering: 'pixelated' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
            </div>

            <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full border-2 border-cyan-400"></span> Origin (drag)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full border-2 border-red-400"></span> Body (drag)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-green-400"></span> Feet line
              </span>
            </div>
          </div>

          {/* Controls panel */}
          <div className="space-y-6">
            {/* Origin controls */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <Crosshair className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-sm font-medium text-white">Sprite Origin</h2>
                  <p className="text-xs text-slate-400">Anchor point of the sprite (0-1 fraction of frame)</p>
                </div>
              </div>

              {config && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">X</label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      value={config.origin_x}
                      onChange={(e) => {
                        const c = { ...config, origin_x: parseFloat(e.target.value) || 0 };
                        setConfig(c);
                        saveConfig(c);
                      }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Y</label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      value={config.origin_y}
                      onChange={(e) => {
                        const c = { ...config, origin_y: parseFloat(e.target.value) || 0 };
                        setConfig(c);
                        saveConfig(c);
                      }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    />
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  if (!config) return;
                  const c = { ...config, origin_x: 0.5, origin_y: 0.5 };
                  setConfig(c);
                  saveConfig(c);
                }}
                className="mt-3 px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
              >
                Snap to Center
              </button>
            </div>

            {/* Body controls */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <Circle className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <h2 className="text-sm font-medium text-white">Collision Body</h2>
                  <p className="text-xs text-slate-400">Circle positioned relative to origin (pixels)</p>
                </div>
              </div>

              {config && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Offset X (px)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={config.body_offset_x}
                        onChange={(e) => {
                          const c = { ...config, body_offset_x: parseFloat(e.target.value) || 0 };
                          setConfig(c);
                          saveConfig(c);
                        }}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Offset Y (px)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={config.body_offset_y}
                        onChange={(e) => {
                          const c = { ...config, body_offset_y: parseFloat(e.target.value) || 0 };
                          setConfig(c);
                          saveConfig(c);
                        }}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Radius (px)</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="3"
                        max="30"
                        step="1"
                        value={config.body_radius}
                        onChange={(e) => {
                          const c = { ...config, body_radius: parseFloat(e.target.value) };
                          setConfig(c);
                          saveConfig(c);
                        }}
                        className="flex-1 h-2 rounded-full appearance-none bg-slate-700 cursor-pointer
                          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-500
                          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
                          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-red-500
                          [&::-moz-range-thumb]:border-none"
                      />
                      <span className="text-sm font-mono text-red-400 w-10 text-right">{config.body_radius}px</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Info box */}
            <div className="bg-slate-900/50 rounded-xl border border-slate-800/50 p-5">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">How it works</h3>
              <ul className="text-xs text-slate-500 space-y-1.5">
                <li>- Drag the <span className="text-cyan-400">cyan crosshair</span> to set the sprite origin (snaps to center)</li>
                <li>- Drag the <span className="text-red-400">red circle</span> to position the collision body</li>
                <li>- The <span className="text-green-400">green line</span> shows where the feet (ground contact) will be</li>
                <li>- Changes are saved automatically and loaded by the game in real-time</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
