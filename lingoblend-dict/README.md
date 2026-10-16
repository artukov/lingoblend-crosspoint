# LingoBlend Dictionaries

Companion dictionaries for [LingoBlend](https://www.lingoblend.app) blended books.

A LingoBlend book has a share of its words swapped into the language you are
learning. This plugin downloads the matching dictionary, so when you look one of
those words up the reader shows the word it replaced — turning the built-in
dictionary into tap-to-translate for exactly the words in front of you.

## Use it

1. Install this plugin.
2. **Plugins → LingoBlend Dictionaries**, pick the dictionary for your book, download.
3. **Settings → Reader → Dictionary**, select it.
4. Get the matching book from the LingoBlend OPDS catalog
   (**Settings → System → OPDS Servers**, add `https://www.lingoblend.app/opds/root.xml`)
   and choose the **underlined** edition.
5. Look a word up the way you normally would.

One dictionary is active at a time, so while a LingoBlend dictionary is selected
an ordinary English word returns "not found". Switch back in Settings when you
are done with the book.

## Without the plugin

Every dictionary is also a plain download at
[lingoblend.app/crosspoint](https://www.lingoblend.app/crosspoint) — unzip it
into `/dictionaries` on the SD card and it behaves identically. Dictionaries
cannot travel over OPDS, which is the only reason this plugin exists.

## Which edition to read

The catalog offers three editions of each book:

- **underlined** — the blended word is underlined and says nothing until you
  look it up. This is the one the dictionary is for.
- **glosses above** — the original word is printed above each blended word, so
  you need no dictionary at all.
- **linked** — each blended word jumps to a glossary at the end of the chapter.

## Requirements

CrossPoint **1.7 or newer** for the plugin itself. The dictionaries work on
**1.6.0+**, where dictionary lookup shipped — on those builds use the plain
download above instead.
