# Changelog

## [1.0.0] - 2026-09-20

### Added

- Reworked the public README for the upcoming 1.0 release.
- Added a full configuration reference in `docs/configuration.md`.
- Added troubleshooting guidance for HACS, caching, history/replay, pricing, diagnostics and hierarchical consumers.
- Added migration guidance for the v0.17 technical rename and manual-to-HACS installations.
- Added a maintainer release guide and 1.0 release checklist.
- Added cropped documentation screenshots and wired them into the README and docs pages.

### Changed
- Preserved the currently inspected graph timestamp across live Home Assistant state updates, so hover/touch/click inspection no longer disappears when wattage changes.
- Desktop hover remains transient when the pointer leaves the graph; clicked/touch-selected points remain pinned until changed, cleared or the popup is closed.
- Finalized the public 1.0 documentation and screenshot set.

## [0.18.0] - 2026-09-20

### Added
- Added a descendant-count badge to parent consumer nodes so the main card shows when more devices are hidden behind a branch.
- Added recursive diagnostic propagation: warnings/errors on child devices now surface as a branch warning on their consumer ancestors and Home.
- Parent diagnostic popups list the affected descendant devices.

### Changed
- Mobile focus now opens the complete descendant subtree of a branch instead of only its direct children.
- Nested parents inside that focused tree can still be tapped to focus further, while leaf devices keep opening their normal detail popup.
- Updated runtime/package version to **0.18.0**.

## [0.17.0] - 2026-09-20

### Changed
- Renamed the production bundle from `energy-flow-card.js` to `energy-flow-card-pro.js`.
- Renamed the Lovelace card type from `custom:energy-flow-card` to `custom:energy-flow-card-pro`.
- Renamed the editor custom element to `energy-flow-card-pro-editor`.
- Updated HACS metadata and the GitHub release workflow to publish `energy-flow-card-pro.js`.
- Updated manual-install paths, examples and migration guidance.
- This is an intentional one-time breaking technical rename before the public 1.0 release, to keep the project name unambiguous.

## [0.16.0] - 2026-09-20

### Added
- Added an automatic compact mobile focus view below 700 px: Home shows only its direct branches, and branches with children can be opened one level at a time.
- Added breadcrumb/back navigation for nested consumer and backup branches on phones and narrow tablets.
- Added regression tests for mobile focus graph filtering.

### Changed
- Fixed graph inspection on phones and tablets by using pointer capture while dragging; the marker and tooltip now continuously follow the finger.
- Prevented page scrolling from stealing an active graph drag gesture.
- Made the replay control more compact: Live mode shows `Replay + slider`; historical mode shows `time + slider + Live` on one row.
- Desktop keeps the full energy tree; the mobile focus view does not change calculations, history, replay or diagnostics.

## [0.15.2] - 2026-09-19

### Changed
- Replaced the cramped color dropdown grid with a responsive swatch palette per energy type.
- Color choices are now limited to a curated fixed palette plus each type's default color.
- Existing custom colors from 0.15.0/0.15.1 remain readable for backwards compatibility, but the editor no longer offers arbitrary color entry.
- Improved the color editor layout on narrow Home Assistant editor panels.


## 0.15.1

- Fixed the Live replay scrubber so the slider uses the full available card width instead of collapsing into a short segment.
- Kept the compact historical replay layout: timestamp and **Live** button only appear while replay is active, with **Live** at the far right of the slider.
- Replaced unrestricted browser color pickers with a curated palette of 17 readable preset colors plus each category's default color.
- Preserved existing custom CSS colors from 0.15.0/YAML for backwards compatibility; the editor shows them as an existing custom color until a preset or Default is selected.
- Updated editor help text and runtime/package version to **0.15.1**.

## 0.15.0

- Added configurable colors for Solar, Grid, Battery, Home, Consumers, EV chargers, Backup, Generator and Producer nodes.
- Added color pickers to the visual editor under Preview, plus one-click restoration of the default palette.
- Reworked historical replay into a much smaller single-row scrubber.
- The **Live** button now appears only while viewing historical data, at the far right of the replay row, and disappears again after returning to Live.
- Removed the always-visible replay hint/button chrome to give more space back to the energy diagram.
- Coalesced rapid Home Assistant state updates into one render per animation frame, reducing unnecessary redraw work on busy dashboards.
- Preserved existing CSS variables and YAML compatibility; cards without `colors:` keep the current default palette.
- Added regression tests for color configuration.
- Updated runtime/package version to **0.15.0**.

## 0.14.0

- Added hierarchical consumer branches: a consumer can now be connected behind another consumer, not only behind Home or Backup.
- Added multi-level chains, for example `Home → Desk smart plug → Computer → Monitor`.
- The parent power remains the measured branch total while child devices are shown as a breakdown, preventing double counting at Home.
- Added cycle detection so invalid parent loops such as `A → B → A` are rejected.
- Updated Flow, Straight and Round layouts to place child consumers relative to their parent.
- Preserved compact Backup branches with a maximum of three direct children per row in Flow layout.
- Updated live diagnostics so child consumers are not counted twice in Home unmetered-consumption calculations.
- Updated Demo mode with a Desk branch and synchronized parent/child example power values.
- The visual editor now offers Home, Backup and other eligible consumers in **Connected to**, while hiding choices that would create loops.
- Grouped display rejects parent consumers that still have downstream children, avoiding ambiguous/double-counted group totals.
- Added regression tests for hierarchy validation, flow direction and nested layouts.
- Updated runtime/package version to **0.14.0**.

## 0.13.0

- Added a dedicated **Energy & costs** section to the Home popup.
- Added period switching for **Today**, **This week** and **This month**.
- Added period totals for Home consumption, Grid import/export and solar production when the required cumulative energy sensors are configured.
- Added import cost, feed-in revenue and signed net cost for each period.
- Dynamic Home Assistant price entities use their historical price changes when calculating period costs.
- Added self-consumption and self-sufficiency percentages when enough energy counters are available.
- The statistics are cached for five minutes and loaded only when Home details are opened.
- Demo mode includes sample period statistics for testing without real sensors.
- Added Dutch and English labels and regression tests for energy statistics.
- Updated runtime/package version to **0.13.0**.

## 0.12.1

- Fixed Demo replay showing **Not enough history for replay** even though demo history was available.
- Demo history is now generated as one synchronized 24-hour bundle for all visible nodes.
- Demo replay history is preloaded as soon as the card is connected, so the scrubber is ready immediately.
- Reused the synchronized demo bundle for popup history to keep replay and detail graphs on the same timeline.
- Updated runtime/package version to **0.12.1**.

## 0.12.0

- Added historical replay for the complete energy-flow diagram.
- Added a 24-hour scrubber below the card to inspect earlier energy-flow states.
- Nodes and connection directions/power update to the selected historical timestamp.
- Added a one-click return to Live mode.
- Replay reuses the existing bundled history cache and therefore does not add per-node API calls.
- Popup values identify the selected replay time and hide live-only pricing/advanced values while replay is active.
- Demo mode now supports replay as well.
- Added Dutch and English replay labels.
- Added replay helper tests.

## 0.11.0

- Added live diagnostics to every node popup.
- Added sensor-health checks for missing, unavailable, unknown and stale primary power sensors.
- Added a small warning badge on nodes only when an actual warning or error is detected.
- Added Home energy-balance diagnostics when an independent Home power sensor is configured.
- Added **Other / unmetered consumption** to the Home diagnostics, based on Home load minus configured consumer loads.
- Added a warning when the sum of metered consumer devices exceeds Home by more than the built-in tolerance.
- Diagnostics remain informational and do not attempt phase-imbalance or electrical-fault classification.
- Demo mode also exposes the diagnostics section so the feature can be previewed without real sensors.
- Updated runtime/package version to **0.11.0**.

## 0.10.2

- Made all 24-hour graphs interactive: hover on desktop or tap/drag on touch devices to inspect the power at a specific time.
- Added a vertical graph marker and compact time/value tooltip.
- The three-phase graph now shows L1, L2, L3 and the summed total at the selected time.
- Tapped graph values remain pinned until another point is selected; keyboard left/right inspection is also supported.
- Changed **Revenue today** to a signed daily grid financial result: export revenue minus import cost, so it can become negative when no or insufficient energy was exported.
- Daily financial calculation supports both fixed tariffs and Home Assistant price entities.
- Updated runtime/package version to **0.10.2**.

## 0.10.1

- Added automatic L1 power calculation for meters that expose total grid power plus L2 and L3 but no separate L1 entity (for example some HomeWizard P1 setups).
- L1 is calculated as `total - L2 - L3` for both live values and the 24-hour phase graph.
- Added a clear editor hint that L1 may be left empty when this fallback can be used.
- The grid popup labels the fallback value as **L1 power (calculated)**.
- Updated runtime/package version to **0.10.1**.

## 0.10.0

- Added optional L1/L2/L3 power, voltage and current entities to Grid advanced configuration.
- Added a **Show phases** toggle in the Grid popup while keeping total Grid history as the default view.
- Added a shared-scale 24-hour three-line graph for L1/L2/L3 with distinct phase colors and legend.
- Included phase power sensors in the existing bundled background history request.
- Added Demo-mode phase history for testing without real sensors.
- Kept phase analysis intentionally simple: no phase-imbalance calculation or warning logic.
- Added Dutch and English labels for all three-phase fields and controls.
- Updated runtime/package version to **0.10.0**.

## 0.9.2

- Changed public branding to **Energy Flow Card Pro** while retaining the existing `energy-flow-card` custom element and `energy-flow-card.js` resource filename for backward compatibility.
- Reworked the in-card electricity price display into clearly labelled **Import / Export** blocks.
- Added responsive price-panel styling for narrow cards.
- Fixed visual alignment of wizard step numbers and labels.
- Updated HACS/package metadata and documentation for the new branding.

## 0.9.1

- Added a dedicated **Prices** step to the visual editor.
- Removed supplier presets from the card; use Home Assistant price entities from supplier integrations instead.
- Legacy v0.9.0 `dynamic` price configs remain compatible and are migrated to entity pricing internally.
- Reduced price display precision to two decimals and compacted the card badge to one `/kWh` suffix.
- Added **Revenue today** to the Grid popup using the configured export-energy entity and export tariff/history.
- Updated Demo mode with the new price workflow and example daily export revenue.
- Updated runtime version to **0.9.1**.

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
