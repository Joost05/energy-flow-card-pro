/**
 * Alle kleuren zijn CSS-variabelen met een standaardwaarde, zodat thema's ze kunnen
 * overschrijven: --efc-solar, --efc-grid, --efc-battery, --efc-home, --efc-ev,
 * --efc-generator, --efc-producer, --efc-consumer en --efc-node-bg.
 */
export const styles = `
:host { display: block; }

ha-card {
  display: block;
  position: relative;
  overflow: hidden;
  color: var(--primary-text-color, #212121);
}
ha-card.fallback {
  background: var(--ha-card-background, var(--card-background-color, #fff));
  border-radius: var(--ha-card-border-radius, 12px);
  border: 1px solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
  font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
}

.title { padding: 16px 16px 0; font-size: 16px; font-weight: 500; }
.stage { position: relative; padding: 10px 12px 18px; min-height: 0; }
.flow { display: block; width: 100%; max-width: 860px; height: auto; margin: 0 auto; }

.badge {
  position: absolute; top: 10px; left: 12px; z-index: 1;
  padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 500;
  color: var(--secondary-text-color, #727272);
  border: 1px solid var(--divider-color, #e0e0e0);
}

.price-panel {
  position: absolute; top: 10px; right: 12px; z-index: 1;
  display: grid; grid-template-columns: auto 1px auto; align-items: stretch; gap: 9px;
  padding: 6px 10px; border-radius: 12px;
  color: var(--primary-text-color, #212121);
  border: 1px solid var(--divider-color, #e0e0e0);
  background: color-mix(in srgb, var(--card-background-color, #fff) 92%, transparent);
  -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
}
.price-item { display: flex; flex-direction: column; min-width: 68px; gap: 1px; line-height: 1.15; }
.price-label {
  color: var(--secondary-text-color, #727272); font-size: 9px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .035em;
}
.price-value { font-size: 11px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.price-divider { width: 1px; background: var(--divider-color, #e0e0e0); }

@media (max-width: 430px) {
  .price-panel { gap: 7px; padding: 5px 8px; }
  .price-item { min-width: 58px; }
  .price-label { font-size: 8px; }
  .price-value { font-size: 10px; }
}

.empty { padding: 32px 24px; text-align: center; }
.empty strong { display: block; font-size: 15px; margin-bottom: 6px; }
.empty span { color: var(--secondary-text-color, #727272); font-size: 14px; line-height: 1.4; }

/* Kleuren per type */
.type-solar { --c: var(--efc-solar, #f0a202); }
.type-grid { --c: var(--efc-grid, #5a78d1); }
.type-battery { --c: var(--efc-battery, #33b07a); }
.type-home { --c: var(--efc-home, var(--secondary-text-color, #727272)); }
.type-ev_charger { --c: var(--efc-ev, #9a6fd6); }
.type-backup { --c: var(--efc-backup, #c95a8a); }
.type-generator { --c: var(--efc-generator, #cf6a4e); }
.type-producer { --c: var(--efc-producer, #b5a220); }
.type-consumer, .type-heat_pump, .type-boiler, .type-airco { --c: var(--efc-consumer, #2fa4b8); }

/* Verbindingen */
.line { stroke: var(--c); stroke-linecap: round; opacity: 0.28; }
.connection[data-flow="flowing"] .line { opacity: 0.55; }
.connection[data-flow="unknown"] .line { stroke-dasharray: 2 7; opacity: 0.4; }
.particle { fill: var(--c); }
.chevron { stroke: var(--c); stroke-linecap: round; stroke-linejoin: round; display: none; }
.connection[data-flow="flowing"][data-animated="false"] .chevron { display: block; }

/* Nodes */
.node { cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
.ring {
  fill: var(--efc-node-bg, var(--card-background-color, #fff));
  stroke: var(--c); stroke-width: 2.4;
}
.halo { fill: none; stroke: var(--c); stroke-width: 1.5; opacity: 0; transition: opacity 0.3s; }
.node[data-status="valid"] .halo, .node[data-status="charging"] .halo { opacity: 0.28; }
.node:hover .halo { opacity: 0.5; }
.node:focus-visible .halo { opacity: 0.9; stroke-width: 2.5; }
.glyph { stroke: var(--c); color: var(--c); }

.value {
  fill: var(--primary-text-color, #212121);
  font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums;
}
.soc { fill: var(--primary-text-color, #212121); font-size: 13px; font-weight: 600; }
.name-in { fill: var(--primary-text-color, #212121); font-size: 12px; font-weight: 600; }
.label { fill: var(--primary-text-color, #212121); font-size: 13px; font-weight: 500; }
.label, .sub {
  paint-order: stroke; stroke-linejoin: round; stroke-width: 5px;
  stroke: var(--ha-card-background, var(--card-background-color, #fff));
}
.sub { fill: var(--secondary-text-color, #727272); font-size: 11px; }

/* Flow-weergave: lijnen zijn de hoofdzaak, nodes blijven rustig en compact. */
.layout-flow .line { opacity: 0.38; }
.layout-flow .connection[data-flow="flowing"] .line { opacity: 0.72; }
.layout-flow .halo { stroke-width: 1; }
.layout-flow .node[data-status="valid"] .halo,
.layout-flow .node[data-status="charging"] .halo { opacity: 0.12; }

.node[data-status="zero"] .value { fill: var(--secondary-text-color, #727272); font-weight: 500; }
.node[data-status="invalid"], .node[data-status="unknown"] { opacity: 0.72; }
.node[data-status="invalid"] .ring, .node[data-status="unknown"] .ring {
  stroke: var(--disabled-text-color, #9e9e9e); stroke-dasharray: 5 5;
}
.node[data-status="unavailable"] .ring { stroke: var(--error-color, #db4437); stroke-dasharray: 5 5; }
.node[data-status="unavailable"] .value { fill: var(--error-color, #db4437); font-size: 24px; }

.charging { display: none; }
.node[data-status="charging"] .charging { display: block; }
.charging circle { fill: var(--c); }
.bolt { fill: var(--card-background-color, #fff); }
.diagnostic-badge circle { fill: var(--warning-color, #f9a825); stroke: var(--card-background-color, #fff); stroke-width: 1.5; }
.diagnostic-badge[data-severity="error"] circle { fill: var(--error-color, #db4437); }
.diagnostic-badge text { fill: #fff; font-size: 12px; font-weight: 800; stroke: none; }

/* Detailweergave */
.popup {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center; padding: 16px;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--card-background-color, #fff) 58%, transparent);
  -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px);
}
.popup[hidden] { display: none; }
.popup-panel {
  width: min(calc(100vw - 32px), 500px); max-height: calc(100vh - 32px); overflow: auto;
  background: var(--card-background-color, #fff);
  border: 1px solid var(--divider-color, #e0e0e0); border-top: 4px solid var(--c);
  border-radius: 16px; padding: 16px 18px 18px; box-sizing: border-box;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
}
.popup-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.popup-title { margin: 0; font-size: 17px; font-weight: 600; }
.popup-close {
  border: 0; background: transparent; color: var(--secondary-text-color, #727272);
  font-size: 26px; line-height: 1; width: 36px; height: 36px; border-radius: 50%; cursor: pointer;
}
.popup-close:hover { background: var(--secondary-background-color, #f0f0f0); }
.popup-close:focus-visible { outline: 2px solid var(--c); }
.popup-big { display: flex; align-items: baseline; gap: 10px; margin: 6px 0 4px; flex-wrap: wrap; }
.popup-value { font-size: 32px; font-weight: 600; font-variant-numeric: tabular-nums; }
.popup-panel[data-status="unavailable"] .popup-value { color: var(--error-color, #db4437); }
.popup-label { color: var(--secondary-text-color, #727272); font-size: 14px; }
.popup-section h3 { margin: 12px 0 2px; font-size: 13px; font-weight: 500; color: var(--secondary-text-color, #727272); }
.graph { display: block; width: 100%; height: auto; }
.graph .trace { stroke: var(--c); stroke-width: 1.8; stroke-linejoin: round; }
.graph .area { fill: var(--c); opacity: 0.14; }
.graph .zero { stroke: var(--divider-color, #cfcfcf); stroke-dasharray: 3 3; }
.graph .axis { fill: var(--secondary-text-color, #727272); font-size: 10.5px; }
.interactive-graph { touch-action: none; cursor: crosshair; overscroll-behavior: contain; }
.inspect-hit { pointer-events: all; cursor: crosshair; outline: none; }
.inspect-marker { stroke: var(--primary-text-color, #fff); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.7; pointer-events: none; }
.inspect-dot { fill: var(--c); stroke: var(--card-background-color, #111); stroke-width: 1.5; pointer-events: none; }
.inspect-dot.phase-1 { fill: var(--efc-phase-l1, #42a5f5); }
.inspect-dot.phase-2 { fill: var(--efc-phase-l2, #ffb300); }
.inspect-dot.phase-3 { fill: var(--efc-phase-l3, #ab47bc); }
.inspect-tooltip { pointer-events: none; }
.inspect-tooltip rect { fill: color-mix(in srgb, var(--card-background-color, #111) 94%, var(--primary-text-color, #fff) 6%); stroke: var(--divider-color, #555); stroke-width: 0.8; }
.inspect-text { fill: var(--primary-text-color, #fff); font-size: 9px; font-weight: 600; font-variant-numeric: tabular-nums; }
.inspect-time { fill: var(--secondary-text-color, #aaa); font-weight: 500; }
.phase-trace { stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.phase-l1 { --phase-c: var(--efc-phase-l1, #42a5f5); }
.phase-l2 { --phase-c: var(--efc-phase-l2, #ffb300); }
.phase-l3 { --phase-c: var(--efc-phase-l3, #ab47bc); }
.phase-trace.phase-l1, .phase-trace.phase-l2, .phase-trace.phase-l3 { stroke: var(--phase-c); }
.phase-legend { display: flex; gap: 16px; align-items: center; justify-content: center; margin-top: 4px; font-size: 12px; color: var(--secondary-text-color, #727272); }
.phase-key { display: inline-flex; align-items: center; gap: 6px; }
.phase-key i { width: 16px; height: 3px; border-radius: 99px; background: var(--phase-c); display: inline-block; }
.phase-toggle { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; align-items: center; margin-top: 10px; cursor: pointer; }
.phase-toggle input { width: 18px; height: 18px; grid-row: 1 / span 2; }
.phase-toggle span { font-size: 14px; color: var(--primary-text-color); }
.phase-toggle small { font-size: 12px; color: var(--secondary-text-color, #727272); }
.popup-empty { padding: 22px 0; text-align: center; color: var(--secondary-text-color, #727272); font-size: 14px; }
.popup-rows { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin: 12px 0 0; font-size: 14px; }
.popup-rows dt { color: var(--secondary-text-color, #727272); }
.popup-rows dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.popup-note { margin: 12px 0 0; font-size: 13px; color: var(--secondary-text-color, #727272); }
.diagnostics { margin-top: 14px; padding: 11px 12px; border: 1px solid var(--divider-color, #e0e0e0); border-radius: 10px; background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 65%, transparent); }
.diagnostics-head { display: flex; align-items: center; gap: 7px; }
.diagnostics-head h3 { margin: 0; font-size: 13px; font-weight: 600; }
.diagnostics-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success-color, #43a047); flex: 0 0 auto; }
.diagnostics-warning .diagnostics-dot { background: var(--warning-color, #f9a825); }
.diagnostics-error .diagnostics-dot { background: var(--error-color, #db4437); }
.diagnostics-info .diagnostics-dot { background: var(--info-color, #039be5); }
.diagnostics-message { margin: 7px 0 0; font-size: 13px; color: var(--secondary-text-color, #727272); }
.diagnostics-rows { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin: 8px 0 0; font-size: 13px; }
.diagnostics-rows dt { color: var(--secondary-text-color, #727272); }
.diagnostics-rows dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }

.replay-controls {
  margin: 0 12px 10px; padding: 4px 8px;
  border: 1px solid var(--divider-color, #e0e0e0); border-radius: 9px;
  background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 42%, transparent);
}
.replay-controls.active { border-color: color-mix(in srgb, var(--primary-color, #03a9f4) 70%, var(--divider-color, #e0e0e0)); }
.replay-row { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 7px; min-height: 22px; }
.replay-controls.active .replay-row { grid-template-columns: auto minmax(70px, 1fr) auto; }
.replay-label { grid-column: 1; font-size: 11px; font-weight: 600; color: var(--secondary-text-color, #727272); white-space: nowrap; }
.replay-controls.active .replay-label { display: none; }
.replay-time { grid-column: 1; font-size: 10px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.replay-slider { grid-column: 2; width: 100%; min-width: 70px; height: 16px; margin: 0; accent-color: var(--primary-color, #03a9f4); }
.replay-controls.active .replay-slider { grid-column: 2; }
.replay-live { grid-column: 3; border: 0; border-radius: 999px; padding: 3px 8px; cursor: pointer; font: inherit; font-size: 10px; font-weight: 700; background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); white-space: nowrap; }
.replay-live[hidden], .replay-time[hidden], .replay-status[hidden] { display: none !important; }
.replay-status { display: block; margin-top: 1px; color: var(--secondary-text-color, #727272); font-size: 9px; line-height: 1.2; }

.mobile-focus-nav {
  display: flex; align-items: center; gap: 7px; margin: 38px 4px 4px;
  min-width: 0; color: var(--secondary-text-color, #727272);
}
.mobile-focus-back {
  width: 28px; height: 28px; flex: 0 0 28px; border-radius: 50%; border: 1px solid var(--divider-color, #e0e0e0);
  background: color-mix(in srgb, var(--card-background-color, #fff) 90%, transparent); color: var(--primary-text-color, #212121);
  font: inherit; font-size: 21px; line-height: 1; cursor: pointer;
}
.mobile-focus-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 600; }


.energy-stats {
  margin-top: 14px; padding: 12px; border-radius: 12px;
  border: 1px solid var(--divider-color, #ddd);
  background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 42%, transparent);
}
.energy-stats > h3 { margin: 0 0 10px; font-size: 13px; }
.energy-stats-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px; }
.energy-stats-tab {
  border: 1px solid var(--divider-color, #ddd); border-radius: 999px; padding: 6px 8px;
  background: transparent; color: var(--primary-text-color, #212121); font: inherit; font-size: 12px; cursor: pointer;
}
.energy-stats-tab.active { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); border-color: var(--primary-color, #03a9f4); }
.energy-stats-rows { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 7px 14px; margin: 0; font-size: 13px; }
.energy-stats-rows dt { color: var(--secondary-text-color, #727272); }
.energy-stats-rows dd { margin: 0; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.energy-stats-loading { color: var(--secondary-text-color, #727272); font-size: 12px; padding: 5px 0 2px; }

@media (max-width: 600px) {
  .stage { min-height: 0; padding-inline: 6px; }
  .popup { padding: 8px; }
  .popup-panel { width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 12px; padding: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .halo { transition: none; }
}
`;
