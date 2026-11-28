# iPod Classic

## Install

Host the files together on HTTPS (or use localhost for development). Open the site in a supported browser while online first so the app shell can be cached.

- **iPhone or iPad:** Open the site in Safari, tap Share, then **Add to Home Screen**.
- **Android:** Open the site in Chrome or another PWA-capable browser, then choose **Install app** or **Add to Home screen** from its menu.
- **Desktop:** In a supported browser such as Chrome or Edge, use the install icon in the address bar or the browser menu.

Installation options and availability vary by browser and device. Once loaded online, the app interface can reopen offline, but YouTube playback, streamed music, and other online services require an internet connection. When deploying updates, increment the cache version in `service-worker.js` to refresh the offline shell.

## Background playback

Songs keep playing when you switch apps or lock the screen, like a music app. Every song — local files and YouTube songs — plays through one native audio element, which phones allow to continue in the background. Lock-screen, notification, and headset controls can play, pause, skip, and seek where supported. Previous restarts the current song if it has played for more than 3 seconds.

- **YouTube songs** are played as audio-only streams, found through public Piped/Invidious servers (configured in `youtube-stream.js`). The Now Playing screen shows **YouTube • Background Audio** when this works.
- **Gapless queue in the background:** while a song plays, the next YouTube song's stream is looked up in advance (including the next shuffle pick), so the next song starts instantly when the current one ends — the app never goes silent between songs, which is when phones usually stop background audio.
- **Automatic recovery:** an expired or broken stream link is refreshed once; a song that still cannot play (or a local file in an unsupported format) is skipped instead of leaving the player stuck.
- **Video mode fallback:** if no stream server answers, the song plays in the embedded YouTube player and the screen shows **YouTube Video • Keep App Open**. Phones pause that player in the background, so these songs only play while the app is visible. Removed or embed-blocked videos are skipped.
- The optional visualizer and click sounds are suspended while the app is hidden and restored when you return; they never control the music.

Keep the tab or installed app running: closing it, force-quitting it, or the operating system terminating it stops playback. On Android, if playback stops in the background, allow the browser or installed app to run in the background and turn off battery optimization for it. On iPhone, start the first song with a tap; after that, songs continue on their own.

**Privacy and reliability:** looking up a stream sends the YouTube video ID to the public Piped/Invidious servers listed in `youtube-stream.js`, and audio is streamed through them. These are third-party services that can be slow or offline; edit `DEFAULT_SOURCES` to use instances you trust or host yourself. Streaming YouTube audio outside the official player may conflict with YouTube's Terms of Service.

## Development

Serve the folder over HTTP (for example `python3 -m http.server 8000`) and open `http://localhost:8000`. Run the tests with Node 18+:

```sh
node --test tests/*.cjs
```

## Search Music (plays in the background)

Choose **Search Music** from the main menu (or **Music**) to add songs from sites that stream plain audio, which keeps playing when you switch apps or lock the screen:

- **Search Audius / Audius Trending** — free streaming music from [Audius](https://audius.co).
- **Internet Archive** — free and public-domain albums and live shows from [archive.org](https://archive.org). Pick an album, then a song or **Add All**.
- **Internet Radio** — live stations from [Radio Browser](https://www.radio-browser.info). Leave the search blank for top stations. Only secure (https) stations are listed.
- **Add Audio Link** — paste direct `.mp3`/`.m4a`/`.ogg` links, or `archive.org/details/…` and `audius.co/…` pages.

Use the wheel to scroll results and the center button to play a song (it opens Now Playing). **Add All** queues every result without interrupting what's playing. Songs added this way are saved on this device like YouTube songs (in the same order) and can be removed with **Delete Songs**. Searching sends your search text to the chosen site, and audio streams directly from it. Some stations or links may be offline; songs that can't play are skipped.

## Saved YouTube songs

YouTube song IDs, titles, and artists are saved on this device when added and restored when the app reopens. Deleting a YouTube song also removes it from the saved list. The app does not download YouTube audio or video: an internet connection is still required for playback. Local files are not saved and need to be added again after reopening. Storage is separate for different devices and may also be separate between a browser and an installed app, depending on the platform. Clearing site data, uninstalling the app, private browsing, or disabled/full storage can remove or prevent saved entries. If the screen says **Save failed** or **Library unavailable**, the list could not be saved or read; check the browser's storage settings and free space.

## Removing songs

Choose **Music → Delete Songs**, select a song, and confirm **Delete Song** using the click wheel or by tapping the screen. Removing the current song stops playback; other songs stay in the queue. For YouTube songs, this also removes the saved entry. It does not delete the original local file or YouTube video.
