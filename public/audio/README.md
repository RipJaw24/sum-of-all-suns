# Menu music

Drop the sourced menu-music track here as `menu.ogg`.

`src/game/audio.ts` plays it on the title screen with the plain `loop` flag
(the track loops gaplessly) starting on the first user gesture, per browser
autoplay policy. If the file is missing the game stays silent — no error.
