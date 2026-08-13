/**
 * Dropzone — the big dashed drop target on the landing screen.
 *
 * It is a real <button>: click opens the OS folder picker (File System Access
 * API on Chromium, hidden <input webkitdirectory> everywhere else), and the
 * whole surface accepts dragged files OR folders via filesFromDataTransfer.
 * Everything collected is passed through untouched — isRunFile filtering
 * happens inside the import pipeline.
 *
 * A website cannot open the picker at an arbitrary path like
 * ~/Library/Application Support/... — browsers forbid that. After the user
 * has picked (or dropped) the history folder once, Chromium lets us persist
 * the directory handle and either re-read it on click or reopen the picker
 * in that same folder (id + startIn).
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  directoryHandleFromDataTransfer,
  ensureDirectoryRead,
  filesFromDataTransfer,
  filesFromDirectoryHandle,
  loadHistoryDirectory,
  rememberHistoryDirectory,
  supportsDirectoryPicker,
} from '../lib/import';

interface DropzoneProps {
  onFiles: (files: File[]) => void | Promise<void>;
  /** true while an import is in flight — the zone ignores clicks and drops */
  disabled: boolean;
  /** First-time navigation hint (e.g. macOS ⌘⇧G). */
  pickerHint?: string;
}

/** window.showDirectoryPicker is Chromium-only and absent from lib.dom. */
interface DirectoryPickerWindow {
  showDirectoryPicker: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }) => Promise<FileSystemDirectoryHandle>;
}

export default function Dropzone({ onFiles, disabled, pickerHint }: DropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!supportsDirectoryPicker) return;
    let alive = true;
    void loadHistoryDirectory().then((h) => {
      if (alive) setRemembered(Boolean(h));
    });
    return () => {
      alive = false;
    };
  }, []);

  function handleDragOver(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault(); // required so the browser allows a drop at all
    if (!disabled) setDragOver(true);
  }

  function handleDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    // dt.items must be walked in this tick; the async part is reading entries.
    const handleP = directoryHandleFromDataTransfer(e.dataTransfer);
    const filesP = filesFromDataTransfer(e.dataTransfer);
    void Promise.all([handleP, filesP]).then(([handle, files]) => {
      if (handle) {
        void rememberHistoryDirectory(handle).then(() => setRemembered(true));
      }
      void onFiles(files);
    });
  }

  async function pickDirectory(startIn?: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | undefined> {
    try {
      return await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
        id: 'sts2-history',
        mode: 'read',
        startIn,
      });
    } catch (err) {
      // AbortError = user cancelled. A stale startIn handle can also throw —
      // retry once without it so a revoked bookmark isn't a dead end.
      if (startIn && err instanceof DOMException && err.name !== 'AbortError') {
        try {
          return await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
            id: 'sts2-history',
            mode: 'read',
          });
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  }

  async function handleClick() {
    if (disabled) return;
    if (supportsDirectoryPicker) {
      const stored = await loadHistoryDirectory();
      if (stored && (await ensureDirectoryRead(stored))) {
        void onFiles(await filesFromDirectoryHandle(stored));
        return;
      }
      const handle = await pickDirectory(stored);
      if (!handle) return;
      await rememberHistoryDirectory(handle);
      setRemembered(true);
      void onFiles(await filesFromDirectoryHandle(handle));
    } else {
      inputRef.current?.click();
    }
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = ''; // allow re-picking the same folder later
    if (files.length > 0) void onFiles(files);
  }

  const hint = remembered
    ? 'click to re-read that history folder · new runs are skipped if already imported'
    : supportsDirectoryPicker
      ? pickerHint
        ? `or click to choose the folder · ${pickerHint}`
        : 'or click to choose the folder · Chrome/Edge remember it after the first pick'
      : 'or click to choose the folder · already-imported runs are skipped';

  return (
    <>
      <button
        type="button"
        className={dragOver ? 'dropzone dragOver' : 'dropzone'}
        aria-disabled={disabled}
        aria-label={
          remembered
            ? 'Re-import run files from the remembered history folder'
            : 'Import run files: drop your history folder here, or activate to browse for it'
        }
        onClick={() => void handleClick()}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <span className="dropBig">
          Drag your <span className="dropFolder">history</span> folder here
        </span>
        <span className="dropHint">{hint}</span>
      </button>
      <input
        // webkitdirectory is non-standard and missing from React's typings —
        // set it imperatively so the fallback picker selects a whole folder.
        ref={(el) => {
          inputRef.current = el;
          el?.setAttribute('webkitdirectory', '');
        }}
        className="dropInput"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleInputChange}
      />
    </>
  );
}
