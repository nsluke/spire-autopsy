/**
 * Dropzone — the big dashed drop target on the landing screen.
 *
 * It is a real <button>: click opens the OS folder picker (File System Access
 * API on Chromium, hidden <input webkitdirectory> everywhere else), and the
 * whole surface accepts dragged files OR folders via filesFromDataTransfer.
 * Everything collected is passed through untouched — isRunFile filtering
 * happens inside the import pipeline.
 */
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { filesFromDataTransfer, filesFromDirectoryHandle, supportsDirectoryPicker } from '../lib/import';

interface DropzoneProps {
  onFiles: (files: File[]) => void | Promise<void>;
  /** true while an import is in flight — the zone ignores clicks and drops */
  disabled: boolean;
}

/** window.showDirectoryPicker is Chromium-only and absent from lib.dom. */
interface DirectoryPickerWindow {
  showDirectoryPicker: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

export default function Dropzone({ onFiles, disabled }: DropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleDragOver(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault(); // required so the browser allows a drop at all
    if (!disabled) setDragOver(true);
  }

  function handleDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    // dt.items must be walked in this tick; the async part is reading entries.
    // Pass through even an empty result — the import pipeline reports
    // "no .run files found" non-fatally, which beats silent nothing.
    void filesFromDataTransfer(e.dataTransfer).then((files) => void onFiles(files));
  }

  async function handleClick() {
    if (disabled) return;
    if (supportsDirectoryPicker) {
      try {
        const handle = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
          id: 'sts2-history',
          mode: 'read',
        });
        const files = await filesFromDirectoryHandle(handle);
        void onFiles(files);
      } catch {
        // user cancelled the picker — silently fine
      }
    } else {
      inputRef.current?.click();
    }
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = ''; // allow re-picking the same folder later
    if (files.length > 0) void onFiles(files);
  }

  return (
    <>
      <button
        type="button"
        className={dragOver ? 'dropzone dragOver' : 'dropzone'}
        aria-disabled={disabled}
        aria-label="Import run files: drop your history folder here, or activate to browse for it"
        onClick={() => void handleClick()}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <span className="dropBig">
          Drag your <span className="dropFolder">history</span> folder here
        </span>
        <span className="dropHint">
          {supportsDirectoryPicker
            ? 'or click to choose the folder · Chrome/Edge re-syncs new runs in one click'
            : 'or click to choose the folder · already-imported runs are skipped'}
        </span>
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
