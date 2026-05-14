# Quill Modules Integration (Invite & DocumentEdit)

## Purpose
Provide a single source-of-truth for all Quill plugins used in the platform, with per-screen configuration and lazy-loading via ESM CDNs.

## Installation / Module Setup
This setup relies on direct ESM module imports from jsdelivr, avoiding the need for `npm install` on your local machine. All plugin files, styles, and logic are pulled at runtime when the specific screens trigger them.

## Where Modules Are Loaded
See `static/js/quill-modules.js`. The modules map is built asynchronously.

### Per-screen activation
`getQuillModules('invite')` → loads: `emoji`, `placeholder`, `placeholderAutocomplete`, `autoformat`, `focus`, `magicUrl`, `pasteSmart`.  
`getQuillModules('documentedit')` → loads: `betterTable`, `blotFormatter`, `imageCompress`, `imageUrlDrop`, `markdownShortcuts`, `markdownToolbar`, `tableUI`, plus the common ones.

## How to enable / disable a module
Edit `static/js/quill-modules.js`. Comment out the line you wish to disable, e.g.:

```js
// const { default: Emoji } = await import('https://cdn.jsdelivr.net/npm/quill-emoji/+esm'); // ← disabled
```

The change takes effect on the next page load (no code rebuild needed).

## Adding a new plugin
1. Add an `import()` line inside the appropriate `if (screen === ...)` block in `static/js/quill-modules.js` using `https://cdn.jsdelivr.net/npm/<package>/+esm`.
2. Register it via `Quill.register(name, module, true)`.
3. Add the corresponding CSS link in `templates/invite.html` or `templates/documentedit.html`.
4. (Optional) Add a toolbar button entry to `toolbarOptions` in the screen's JS file.

## Known Conflicts
| Modules | Conflict | Fix |
|---------|----------|-----|
| `blotFormatter` + `imageCompress` | Duplicate image-handler listeners | Register `blotFormatter` **first**. (Already resolved in sequence). |
| `betterTable` + `tableUI` | Two table toolbars | Keep `betterTable` for data model, `tableUI` for floating UI. |

## Debugging Tips
* Open the browser console and type `Quill.imports` – you should see all registered module names.  
* If a toolbar button is missing, verify that the module's name matches the key in the `modules` object passed to Quill.  
* Watch the network tab for `+esm` requests to see when the plugins are pulled dynamically.

---  

*Last updated:* 2026-04-17  
*Author:* Antigravity (Senior Front-end Architect)
