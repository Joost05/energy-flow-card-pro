import { EnergyFlowCard } from './card/EnergyFlowCard';
import { EnergyFlowCardEditor } from './editor/EnergyFlowCardEditor';

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string; preview?: boolean; documentationURL?: string }[];
  }
}

if (!customElements.get('energy-flow-card')) customElements.define('energy-flow-card', EnergyFlowCard);
if (!customElements.get('energy-flow-card-editor')) customElements.define('energy-flow-card-editor', EnergyFlowCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'energy-flow-card')) {
  window.customCards.push({
    type: 'energy-flow-card',
    name: 'Energy Flow Card Pro',
    description: 'Geavanceerde realtime energieflow, historie, groepen en prijsinformatie voor Home Assistant.',
    preview: true,
  });
}

console.info('%c ENERGY-FLOW-CARD-PRO %c 0.15.2 ', 'color:#fff;background:#33b07a;font-weight:600', 'color:#33b07a');
