# iPod Classic

## Install

Host the files together on HTTPS (or use localhost for development). Open the site in a supported browser while online first so the app shell can be cached.

- **iPhone or iPad:** Open the site in Safari, tap Share, then **Add to Home Screen**.
- **Android:** Open the site in Chrome or another PWA-capable browser, then choose **Install app** or **Add to Home screen** from its menu.
- **Desktop:** In a supported browser such as Chrome or Edge, use the install icon in the address bar or the browser menu.

Installation options and availability vary by browser and device. Once loaded online, the app interface can reopen offline, but YouTube playback, streamed music, and other online services require an internet connection. When deploying updates, increment the cache version in `service-worker.js` to refresh the offline shell.

## Removing songs

Choose **Music → Delete Songs**, select a song, and confirm **Delete Song** using the click wheel or by tapping the screen. Removing the current song stops playback; other songs stay in the queue. This removes the song only from the current in-memory queue, not from your device or YouTube. The queue is cleared when the app is reloaded.
