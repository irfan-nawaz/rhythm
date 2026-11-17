import type { MetadataRoute } from 'next';

// Makes Rhythm installable: "Add to Home Screen" on a phone opens it like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Rhythm',
    short_name: 'Rhythm',
    description: 'Daily routines, chores, workouts and meals for you and your family.',
    start_url: '/today',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
