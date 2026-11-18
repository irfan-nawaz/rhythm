'use client';

import { Copy, MessageCircle, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * A freshly made invite link and the ways to send it. The link is shown only
 * here: the server keeps just its hash, so a lost link means making a new one.
 */
export function InviteShare({ url, text }: { url: string; text: string }) {
  const t = useTranslations('group');
  const field = useRef<HTMLInputElement>(null);
  // The share sheet exists on phones, rarely on desktops. Checked after the
  // first render, so the server and browser render the same buttons.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === 'function'), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copied'));
    } catch {
      // No clipboard access (plain HTTP, or blocked): select it for a manual copy.
      field.current?.select();
    }
  }

  async function share() {
    try {
      // The text already contains the link; passing url too makes some apps paste it twice.
      await navigator.share({ text });
    } catch {
      // Closed the share sheet: nothing to do.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Input ref={field} readOnly value={url} aria-label={t('linkLabel')} onFocus={(e) => e.currentTarget.select()} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={copy}>
          <Copy aria-hidden />
          {t('copyLink')}
        </Button>
        {canShare ? (
          <Button variant="secondary" onClick={share}>
            <Share2 aria-hidden />
            {t('share')}
          </Button>
        ) : null}
        <Button variant="secondary" asChild>
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden />
            {t('whatsapp')}
          </a>
        </Button>
      </div>
    </div>
  );
}
