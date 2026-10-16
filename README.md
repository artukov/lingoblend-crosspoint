# LingoBlend plugins for CrossPoint Reader

Two [CrossPoint](https://crosspointreader.com) SD plugins for
[LingoBlend](https://lingoblend.app). They give an e-reader **blended books**:
a book in a language you already read, with a share of its words swapped into
the language you are learning, plus a companion StarDict dictionary so looking
a word up shows the word it replaced.

| Plugin | What it does |
|---|---|
| [`lingoblend`](lingoblend/) | Your blended books, downloaded to the device, and words you **Clip** while reading synced back into the LingoBlend app. Needs an account. |
| [`lingoblend-dict`](lingoblend-dict/) | Companion dictionaries, plus a free library of pre-blended classics. **No account needed.** |

## Install

Add this catalog URL as a store in the
[Plugin Store](https://github.com/itsthisjustin/sd-plugins/tree/main/plugin-store)
plugin:

```
https://raw.githubusercontent.com/artukov/lingoblend-crosspoint/main/catalog.json
```

Or copy a plugin folder to `/plugins/<name>/` on the SD card.

Plugins need **CrossPoint 1.7** or a Nightly build. Dictionary lookup alone
works on 1.6.0+ — see [lingoblend.app/crosspoint](https://www.lingoblend.app/crosspoint)
for the USB route and the full walkthrough.

## Why this repo exists

These files are also served from `lingoblend.app`, but that host sits behind a
CDN that challenges non-browser clients when it sees unusual traffic from an
address. A reader cannot solve a JavaScript challenge, so an install from a
flagged address fails with `relay 502` and no useful explanation. GitHub's raw
host does not challenge machines, which is why every other plugin in the
CrossPoint ecosystem is served from it.

## Generated, not hand-edited

These files are built by `crosspoint-plugin/build.mjs` in the LingoBlend
repository. Edit them there.
