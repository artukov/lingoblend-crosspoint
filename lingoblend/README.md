# LingoBlend

Your blended books on the reader, and the words you clip while reading them
back in your LingoBlend dictionary and practice.

## Sign in

**Plugins → LingoBlend → Sign in.** The reader shows a QR code and an
eight-character code. Scan the QR with your phone, sign in to LingoBlend, and
approve. The reader is then paired to your account.

You can see and remove paired readers at
[lingoblend.app/reader](https://www.lingoblend.app/reader).

## Books

**Plugins → LingoBlend** lists the books you have blended. Downloads land in
`/LingoBlend` on the card.

Get the matching dictionary from the **LingoBlend Dictionaries** plugin, then
select it in **Settings → Reader → Dictionary**, and looking a word up shows
the word it replaced.

## Saving words

While reading, press and hold a word and choose **Clip**. It is saved to the
card instantly — no network, nothing to wait for.

To send clipped words to your account: **Home → File Transfer → Join a
Network**, pick your WiFi, and open the address it shows in a browser on the
same network. Then **☰ → File Manager → LingoBlend → Sync clippings**.

Not *Create Hotspot* — the reader becomes its own network and cannot reach us.
Not *USB Drive* — it serves no web page, so there is no card to press.

Words you clipped from a blended book are matched to what they replaced;
anything else is translated. Passages longer than a few words are skipped.

Syncing twice is safe — nothing is saved twice.

## What is sent

Only the new part of `/My Clippings.txt`: the words you clipped, the book they
came from, and the page. Clipped text is never displayed in the File Transfer
page itself.

## Requirements

CrossPoint **1.7 or newer** (or a Nightly build) for plugins and clipping.
Dictionary lookup alone works on 1.6.0+.
