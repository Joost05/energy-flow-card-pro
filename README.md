# Energy Flow Card

A custom Home Assistant Lovelace card for visualising live energy flows between the grid, solar, battery, home and individual consumers.

## Features

- Live animated energy flows
- Flow, round and straight layouts
- Optional home power sensor or automatic home calculation with reconstructed 24-hour history
- Detail popup with 24-hour graph, peak/average power and extra measurements
- Home Assistant entity pickers in the visual editor
- Dutch and English UI, following the active Home Assistant frontend language
- Light and dark theme support through Home Assistant theme variables
- Responsive layout for desktop, tablet and mobile
- Demo mode for testing without sensors

## Version history

### v0.8.0
- Adaptive Flow layout that sizes the card to its actual contents.
- Maximum outer spacing above and below the nodes, removing large empty areas.
- Smart wrapping: large sets of consumers are automatically split over multiple rows.
- Backup clusters stay together with their downstream devices.
- Flow layout remains responsive on desktop, tablet and mobile.

### v0.7.5

- 24-hour history preload now starts immediately in the background when the card becomes visible.
- Frequent Home Assistant state updates no longer cancel and restart the preload timer, preventing history loading from being postponed indefinitely.
- Valid session-cached graphs for all nodes are restored as soon as the card loads, so dashboard navigation and refreshes can show graphs immediately.
- The existing five-minute memory/session cache and bundled history request remain in place.

### v0.7.4

- Replaced separate node history requests with one bundled Home Assistant history request.
- Reconstructs all node values on one shared 96-point timeline.
- Added a calculated 24-hour history graph for **Home**, even when Home has no dedicated power sensor.
- Added peak power, peak time and average power to the detail popup.

### v0.7.3

- Added five-minute memory and `sessionStorage` caching for graphs.
- Added compact history requests and reduced graph data to 96 points over 24 hours.
- Prevented duplicate concurrent history requests.
- Improved the GitHub release workflow.

### v0.7.2

- Made the card and flow area more spacious.
- Moved the detail popup to a responsive viewport overlay so long popups are no longer clipped by the card.
- Added automatic Dutch/English UI based on the active Home Assistant user language.
- Added the HACS-ready repository structure, license and GitHub release workflow.

### v0.7.1

- Renamed the main layout to the generic **Flow** name.
- Added consumer-oriented advanced measurements: voltage, current, consumed today and total consumed.
- Kept advanced measurements out of the main diagram and inside the node detail popup.

### v0.7.0

- Introduced the Flow layout with production above, grid left, storage right and consumers below Home.
- Replaced unstable datalists with Home Assistant entity pickers.
- Fixed name fields losing text while typing.
- Added optional measured Home power with automatic Home calculation as fallback.
- Improved handling of unknown/unavailable sensors and compacted the node presentation.

For the full technical list, see [`CHANGELOG.md`](CHANGELOG.md).

## HACS installation

Until this repository is added to the HACS default store, add it as a custom repository:

1. Open HACS in Home Assistant.
2. Open **Custom repositories**.
3. Add the repository URL.
4. Select **Dashboard** as category.
5. Install **Energy Flow Card**.
6. Reload the browser if Home Assistant asks you to.

For private development repositories, install the built file manually until the repository is publicly accessible to HACS.

## Manual installation

Copy `dist/energy-flow-card.js` to:

```text
/config/www/energy-flow-card/energy-flow-card.js
```

Add this dashboard resource as a JavaScript module:

```text
/local/energy-flow-card/energy-flow-card.js
```

Then add the card:

```yaml
type: custom:energy-flow-card
```

## Development

```bash
npm install
npm run check
```

The production bundle is written to `dist/energy-flow-card.js`.

## License

MIT
