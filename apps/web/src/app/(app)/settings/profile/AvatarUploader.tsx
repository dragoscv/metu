'use client';

import { useRef, useState } from 'react';
import { Button } from '@metu/ui';
import { uploadAvatarAction } from '@/app/actions/profile';

interface Props {
  currentImage: string | null;
}

export function AvatarUploader({ currentImage }: Props) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentImage);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await uploadAvatarAction(fd);
      if (!res.ok) setError(res.error);
      else setPreview(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onChange}
        className="hidden"
      />
      <Button type="button" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
        {busy ? 'Uploading…' : preview ? 'Replace avatar' : 'Upload avatar'}
      </Button>
      {error ? (
        <span className="text-sm text-[var(--color-fg-danger)]">{error}</span>
      ) : (
        <span className="text-sm text-[var(--color-fg-muted)]">PNG, JPEG or WebP. Max 2 MiB.</span>
      )}
    </div>
  );
}
