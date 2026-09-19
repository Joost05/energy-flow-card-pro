import { isCharging, NodeReading } from '../helpers/flowHelper';
import type { EnergyNode } from '../models/Node';
import { EntityStatus } from '../types/EntityStatus';

const DAY_SECONDS = 120; // één "dag" duurt twee minuten, zodat je alles snel ziet gebeuren
const BATTERY_SECONDS = 150;

const wave = (t: number, period: number, phase = 0): number => Math.sin((2 * Math.PI * t) / period + phase);

function reading(node: EnergyNode, watts: number, soc?: number): NodeReading {
  const rounded = Math.round(watts);
  const r: NodeReading = {
    status: rounded === 0 ? EntityStatus.Zero : EntityStatus.Valid,
    watts: rounded === 0 ? 0 : rounded,
    charging: false,
  };
  r.charging = isCharging(node, r.watts);
  if (soc !== undefined) r.soc = { status: EntityStatus.Valid, value: Math.round(soc) };
  return r;
}

/**
 * Verzint consistente meetwaarden voor een demo: de energiebalans klopt altijd,
 * zodat wat het net levert precies aansluit bij wat de rest produceert en verbruikt.
 * Home krijgt geen eigen waarde; die wordt uit de verbindingen berekend.
 */
export function demoReadings(nodes: readonly EnergyNode[], t: number): Map<string, NodeReading> {
  const out = new Map<string, NodeReading>();

  const phase = (t / DAY_SECONDS) % 1;
  const sun = phase < 0.65 ? Math.sin((Math.PI * phase) / 0.65) : 0;
  const flicker = 0.93 + 0.07 * wave(t, 7);

  const solars = nodes.filter((n) => n.type === 'solar');
  const batteries = nodes.filter((n) => n.type === 'battery');
  const grids = nodes.filter((n) => n.type === 'grid');

  let production = 0;
  let consumption = 380 + 140 * wave(t, 9); // wat de woning zelf verbruikt

  nodes.forEach((node, i) => {
    let watts: number | null = null;
    switch (node.type) {
      case 'solar': {
        watts = (5200 * sun * flicker) / solars.length;
        production += watts;
        break;
      }
      case 'producer': {
        watts = 700 * sun * flicker;
        production += watts;
        break;
      }
      case 'generator': {
        watts = 0; // een geldige nul: apparaat staat uit, sensor werkt gewoon
        break;
      }
      case 'ev_charger': {
        watts = wave(t, 37) > 0.1 ? 3700 * (0.97 + 0.03 * wave(t, 3)) : 0;
        consumption += watts;
        break;
      }
      case 'heat_pump': {
        watts = 350 + 600 * (0.5 + 0.5 * wave(t, 17));
        consumption += watts;
        break;
      }
      case 'boiler': {
        watts = Math.cos((2 * Math.PI * t) / 29) > 0.55 ? 2000 : 0;
        consumption += watts;
        break;
      }
      case 'airco': {
        watts = Math.max(0, 900 * wave(t, 41));
        consumption += watts;
        break;
      }
      case 'backup': {
        // Een backup telt niet apart mee: de apparaten erachter (of, zonder die, deze waarde) worden getoond;
        // de kaart rekent een backup met apparaten erachter om naar hun som.
        watts = 220 + 160 * (0.5 + 0.5 * wave(t, 23));
        break;
      }
      case 'consumer': {
        watts = 180 + 120 * (0.5 + 0.5 * wave(t, 11, i));
        consumption += watts;
        break;
      }
      default:
        break;
    }
    if (watts !== null) out.set(node.id, reading(node, watts));
  });

  // Batterij: laadvermogen volgt de afgeleide van de laadtoestand, zodat de cijfers kloppen met elkaar.
  let charge = 0;
  const soc = 55 + 35 * wave(t, BATTERY_SECONDS);
  if (batteries.length > 0) {
    charge = 2800 * Math.cos((2 * Math.PI * t) / BATTERY_SECONDS);
    for (const b of batteries) out.set(b.id, reading(b, -charge / batteries.length, soc));
  }

  // Het net vult aan wat er ontbreekt (positief = afname, negatief = teruglevering).
  const gridTotal = consumption + charge - production;
  grids.forEach((g, i) => out.set(g.id, reading(g, i === 0 ? gridTotal : 0)));

  return out;
}
