# Real or Onion?

A static headline guessing game. Each round shows one headline. You guess whether it came from a real publication or from The Onion, then the game reveals the answer and links to the source. A run is 20 headlines in random order, and the game tracks your accuracy.

## Run it

Open `index.html` in a browser, or serve the folder from any static host. There is no build step and no dependencies.

## Data schema

Headlines live in `data/headlines.js`, which assigns `window.HEADLINES`.

| Field | Applies to | Required | Rule |
| --- | --- | --- | --- |
| `id` | all | yes | unique non-empty string |
| `type` | all | yes | `"real"` or `"onion"` |
| `displayHeadline` | all | yes | text shown while guessing |
| `originalHeadline` | real | yes | headline exactly as published; equals `displayHeadline` when unmodified |
| `wasModified` | real | yes | `true` only if the two headline fields differ |
| `publisher` | all | yes | `"The Onion"` for Onion entries |
| `url` | all | yes | absolute `http(s)` URL |
| `placeholder` | any | no | boolean, only for placeholder entries |

Unknown extra fields are ignored.

## Add headlines

Append one object to the array in `data/headlines.js`. No other file needs editing.

```js
// Real, unmodified
{ id: "r-200", type: "real", displayHeadline: "Example headline",
  originalHeadline: "Example headline", wasModified: false,
  publisher: "Reuters", url: "https://example.com/a" },

// Real, modified to sound more Onion-like
{ id: "r-201", type: "real", displayHeadline: "Tweaked Headline Shown To Player",
  originalHeadline: "Headline as published", wasModified: true,
  publisher: "AP", url: "https://example.com/b" },

// Onion
{ id: "o-200", type: "onion", displayHeadline: "Onion Headline",
  publisher: "The Onion", url: "https://theonion.com/example/" },
```

## Validate

```
node scripts/validate.mjs
```

Checks every rule above, prints a summary, and exits with code 1 on any error. It makes no network requests.

## Change the run length

Edit `const RUN_LENGTH = 20;` at the top of `game.js`. If you change it, update the same constant in `scripts/validate.mjs` so its warning stays accurate.

## Icon and share thumbnail

`favicon.svg` is the browser tab icon (an onion). `apple-touch-icon.png` is the home-screen icon, and `og-image.png` is the 1200x630 thumbnail shown when the link is shared. The editable source for the thumbnail is `assets/og-image.svg`.

Most chat and social apps only show the thumbnail if `og:image` and `twitter:image` in `index.html` are absolute URLs. Once you know where the game is hosted, change `content="og-image.png"` to something like `content="https://your-site.example/og-image.png"`.

## Notes

Lifetime stats and the player's chosen theme and appearance are stored in `localStorage` under `realOrOnion:v1`. The game works without storage. Resetting stats keeps the theme. Forest is the default theme.

Themes are defined in `styles.css` as `[data-theme="name"]` blocks using `light-dark()`. To add one, add a block there and an entry to the `THEMES` list at the top of `game.js`. Headlines are shown for commentary and game purposes and always link to the original publisher.
