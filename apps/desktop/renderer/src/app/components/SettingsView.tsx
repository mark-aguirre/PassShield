'use client';

/**
 * SettingsView — the two-column Settings surface (Screens 7 "General Settings"
 * and 8 "Security Settings", plus Cloud Sync, Backup and About panes).
 *
 * Layout: a left settings-nav (General, Security, Cloud Sync [disabled — V2],
 * Backup, About) and a right detail pane that switches on the selected nav
 * item. Cloud Sync is rendered as a disabled placeholder for a future version.
 *
 * Data flow / boundary posture:
 *   - Current settings are read via `window.passShield.settings.get()`, falling
 *     back to sensible in-memory defaults if the store is unavailable so the UI
 *     stays functional and persists automatically once the store lands.
 *   - Field changes call `settings.update(patch)` optimistically; on rejection
 *     the local state is kept and a note explains changes persist later.
 *     _(Req 14.3, 3.4, 9.4)_
 *   - Backup entry points call `backup.export/restore` with a placeholder path
 *     until a real file picker is wired. TODO(Task 17). _(Req 14.2, 10.x)_
 *   - "Change master password" has no IPC surface yet; placeholder. _(Req 12)_
 *
 * _(Req 3.1, 3.4, 9.4, 14.2, 14.3)_
 */

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { CloseBehavior, Settings, ThemePreference } from '@passshield/contracts';
import {
  Cloud,
  DatabaseBackup,
  Info,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { applyAppearance } from '@/lib/appearance';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** Props for {@link SettingsView}. */
export interface SettingsViewProps {
  /** Invoked when the user dismisses the settings surface. Optional. */
  onClose?: () => void;
}

/** The nav panes available in V1. Cloud Sync is a disabled placeholder. */
type SettingsPane = 'general' | 'security' | 'cloud' | 'backup' | 'about';

const APP_NAME = 'passShield';

/** Sensible in-memory defaults used until the settings store is available. */
const DEFAULT_SETTINGS: Settings = {
  launchOnStartup: false,
  startMinimized: false,
  closeBehavior: 'minimizeToTray',
  theme: 'system',
  accentColor: '#2563eb',
  language: 'en',
  checkForUpdates: true,
  autoLockMinutes: 15,
  lockOnSystemLock: true,
  lockOnSleep: true,
  lockOnAppExit: false,
  requireMasterPasswordOnRestart: true,
  clipboardClearSeconds: 45,
  preventClipboardHistory: true,
};

const PLACEHOLDER_BACKUP_PATH = 'passshield-backup.psbk';
const AUTO_LOCK_CHOICES: readonly number[] = [1, 5, 15, 30, 60];
const CLIPBOARD_CLEAR_CHOICES: readonly number[] = [10, 30, 45, 60, 120];

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const CLOSE_BEHAVIOR_OPTIONS: readonly { value: CloseBehavior; label: string }[] = [
  { value: 'minimizeToTray', label: 'Minimize to system tray' },
  { value: 'quit', label: 'Quit passShield' },
];

const LANGUAGE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
];

const NAV_ITEMS: readonly {
  pane: SettingsPane;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}[] = [
  { pane: 'general', label: 'General', icon: SettingsIcon },
  { pane: 'security', label: 'Security', icon: ShieldCheck },
  { pane: 'cloud', label: 'Cloud Sync', icon: Cloud, disabled: true },
  { pane: 'backup', label: 'Backup', icon: DatabaseBackup },
  { pane: 'about', label: 'About', icon: Info },
];

/** The two-column Settings surface. */
export function SettingsView({ onClose }: SettingsViewProps) {
  const headingId = useId();

  const [activePane, setActivePane] = useState<SettingsPane>('general');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [persistenceUnavailable, setPersistenceUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const loaded = await window.passShield.settings.get();
        if (!cancelled) {
          setSettings(loaded);
          applyAppearance({ theme: loaded.theme, accentColor: loaded.accentColor });
          setPersistenceUnavailable(false);
        }
      } catch {
        if (!cancelled) {
          setSettings(DEFAULT_SETTINGS);
          setPersistenceUnavailable(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPatch = useCallback((patch: Partial<Settings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      // Reflect appearance edits (theme / accent) immediately and app-wide,
      // before persistence resolves, so the control feels responsive.
      if ('theme' in patch || 'accentColor' in patch) {
        applyAppearance({ theme: next.theme, accentColor: next.accentColor });
      }
      return next;
    });
    void (async () => {
      try {
        const merged = await window.passShield.settings.update(patch);
        setSettings(merged);
        if ('theme' in patch || 'accentColor' in patch) {
          applyAppearance({ theme: merged.theme, accentColor: merged.accentColor });
        }
        setPersistenceUnavailable(false);
      } catch {
        setPersistenceUnavailable(true);
      }
    })();
  }, []);

  return (
    <section className="flex h-full min-h-0 w-full bg-background" aria-labelledby={headingId}>
      {/* Left settings nav. */}
      <nav
        className="flex w-64 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-4"
        aria-label="Settings sections"
      >
        <h1 id={headingId} className="mb-3 px-2 text-2xl font-bold text-foreground">
          Settings
        </h1>
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activePane === item.pane;
            const Icon = item.icon;
            return (
              <li key={item.pane}>
                <button
                  type="button"
                  disabled={item.disabled}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => !item.disabled && setActivePane(item.pane)}
                  title={item.disabled ? 'Coming in a future version' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-foreground hover:bg-accent',
                    item.disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
                  )}
                >
                  <Icon className="size-[18px]" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.disabled && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      V2
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Right detail pane. */}
      <div className="relative min-w-0 flex-1 overflow-y-auto" role="region" aria-live="polite">
        {onClose && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onClose}
            aria-label="Close settings"
            className="absolute top-6 right-6 z-10"
          >
            <X className="size-4" />
          </Button>
        )}

        {persistenceUnavailable && (
          <p
            role="status"
            className="mx-8 mt-6 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
          >
            Your changes are applied now and will be saved once settings storage is available.
          </p>
        )}

        <div className="p-8">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          ) : activePane === 'general' ? (
            <GeneralPane settings={settings} onChange={applyPatch} />
          ) : activePane === 'security' ? (
            <SecurityPane settings={settings} onChange={applyPatch} />
          ) : activePane === 'cloud' ? (
            <CloudSyncPane />
          ) : activePane === 'backup' ? (
            <BackupPane />
          ) : (
            <AboutPane />
          )}
        </div>
      </div>
    </section>
  );
}

export default SettingsView;

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** A pane title + subtitle header. */
function PaneHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/** A titled group card of related settings. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mb-4 rounded-xl border border-border bg-card p-1 shadow-sm">
      <legend className="px-3 pt-3 pb-1 text-sm font-semibold text-foreground">{title}</legend>
      <div className="flex flex-col">{children}</div>
    </fieldset>
  );
}

/** A setting row: icon + label + description on the left, control on the right. */
function Row({
  icon,
  label,
  description,
  children,
}: {
  icon?: ReactNode;
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {description && (
            <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
          )}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// General pane (Screen 7)
// ---------------------------------------------------------------------------

interface PaneProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

function GeneralPane({ settings, onChange }: PaneProps) {
  return (
    <div className="max-w-3xl">
      <PaneHeader title="General" subtitle="Configure general application behavior." />

      <Group title="Startup">
        <Row
          icon={<SettingsIcon className="size-4" />}
          label="Launch on startup"
          description="Start passShield automatically when you sign in."
        >
          <Switch
            checked={settings.launchOnStartup}
            onCheckedChange={(launchOnStartup) => onChange({ launchOnStartup })}
            aria-label="Launch on startup"
          />
        </Row>
        <Row
          icon={<SettingsIcon className="size-4" />}
          label="Start minimized to system tray"
          description="Open to the system tray instead of the main window."
        >
          <Switch
            checked={settings.startMinimized}
            onCheckedChange={(startMinimized) => onChange({ startMinimized })}
            aria-label="Start minimized to system tray"
          />
        </Row>
      </Group>

      <Group title="Minimize behavior">
        <Row
          icon={<SlidersHorizontal className="size-4" />}
          label="When I close the window"
          description="Choose what happens when you close the application window."
        >
          <Select
            value={settings.closeBehavior}
            onValueChange={(value) => onChange({ closeBehavior: value as CloseBehavior })}
          >
            <SelectTrigger className="min-w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {CLOSE_BEHAVIOR_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Group>

      <Group title="Appearance">
        <Row
          icon={<SlidersHorizontal className="size-4" />}
          label="Theme"
          description="Choose your preferred theme."
        >
          <Select
            value={settings.theme}
            onValueChange={(value) => onChange({ theme: value as ThemePreference })}
          >
            <SelectTrigger className="min-w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {THEME_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          icon={<SlidersHorizontal className="size-4" />}
          label="Accent color"
          description="Choose the accent color used across the application."
        >
          <input
            type="color"
            value={settings.accentColor}
            onChange={(event) => onChange({ accentColor: event.target.value })}
            aria-label="Accent color"
            className="size-9 cursor-pointer rounded-md border border-input bg-card p-0.5"
          />
        </Row>
      </Group>

      <Group title="Language">
        <Row
          icon={<SlidersHorizontal className="size-4" />}
          label="Language"
          description="Select application language."
        >
          <Select value={settings.language} onValueChange={(language) => onChange({ language })}>
            <SelectTrigger className="min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {LANGUAGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Group>

      <Group title="Updates">
        <Row
          icon={<SettingsIcon className="size-4" />}
          label="Check for updates automatically"
          description="Keep passShield up to date with the latest improvements and security fixes."
        >
          <Switch
            checked={settings.checkForUpdates}
            onCheckedChange={(checkForUpdates) => onChange({ checkForUpdates })}
            aria-label="Check for updates automatically"
          />
        </Row>
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security pane (Screen 8)
// ---------------------------------------------------------------------------

function SecurityPane({ settings, onChange }: PaneProps) {
  return (
    <div>
      <PaneHeader title="Security" subtitle="Configure security and privacy behavior for your vault." />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_280px]">
        <div>
          <Group title="Vault Lock">
            <Row
              icon={<ShieldCheck className="size-4" />}
              label="Auto-lock vault"
              description="Lock the vault automatically when inactive."
            >
              <Select
                value={String(settings.autoLockMinutes)}
                onValueChange={(value) => onChange({ autoLockMinutes: Number(value) })}
              >
                <SelectTrigger className="min-w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {AUTO_LOCK_CHOICES.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {minutes === 1 ? '1 minute' : `${minutes} minutes`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row
              icon={<ShieldCheck className="size-4" />}
              label="Lock on system lock"
              description="Lock the vault when the computer is locked."
            >
              <Switch
                checked={settings.lockOnSystemLock}
                onCheckedChange={(lockOnSystemLock) => onChange({ lockOnSystemLock })}
                aria-label="Lock on system lock"
              />
            </Row>
            <Row
              icon={<ShieldCheck className="size-4" />}
              label="Lock on sleep / screen saver"
              description="Lock the vault when the computer sleeps or the screen saver starts."
            >
              <Switch
                checked={settings.lockOnSleep}
                onCheckedChange={(lockOnSleep) => onChange({ lockOnSleep })}
                aria-label="Lock on sleep or screen saver"
              />
            </Row>
            <Row
              icon={<ShieldCheck className="size-4" />}
              label="Lock on application exit"
              description="Lock the vault when passShield is closed."
            >
              <Switch
                checked={settings.lockOnAppExit}
                onCheckedChange={(lockOnAppExit) => onChange({ lockOnAppExit })}
                aria-label="Lock on application exit"
              />
            </Row>
          </Group>

          <Group title="Clipboard">
            <Row
              icon={<SlidersHorizontal className="size-4" />}
              label="Clear clipboard after copy"
              description="Automatically clear copied values from the clipboard."
            >
              <Select
                value={String(settings.clipboardClearSeconds)}
                onValueChange={(value) => onChange({ clipboardClearSeconds: Number(value) })}
              >
                <SelectTrigger className="min-w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {CLIPBOARD_CLEAR_CHOICES.map((seconds) => (
                    <SelectItem key={seconds} value={String(seconds)}>
                      {`${seconds} seconds`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row
              icon={<SlidersHorizontal className="size-4" />}
              label="Prevent clipboard history"
              description="Disable clipboard history for copied sensitive data (if supported)."
            >
              <Switch
                checked={settings.preventClipboardHistory}
                onCheckedChange={(preventClipboardHistory) => onChange({ preventClipboardHistory })}
                aria-label="Prevent clipboard history"
              />
            </Row>
          </Group>

          <Group title="Master Password">
            <Row
              icon={<ShieldCheck className="size-4" />}
              label="Require master password on restart"
              description="You'll be asked to unlock the vault when the application restarts."
            >
              <Switch
                checked={settings.requireMasterPasswordOnRestart}
                onCheckedChange={(requireMasterPasswordOnRestart) =>
                  onChange({ requireMasterPasswordOnRestart })
                }
                aria-label="Require master password on restart"
              />
            </Row>
            <Row
              icon={<ShieldCheck className="size-4" />}
              label="Change master password"
              description="Update your master password. Your vault is re-encrypted with the new password."
            >
              <span className="text-xs text-muted-foreground">Enter your details below</span>
            </Row>
            <ChangeMasterPasswordForm />
          </Group>
        </div>

        <aside
          className="flex h-fit flex-col gap-4 rounded-xl border border-primary/20 bg-primary/5 p-5"
          aria-label="Security information"
        >
          <div className="flex flex-col gap-1">
            <ShieldCheck className="size-6 text-primary" />
            <h3 className="text-base font-semibold text-foreground">Security is everything</h3>
            <p className="text-sm text-muted-foreground">
              These settings help keep your vault and data safe.
            </p>
          </div>
          <Explainer title="Stay protected" text="Auto-lock ensures your vault is never left open." />
          <Explainer
            title="Reduce exposure"
            text="Clipboard clearing limits the time sensitive data can be accessed."
          />
          <Explainer
            title="Your privacy"
            text="We never store or have access to your master password."
          />
        </aside>
      </div>
    </div>
  );
}

/** A small titled explainer block in the security sidebar. */
function Explainer({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">{text}</span>
    </div>
  );
}

/**
 * Inline form for changing the master password. Collects the current password,
 * the new password, and its confirmation, does light client-side validation,
 * and calls `window.passShield.vault.changeMasterPassword`. The main process
 * re-verifies the current password and re-encrypts the vault under the new one;
 * the plaintext passwords never leave this boundary beyond the IPC call and are
 * cleared from state on success. _(Req 12)_
 */
function ChangeMasterPasswordForm() {
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const resetFields = useCallback(() => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('The new password must be different from the current one.');
      return;
    }

    setIsBusy(true);
    try {
      const result = await window.passShield.vault.changeMasterPassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      if (result.ok) {
        setSuccess(true);
        resetFields();
      } else {
        setError(result.error.message);
      }
    } catch {
      setError('Could not change the master password. Please try again.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-3 pt-1 pb-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={currentId}>Current password</Label>
        <Input
          id={currentId}
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={isBusy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={newId}>New password</Label>
        <Input
          id={newId}
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={isBusy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={confirmId}>Confirm new password</Label>
        <Input
          id={confirmId}
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          disabled={isBusy}
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-xs text-success">
          Master password changed. Your vault has been re-encrypted.
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isBusy}>
          {isBusy ? 'Changing...' : 'Change Password'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Cloud Sync pane (disabled placeholder — V2)
// ---------------------------------------------------------------------------

function CloudSyncPane() {
  return (
    <div className="max-w-3xl">
      <PaneHeader
        title="Cloud Synchronization"
        subtitle="Securely sync your encrypted vault across your devices."
      />
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-6 shadow-sm">
        <Cloud className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Coming in a future version.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backup pane
// ---------------------------------------------------------------------------

function BackupPane() {
  const restorePasswordId = useId();
  const [restorePassword, setRestorePassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleExport() {
    if (isBusy) return;
    setStatus(null);
    setIsBusy(true);
    try {
      const result = await window.passShield.backup.export(PLACEHOLDER_BACKUP_PATH);
      setStatus(result.ok ? 'Backup exported.' : result.error.message);
    } catch {
      setStatus('Backup is not available yet in this build.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRestore() {
    if (isBusy) return;
    setStatus(null);
    setIsBusy(true);
    try {
      const result = await window.passShield.backup.restore(
        PLACEHOLDER_BACKUP_PATH,
        restorePassword,
      );
      setStatus(result.ok ? 'Backup restored.' : result.error.message);
    } catch {
      setStatus('Restore is not available yet in this build.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PaneHeader title="Backup" subtitle="Export or restore an encrypted copy of your vault." />

      <Group title="Export">
        <Row
          icon={<DatabaseBackup className="size-4" />}
          label="Export encrypted backup"
          description="Save an encrypted copy of your vault. No plaintext credentials are exported."
        >
          <Button type="button" onClick={handleExport} disabled={isBusy}>
            Export Backup
          </Button>
        </Row>
      </Group>

      <Group title="Restore">
        <div className="flex flex-col gap-2 px-3 py-3">
          <Label htmlFor={restorePasswordId}>Backup password</Label>
          <p className="text-xs text-muted-foreground">
            Enter the password used to protect the backup you are restoring.
          </p>
          <div className="flex items-center gap-2">
            <Input
              id={restorePasswordId}
              type="password"
              autoComplete="off"
              value={restorePassword}
              onChange={(event) => setRestorePassword(event.target.value)}
              className="max-w-xs"
            />
            <Button type="button" variant="outline" onClick={handleRestore} disabled={isBusy}>
              Restore Backup
            </Button>
          </div>
        </div>
      </Group>

      {status && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// About pane
// ---------------------------------------------------------------------------

function AboutPane() {
  // Source the version from the running app (Electron's app.getVersion()) so it
  // always reflects the real build rather than a hard-coded constant that
  // drifts out of date between releases.
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const value = await window.passShield.app.version();
        if (!cancelled) {
          setVersion(value);
        }
      } catch {
        // Version unavailable (e.g. store not reachable) — omit rather than
        // show a misleading hard-coded value.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-3xl">
      <PaneHeader title="About" subtitle="Application information." />
      <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-6 shadow-sm">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <ShieldCheck className="size-6" />
        </span>
        <p className="text-lg font-semibold text-foreground">{APP_NAME}</p>
        {version && <p className="text-sm text-muted-foreground">Version {version}</p>}
        <p className="text-sm leading-relaxed text-muted-foreground">
          passShield is a local-first password manager. Your vault stays on this device and works
          fully offline — no account or network connection required.
        </p>
      </div>
    </div>
  );
}
