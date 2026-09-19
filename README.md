# Energy Flow Card

A custom Home Assistant Lovelace card for visualising live energy flows between the grid, solar, battery, home and individual consumers.

## Features

- Live animated energy flows
- Flow, round and straight layouts
- Optional home power sensor or automatic home calculation
- Detail popup with 24-hour graph and extra measurements
- Home Assistant entity pickers in the visual editor
- Dutch and English UI, following the active Home Assistant frontend language
- Demo mode for testing without sensors

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
