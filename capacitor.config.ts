import type { CapacitorConfig } from '@capacitor/cli';

// Native wrapper config. `webDir` is the Vite build output (`BASE_PATH=/ npm run build` → out/).
// The Android platform (android/) is generated on demand (in CI) via `npx cap add android`, so it
// isn't committed. The backend URL the app talks to is set in src/lib/api.ts.
const config: CapacitorConfig = {
  appId: 'com.eeclass.pad',
  appName: 'eeclass',
  webDir: 'out',
};

export default config;
