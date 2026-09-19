# Changelog

## 0.9.0

- Added optional energy pricing with separate import and export tariffs.
- Added three pricing modes: fixed tariffs, Home Assistant price entities and dynamic-contract presets.
- Added provider/source presets for Frank Energie, Zonneplan, Tibber, ANWB Energy, NextEnergy, Nord Pool and Other.
- Kept supplier access local to Home Assistant: presets never call supplier APIs directly.
- Added current import/export prices to the card when pricing is enabled.
- Added current grid cost or export revenue per hour to the Grid detail popup.
- Added price-unit normalization for common currency/kWh and cents/kWh sensors.
- Updated Demo mode with example fixed tariffs (EUR 0.31/kWh import and EUR 0.09/kWh export).
- Added pricing configuration and calculation tests.
- Updated the runtime version to **0.9.0**.

## 0.8.3

- Standardized the public README and changelog to English for a consistent HACS/GitHub project experience.
- Rewrote all historical Dutch release notes in English without changing their technical meaning.
- Updated package metadata and the runtime version banner to **0.8.3**.
- Kept all existing v0.8.2 configuration compatible; no migration is required.

## 0.8.2

- Added optional device groups. A group can be displayed as one combined node or keep its members visible individually.
- Group power is summed live from the underlying devices; the popup lists each individual member.
- Group history uses the same bundled 24-hour history engine as regular nodes.
- Replaced the free-form icon field with a dropdown of common presets plus a **Custom…** `mdi:` option.
- Changed the default Backup icon from a shield/lightning symbol to a generator/alternator-style symbol.
- Placed backup consumers in a compact grid of up to three columns instead of one long vertical stack.
- Added Dutch and English translations for groups and the icon selector.
- Added regression tests for groups, group power and the backup grid.

## 0.8.1

- Removed the fixed minimum card height so the Flow layout now truly follows its content.
- Reduced the maximum top and bottom margin around nodes.
- Gave backup branches their own column so connections no longer pass through regular consumers.
- Initially stacked devices behind a backup vertically.
- Preserved the v0.8 wrapping of up to five regular consumers per row.

## 0.8.0

- Added adaptive sizing to the default Flow layout.
- Removed fixed Flow canvas heights; the card now fits the actual nodes with bounded top/bottom margins.
- Added automatic multi-row wrapping for large numbers of consumers, with a maximum of five slots per row.
- Kept backup nodes and their downstream consumers together as layout clusters.
- Updated Flow layout labels in Dutch and English.
- Added regression tests for compact height, wrapping and backup clusters.

## 0.7.5

- Started the bundled 24-hour history load immediately in the background when the card becomes visible instead of waiting for a delay.
- Prevented frequent Home Assistant `hass` state updates from cancelling and restarting the preload timer.
- Restored valid `sessionStorage` graph data for all nodes immediately when the card loads.
- Preserved the bundled history request, five-minute cache, 96-point graphs and calculated Home history.
- Expanded the README with a release overview starting at v0.7.0.
- Updated the version to **0.7.5**.

## 0.7.4

- Replaced individual node history requests with one bundled Home Assistant history request.
- Recalculated all nodes on the same 96 historical timestamps using the same flow logic as the live card.
- Added a real 24-hour **Home** graph even when Home has no dedicated power sensor, reconstructed from historical energy flows.
- Added historical support for unmeasured backup nodes and batteries with separate charge/discharge sensors.
- Added peak power, peak time and average power to detail popups when history is available.
- Preserved the memory and `sessionStorage` cache so all node graphs open immediately after the first bundled load.
- Updated the version to **0.7.4**.

## 0.7.3

- Improved 24-hour graph loading using more compact Home Assistant history requests with `significant_changes_only`.
- Cached graph data for five minutes in memory and in `sessionStorage` so reopening and navigating back are effectively instant.
- Merged duplicate concurrent history requests for the same node.
- Preloaded up to eight commonly used power graphs after card load with a maximum of two concurrent requests.
- Reduced graph rendering data to 96 points over 24 hours.
- Added history-query and bucketization tests.
- Fixed the GitHub release workflow so repositories without a `package-lock.json` can still build on tag releases.
- Updated the version to **0.7.3**.

## 0.7.2

- Increased the default card/grid space and maximum flow width.
- Moved the detail popup to a responsive viewport overlay above Home Assistant so it is not clipped when many advanced values are configured.
- Added a responsive maximum popup height with scrolling on desktop and mobile.
- Made the language explicitly follow each user's active Home Assistant frontend language using `hass.locale.language` with `hass.language` as fallback.
- Applied Dutch and English translations across the card, editor, statuses, popup, graph and field names.
- Added a HACS-ready repository structure with README, LICENSE, `hacs.json` and GitHub Actions release workflow.
- Updated the version to **0.7.2**.

## 0.7.1

- Renamed the default energy-flow view to **Flow** and removed product/brand comparisons from the interface and documentation.
- Kept old v0.7.0 layout values compatible by treating them internally as **Flow**.
- Added consumer-oriented advanced measurements: voltage, current, consumed today and total consumed.
- Added the same consumption fields for EV chargers, heat pumps, boilers, air conditioning and backup devices.
- Kept extra measurements out of the main diagram and showed them only in the detail popup.
- Kept solar/producer energy fields labelled as production.
- Updated the version to **0.7.1**.

## 0.7.0

- Introduced the **Flow** layout as the default view: production above, grid left, storage right and consumers below Home.
- Replaced unstable datalists with Home Assistant `ha-entity-picker` controls for power and sensor fields.
- Committed device names only after text editing is completed so full names are preserved.
- Added an optional dedicated Home power sensor (`home_power_entity`) with automatic Home calculation as fallback.
- Prevented isolated unknown source/device readings from invalidating the entire calculated Home value while useful energy flows remain.
- Made nodes more compact and flow lines clearer in Flow mode.
- Kept the existing `circle` and `straight` layouts available.
- Updated the version to **0.7.0**.
