# iPod Classic

## Install

Host the files together on HTTPS (or use localhost for development). Open the site in a supported browser while online first so the app shell can be cached.

- **iPhone or iPad:** Open the site in Safari, tap Share, then **Add to Home Screen**.
- **Android:** Open the site in Chrome or another PWA-capable browser, then choose **Install app** or **Add to Home screen** from its menu.
- **Desktop:** In a supported browser such as Chrome or Edge, use the install icon in the address bar or the browser menu.

Installation options and availability vary by browser and device. Once loaded online, the app interface can reopen offline, but YouTube playback, streamed music, and other online services require an internet connection. When deploying updates, increment the cache version in `service-worker.js` to refresh the offline shell.

## Background playback

Start a local song while the page is open. On supported browsers and devices, playback can continue when you switch apps or lock the screen; lock-screen and headset controls can play, pause, skip, and seek where supported. The app suspends its optional Web Audio visualizer and click-sound context while a local song is backgrounded, leaving native audio playback alone, and restores it when the app becomes visible. This is a best-effort compatibility measure, not a guarantee that a browser or device will continue playback. Keep the tab or installed app running: closing it, force-quitting it, or having the operating system terminate it stops playback. Browsers and operating systems can also suspend background playback, so behavior varies by device. YouTube tracks use the embedded YouTube player and may stop in the background due to browser or YouTube restrictions; this app cannot override those restrictions. The silent YouTube visualizer stream pauses in the background so it does not compete with playback. On browsers without native audio-stream capture, the local-song visualizer uses a decorative animation instead of live frequency analysis.

On Android, start a local song in Chrome or the installed app, then switch apps or lock the screen without closing it. If it stops, check that the browser or installed app is allowed to run in the background and that battery optimization is not restricting it. Use the device's media notification to resume if needed. Exact settings vary by phone and browser.

## Saved YouTube songs

YouTube song IDs, titles, and artists are saved on this device when added and restored when the app reopens. Deleting a YouTube song also removes it from the saved list. The app does not download YouTube audio or video: an internet connection is still required for playback. Local files are not saved and need to be added again after reopening. Storage is separate for different devices and may also be separate between a browser and an installed app, depending on the platform. Clearing site data, uninstalling the app, private browsing, or disabled/full storage can remove or prevent saved entries. If the screen says **Save failed** or **Library unavailable**, the list could not be saved or read; check the browser's storage settings and free space.

## Removing songs

Choose **Music → Delete Songs**, select a song, and confirm **Delete Song** using the click wheel or by tapping the screen. Removing the current song stops playback; other songs stay in the queue. For YouTube songs, this also removes the saved entry. It does not delete the original local file or YouTube video.
