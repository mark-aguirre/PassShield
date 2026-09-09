'use client';

/**
 * PasswordGenerator — Screen 4 of the mockups. A self-contained password
 * generator pane.
 *
 * Responsibilities:
 *   - Renders the generated value (monospace) with reveal/hide, copy, and
 *     regenerate controls, plus a locally-computed strength bar and label.
 *   - Exposes the full option set: length slider + numeric input, charset
 *     checkboxes, an "Exclude Similar Characters" toggle, and a Customize panel
 *     (minimum numbers/symbols steppers, avoid-ambiguous and ensure-every-type
 *     toggles).
 *   - Quick Actions: Copy Password, Regenerate, and Save as Custom.
 *
 * Security / policy posture:
 *   - Generation and strength scoring happen in the main/shared package, reached
 *     only via the narrow `window.passShield.generator.generate` IPC surface;
 *     the renderer never scores or generates locally. _(Req 18.2)_
 *   - Copies route through `clipboard.copySecret`, which owns the clear timer in
 *     the main process. _(Req 8.5, 9.3, 9.4)_
 *   - The UI makes NO password-policy compliance claims; the Tips card is
 *     non-prescriptive guidance only. _(Req 8.6, 18.3)_
 *
 * _(Req 8.5, 8.6, 18.1, 18.2, 18.3)_
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GeneratedPassword,
  GeneratorOptions,
  PasswordStrength,
} from '@passshield/contracts';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

/** Props for {@link PasswordGenerator}. */
export interface PasswordGeneratorProps {
  /** Invoked when the user chooses "Save as Custom". */
  onSaveAsCustom?: (value: string) => void;
  /** Invoked when the user closes the generator pane (the `X` control). */
  onClose?: () => void;
}

/** Sensible defaults for a first render (strong but unopinionated). */
const DEFAULT_OPTIONS: GeneratorOptions = {
  length: 20,
  upper: true,
  lower: true,
  numbers: true,
  symbols: true,
  excludeSimilar: false,
  avoidAmbiguous: false,
  ensureEveryType: true,
  minNumbers: 1,
  minSymbols: 1,
};

const MIN_LENGTH = 8;
const MAX_LENGTH = 64;
const REGENERATE_DEBOUNCE_MS = 120;

/**
 * Bar colors per strength score (0-4). Purely visual affordances; carry NO
 * policy-compliance meaning. _(Req 18.3)_
 */
const STRENGTH_COLORS: Record<PasswordStrength['score'], string> = {
  0: '#ef4444',
  1: '#f97316',
  2: '#eab308',
  3: '#22c55e',
  4: '#16a34a',
};

const ERROR_MESSAGES: Record<string, string> = {
  validation:
    'These options can’t be satisfied together. Try a longer length or lower minimums.',
  locked: 'Your vault is locked. Unlock it to generate a password.',
};

const GENERIC_ERROR_MESSAGE = 'Unable to generate a password with these options.';

/** Screen 4 password generator pane. */
export function PasswordGenerator({ onSaveAsCustom, onClose }: PasswordGeneratorProps) {
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_OPTIONS);
  const [generated, setGenerated] = useState<GeneratedPassword | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const requestToken = useRef(0);

  const generate = useCallback(async (opts: GeneratorOptions) => {
    const token = ++requestToken.current;
    setBusy(true);
    try {
      const result = await api.generator.generate(opts);
      if (token !== requestToken.current) {
        return;
      }
      if (result.ok) {
        setGenerated(result.value);
        setError(null);
      } else {
        setError(
          ERROR_MESSAGES[result.error.code] ?? result.error.message ?? GENERIC_ERROR_MESSAGE,
        );
      }
    } catch {
      if (token === requestToken.current) {
        setError(GENERIC_ERROR_MESSAGE);
      }
    } finally {
      if (token === requestToken.current) {
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void generate(options);
    }, REGENERATE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [options, generate]);

  const updateOption = useCallback(
    <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) => {
      setOptions((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleRegenerate = useCallback(() => {
    void generate(options);
  }, [generate, options]);

  const handleCopy = useCallback(async () => {
    if (!generated?.value) {
      return;
    }
    try {
      await api.clipboard.copySecret(generated.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // A failed copy is non-fatal.
    }
  }, [generated]);

  const value = generated?.value ?? '';
  const strength = generated?.strength ?? null;

  return (
    <section className="flex h-full w-full flex-col overflow-y-auto bg-background" aria-label="Password generator">
      <div className="flex items-start justify-between gap-4 p-8 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Password Generator</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create strong, random passwords for your accounts.
          </p>
        </div>
        <Button type="button" variant="outline" size="icon" aria-label="Close password generator" onClick={() => onClose?.()}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-6 px-8 pb-8 lg:grid-cols-[1fr_300px]">
        {/* --- Main column --- */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted-foreground">Generated Password</span>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
              <span className="min-w-0 truncate font-mono text-xl text-foreground" aria-label="Generated password">
                {value ? (revealed ? value : '•'.repeat(Math.min(value.length, 32))) : '—'}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <IconBtn label={revealed ? 'Hide password' : 'Reveal password'} pressed={revealed} onClick={() => setRevealed((p) => !p)} disabled={!value}>
                  {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </IconBtn>
                <IconBtn label="Copy password" onClick={() => void handleCopy()} disabled={!value}>
                  {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                </IconBtn>
                <IconBtn label="Regenerate password" onClick={handleRegenerate} disabled={busy}>
                  <RefreshCw className="size-4" />
                </IconBtn>
              </div>
            </div>
          </div>

          <StrengthMeter strength={strength} />

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Length + charsets */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Length: {options.length}</span>
                  <input
                    type="number"
                    min={MIN_LENGTH}
                    max={MAX_LENGTH}
                    value={options.length}
                    aria-label="Password length"
                    className="h-8 w-16 rounded-md border border-input bg-card px-2 text-center text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                    onChange={(e) => updateOption('length', clampLength(Number(e.target.value)))}
                  />
                </div>
                <Slider
                  min={MIN_LENGTH}
                  max={MAX_LENGTH}
                  value={[options.length]}
                  aria-label="Password length slider"
                  onValueChange={([v]) => updateOption('length', clampLength(v))}
                />
              </div>

              <div className="flex flex-col gap-3 pt-1">
                <CheckRow label="Uppercase (A-Z)" checked={options.upper} onChange={(v) => updateOption('upper', v)} />
                <CheckRow label="Lowercase (a-z)" checked={options.lower} onChange={(v) => updateOption('lower', v)} />
                <CheckRow label="Numbers (0-9)" checked={options.numbers} onChange={(v) => updateOption('numbers', v)} />
                <CheckRow label="Symbols (!@#$%^&*)" checked={options.symbols} onChange={(v) => updateOption('symbols', v)} />
                <CheckRow label="Exclude Similar Characters (l, 1, I, 0, O)" checked={options.excludeSimilar} onChange={(v) => updateOption('excludeSimilar', v)} />
              </div>
            </div>

            {/* Customize card */}
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/40 p-4">
              <span className="text-sm font-semibold text-foreground">Customize</span>
              <Stepper label="Minimum Numbers" value={options.minNumbers} min={0} max={options.length} onChange={(v) => updateOption('minNumbers', v)} />
              <Stepper label="Minimum Symbols" value={options.minSymbols} min={0} max={options.length} onChange={(v) => updateOption('minSymbols', v)} />
              <SwitchRow label="Avoid Ambiguous Characters" checked={options.avoidAmbiguous} onChange={(v) => updateOption('avoidAmbiguous', v)} />
              <SwitchRow label="Ensure Every Type" checked={options.ensureEveryType} onChange={(v) => updateOption('ensureEveryType', v)} />
            </div>
          </div>

          <div className="mt-auto flex items-center justify-end gap-3 border-t border-border pt-6">
            <Button type="button" variant="outline" onClick={() => setOptions(DEFAULT_OPTIONS)}>
              Clear
            </Button>
            <Button type="button" onClick={() => void handleCopy()} disabled={!value}>
              <Copy className="size-4" />
              Copy Password
            </Button>
          </div>
        </div>

        {/* --- Right sidebar: Quick Actions + Tips --- */}
        <aside className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm">
            <span className="mb-2 text-sm font-semibold text-foreground">Quick Actions</span>
            <QuickAction icon={<Copy className="size-4" />} title="Copy Password" subtitle="Copy to clipboard" onClick={() => void handleCopy()} disabled={!value} />
            <QuickAction icon={<RefreshCw className="size-4" />} title="Regenerate" subtitle="Generate a new password" onClick={handleRegenerate} disabled={busy} />
            <QuickAction icon={<Save className="size-4" />} title="Save as Custom" subtitle="Save to your vault" onClick={() => value && onSaveAsCustom?.(value)} disabled={!value} />
          </div>

          <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <ShieldCheck className="size-5 shrink-0 text-primary" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-foreground">Tips</span>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Use long passwords (16+ characters) with a mix of letters, numbers, and symbols
                for maximum security. Use a unique password for each account.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default PasswordGenerator;

/** Clamp a length input into the supported slider range. */
function clampLength(raw: number): number {
  if (Number.isNaN(raw)) {
    return MIN_LENGTH;
  }
  return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(raw)));
}

/**
 * Colored strength bar (segmented) with its label. Renders the score/label
 * returned by the generator; makes no policy-compliance claim. _(Req 18.1, 18.3)_
 */
function StrengthMeter({ strength }: { strength: PasswordStrength | null }) {
  const score = strength?.score ?? -1;
  const color = strength ? STRENGTH_COLORS[strength.score] : undefined;
  const filledSegments = strength ? score + 1 : 0;

  return (
    <div className="flex items-center gap-4">
      <div
        className="flex flex-1 gap-1.5"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={strength ? score : undefined}
        aria-label="Password strength"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full bg-muted transition-colors"
            style={i < filledSegments && color ? { backgroundColor: color } : undefined}
          />
        ))}
      </div>
      <span className="min-w-[5.5rem] text-right text-sm font-semibold" style={color ? { color } : undefined}>
        {strength ? strength.label : '—'}
      </span>
    </div>
  );
}

/** A labelled checkbox row. */
function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span>{label}</span>
    </label>
  );
}

/** A labelled switch row. */
function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

/** A numeric stepper with up/down chevrons and a bounded value. */
function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-1 rounded-md border border-input bg-card px-2 py-1">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          className="w-8 bg-transparent text-center text-sm text-foreground outline-none"
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
        <div className="flex flex-col">
          <button type="button" aria-label={`Increase ${label}`} className="text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => onChange(clamp(value + 1))} disabled={value >= max}>
            <ChevronUp className="size-3.5" />
          </button>
          <button type="button" aria-label={`Decrease ${label}`} className="text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => onChange(clamp(value - 1))} disabled={value <= min}>
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** A Quick Actions row (icon + title + subtitle). */
function QuickAction({ icon, title, subtitle, onClick, disabled }: { icon: React.ReactNode; title: string; subtitle: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}

/** A small square icon button for the display card. */
function IconBtn({ label, pressed, onClick, disabled, children }: { label: string; pressed?: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      {children}
    </button>
  );
}
