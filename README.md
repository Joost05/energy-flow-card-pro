# Energy Flow Card

A custom Home Assistant Lovelace card for visualizing live energy flows between the grid, solar, batteries, home, backup supply, device groups and individual consumers.

## Features

- Live animated energy flows
- Flow, round and straight layouts
- Adaptive Flow layout that sizes itself to the actual content
- Automatic multi-row wrapping for larger installations
- Compact backup-device grids
- Optional device groups with summed live power or individual display
- Group detail popups with member values and 24-hour history
- Icon dropdown with common MDI presets plus a custom `mdi:` option
- Optional Home power sensor or automatic Home calculation with reconstructed 24-hour history
- Detail popup with 24-hour graph, peak power, peak time, average power and extra measurements
- Background history preloading and caching for fast popup graphs
- Home Assistant entity pickers in the visual editor
- Dutch and English UI, following the active Home Assistant frontend language
- Light and dark theme support through Home Assistant theme variables
- Responsive layout for desktop, tablet and mobile
- Demo mode for testing without sensors

## Version history

### v0.8.3

- Standardized the public project documentation to English.
- Reworked the README so HACS/GitHub users get one consistent installation and feature reference.
- Converted all previously Dutch release notes in `CHANGELOG.md` to English.
- Kept the Home Assistant card UI bilingual; Dutch and English still follow each user's frontend language automatically.
- No configuration migration is required from v0.8.2.

### v0.8.2

- Added optional device groups. Multiple devices can be combined into one node with summed live power, or shown individually.
- Group popups list each member's live power and use the same 24-hour history engine as regular nodes.
- Added an icon dropdown with common Home Assistant/MDI presets and a **Custom…** option for any other `mdi:` icon.
- Replaced the old shield-style Backup glyph with a generator/alternator-style default icon.
- Backup consumers now use a compact responsive grid of up to three columns instead of one long vertical stack.
- Added Dutch and English translations for groups and the icon selector.

### v0.8.1

- Removed the fixed minimum card height so the Flow layout truly follows its content.
- Reduced the maximum top and bottom spacing around nodes.
- Moved backup branches into their own column so their connections do not pass through normal consumers.
- Kept the regular-consumer wrapping introduced in v0.8.0.

### v0.8.0

- Added adaptive sizing to the default Flow layout.
- Removed fixed Flow canvas heights; the card now fits the actual nodes with bounded top/bottom margins.
- Added automatic multi-row wrapping for large numbers of consumers, with a maximum of five slots per row.
- Kept backup nodes and their downstream devices together as layout clusters.
- Added regression tests for compact height, wrapping and backup clusters.

### v0.7.5

- Started the bundled 24-hour history preload immediately in the background when the card becomes visible.
- Prevented frequent Home Assistant state updates from repeatedly postponing history preloading.
- Restored valid session-cached graphs for all nodes as soon as the card loads.
- Kept the bundled history request, five-minute cache, 96-point graphs and calculated Home history.

### v0.7.4

- Replaced separate node history requests with one bundled Home Assistant history request.
- Reconstructed all node values on one shared 96-point timeline.
- Added a calculated 24-hour history graph for **Home**, even without a dedicated Home power sensor.
- Added peak power, peak time and average power to detail popups.

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

For the full technical release history, see [`CHANGELOG.md`](CHANGELOG.md).

## HACS installation

Until this repository is added to the HACS default store, add it as a custom repository:

1. Open HACS in Home Assistant.
2. Open **Custom repositories**.
3. Add the GitHub repository URL.
4. Select **Dashboard** as the category.
5. Install **Energy Flow Card**.
6. Reload the browser if Home Assistant asks you to.

For a private development repository, install the built file manually until the repository is publicly accessible to HACS.

## Manual installation

Copy `dist/energy-flow-card.js` to:

```text
/config/www/energy-flow-card/energy-flow-card.js
```

Add the following dashboard resource as a JavaScript module:

```text
/local/energy-flow-card/energy-flow-card.js
```

Then add the card:

```yaml
type: custom:energy-flow-card
```

## Optional device groups

Groups do not replace the underlying devices. They only change how those devices are presented.

Use `display: grouped` to show one combined node, or `display: individual` to keep all group members visible separately.

```yaml
type: custom:energy-flow-card
nodes:
  - id: heat_pump_1
    name: Heat pump 1
    type: heat_pump
    power_entity: sensor.heat_pump_1_power
  - id: heat_pump_2
    name: Heat pump 2
    type: heat_pump
    power_entity: sensor.heat_pump_2_power
groups:
  - id: heat_pumps
    name: Heat pumps
    icon: mdi:heat-pump
    display: grouped
    members:
      - heat_pump_1
      - heat_pump_2
```

The grouped node shows the summed live power. Opening the group popup shows the individual member values and the combined history.

## Icons

The visual editor provides a dropdown with common icons for solar, batteries, heat pumps, air conditioning, EV charging, appliances, computers, servers, lighting, pumps, sockets, backup power and more.

Choose **Custom…** to enter any supported Material Design Icons value, for example:

```text
mdi:coffee-maker
```

## Languages

The card automatically follows the active Home Assistant frontend language for each user.

Currently supported:

- English
- Dutch

Device names entered by the user are never translated automatically.

## Development

```bash
npm install
npm run check
```

The production bundle is written to `dist/energy-flow-card.js`.

## License

MIT
