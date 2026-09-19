import type { Connection } from '../models/Connection';
import type { EnergyNode } from '../models/Node';
import { EntityStatus, hasValue } from '../types/EntityStatus';
import type { Hass } from '../types/hass';
import { EntityReading, readNumber, readPower } from './stateHelper';

/**
 * Tekenafspraak voor het vermogen van een node (na eventuele `invert`):
 * - bron, net en batterij: positief = energie richting Home
 *   (zon produceert, net = afname, batterij = ontladen);
 * - verbruiker: positief = verbruik.
 * Een negatief net-vermogen is dus teruglevering, een negatief batterijvermogen is laden.
 */
export interface NodeReading {
  status: EntityStatus;
  /** Vermogen in W volgens de tekenafspraak, of null als er geen geldige waarde is. */
  watts: number | null;
  /** Batterij-laadtoestand in %, alleen als een soc_entity is ingesteld. */
  soc?: EntityReading;
  /** Laadt de batterij of de EV-lader op dit moment? */
  charging: boolean;
}

/** Energie die deze node richting Home stuurt (negatief = neemt energie van Home af). */
export function flowToHome(node: EnergyNode, reading: NodeReading): number | null {
  if (reading.watts === null) return null;
  return node.role === 'consumer' ? -reading.watts : reading.watts;
}

function negateSafe(n: number): number {
  return n === 0 ? 0 : -n;
}

const SEVERITY: EntityStatus[] = [EntityStatus.Unavailable, EntityStatus.Unknown, EntityStatus.Invalid];

function worstStatus(a: EntityStatus, b: EntityStatus): EntityStatus {
  for (const s of SEVERITY) if (a === s || b === s) return s;
  return EntityStatus.Invalid;
}

export function isCharging(node: EnergyNode, watts: number | null): boolean {
  if (watts === null) return false;
  if (node.type === 'battery') return watts < 0;
  if (node.type === 'ev_charger') return watts > 0;
  return false;
}

/** Leest het vermogen van één node live uit Home Assistant. */
export function readNode(node: EnergyNode, hass: Hass | undefined): NodeReading {
  const cfg = node.config;
  let base: EntityReading;

  if (node.type === 'battery' && cfg.charge_power_entity && cfg.discharge_power_entity) {
    const charge = readPower(hass, cfg.charge_power_entity);
    const discharge = readPower(hass, cfg.discharge_power_entity);
    if (charge.value !== null && discharge.value !== null) {
      const net = discharge.value - charge.value;
      base = { status: net === 0 ? EntityStatus.Zero : EntityStatus.Valid, value: net };
    } else {
      const status = worstStatus(charge.status, discharge.status);
      base = { status: hasValue(status) ? EntityStatus.Invalid : status, value: null };
    }
  } else {
    base = readPower(hass, cfg.power_entity ?? cfg.production_entity);
  }

  let watts = base.value;
  if (watts !== null && node.invert) watts = negateSafe(watts);

  const reading: NodeReading = {
    status: base.status,
    watts,
    charging: isCharging(node, watts),
  };
  if (cfg.soc_entity) reading.soc = readNumber(hass, cfg.soc_entity);
  return reading;
}

function supply(node: EnergyNode, reading: NodeReading): number | null {
  const f = flowToHome(node, reading);
  return f === null ? null : Math.max(0, f);
}

function demand(node: EnergyNode, reading: NodeReading): number | null {
  const f = flowToHome(node, reading);
  return f === null ? null : Math.max(0, -f);
}

export interface FlowOptions {
  /** In demo-modus worden eigen flow-sensors van verbindingen genegeerd. */
  ignoreEntities?: boolean;
}

/**
 * Bepaalt per verbinding hoeveel energie er stroomt: positief = van `from` naar `to`,
 * 0 = stil, null = onbekend (ongeldige sensor).
 */
export function computeFlows(
  nodes: readonly EnergyNode[],
  connections: readonly Connection[],
  readings: ReadonlyMap<string, NodeReading>,
  hass: Hass | undefined,
  options: FlowOptions = {},
): Map<string, number | null> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const result = new Map<string, number | null>();

  for (const conn of connections) {
    const from = byId.get(conn.from);
    const to = byId.get(conn.to);
    if (!from || !to) continue;

    let value: number | null;
    if (conn.entity && !options.ignoreEntities) {
      value = readPower(hass, conn.entity).value;
    } else {
      const fromReading = readings.get(from.id);
      const toReading = readings.get(to.id);
      // Home en hiërarchische verbruikers hebben een duidelijke parent → child richting.
      // Voor parent → child gebruiken we altijd het childvermogen als takvermogen; het parentvermogen blijft
      // het gemeten totaal op de inkomende tak en wordt daardoor niet dubbel bij Home opgeteld.
      const isConsumerHub = (node: EnergyNode) => node.type === 'backup' || node.role === 'consumer';
      const isChild = (node: EnergyNode) => node.role === 'consumer' && node.type !== 'backup';
      if (to.role === 'home' && fromReading) {
        value = flowToHome(from, fromReading);
      } else if (from.role === 'home' && toReading) {
        const f = flowToHome(to, toReading);
        value = f === null ? null : negateSafe(f);
      } else if (isConsumerHub(from) && isChild(to) && toReading) {
        const f = flowToHome(to, toReading);
        value = f === null ? null : negateSafe(f);
      } else if (isConsumerHub(to) && isChild(from) && fromReading) {
        value = flowToHome(from, fromReading);
      } else if (fromReading && toReading) {
        // Tussen twee nodes zonder Home: schat de stroom als het kleinste van aanbod en vraag.
        const fwdSupply = supply(from, fromReading);
        const fwdDemand = demand(to, toReading);
        const backSupply = supply(to, toReading);
        const backDemand = demand(from, fromReading);
        if ([fwdSupply, fwdDemand, backSupply, backDemand].includes(null)) value = null;
        else value = Math.min(fwdSupply!, fwdDemand!) - Math.min(backSupply!, backDemand!);
      } else {
        value = null;
      }
    }

    if (value !== null) {
      if (conn.invert) value = negateSafe(value);
      if (!conn.bidirectional && value < 0) value = 0;
    }
    result.set(conn.id, value);
  }
  return result;
}

/**
 * Wat er in de woning gebeurt, berekend uit wat er binnenkomt: net (afname min teruglevering) + zon
 * + batterij (ontladen min laden) + generator. De losse apparaten (verbruikers, backup) zijn een deel van
 * dat verbruik en worden er dus niet vanaf getrokken. Home heeft daarom geen eigen sensor.
 *
 * Zonder net, zon of batterij is er niets om uit te rekenen; dan is Home de som van wat de apparaten gebruiken.
 * Is een stroom van een bron onbekend (ongeldige sensor), dan is de uitkomst onbetrouwbaar ("?").
 */
export function computeHomeReading(
  home: EnergyNode,
  nodes: readonly EnergyNode[],
  connections: readonly Connection[],
  flows: ReadonlyMap<string, number | null>,
): NodeReading {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const unknown: NodeReading = { status: EntityStatus.Invalid, watts: null, charging: false };
  let supply = 0;
  let demand = 0;
  let hasSource = false;
  let knownSources = 0;
  let hasConsumer = false;
  let knownConsumers = 0;

  for (const conn of connections) {
    if (conn.to !== home.id && conn.from !== home.id) continue;
    const other = byId.get(conn.to === home.id ? conn.from : conn.to);
    if (!other) continue;
    const f = flows.get(conn.id);
    if (other.role === 'consumer') {
      hasConsumer = true;
      if (f !== null && f !== undefined) {
        knownConsumers++;
        demand += conn.from === home.id ? f : -f;
      }
    } else {
      hasSource = true;
      if (f !== null && f !== undefined) {
        knownSources++;
        supply += conn.to === home.id ? f : -f;
      }
    }
  }

  if (!hasSource && !hasConsumer) return unknown;
  // Een ontbrekende losse sensor maakt niet meer de complete woning ongeldig. Als er minstens één
  // bruikbare bronstroom is tonen we de bekende energiebalans; zonder bronnen vallen we terug op de
  // bekende verbruikers. Wie een exacte woningwaarde wil kan met een eigen woningsensor instellen.
  if (hasSource && knownSources === 0) {
    if (knownConsumers === 0) return unknown;
    const watts = Math.max(0, demand);
    return { status: watts === 0 ? EntityStatus.Zero : EntityStatus.Valid, watts, charging: false };
  }
  if (!hasSource && knownConsumers === 0) return unknown;
  const watts = Math.max(0, hasSource ? supply : demand);
  return { status: watts === 0 ? EntityStatus.Zero : EntityStatus.Valid, watts, charging: false };
}

/**
 * Een backup die de gebruiker niet zelf meet, gebruikt precies wat de apparaten erachter gebruiken.
 * Heeft de backup een eigen sensor (`power_entity`), dan geldt die: de omvormer meet de backup-uitgang dan zelf.
 * In demo-modus blijft de verzonnen waarde staan zolang er geen apparaten achter hangen.
 */
export function applyBackupReadings(
  nodes: readonly EnergyNode[],
  connections: readonly Connection[],
  readings: Map<string, NodeReading>,
  demo: boolean,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const backup of nodes) {
    if (backup.type !== 'backup') continue;
    if (!demo && backup.config.power_entity) continue;

    const devices: EnergyNode[] = [];
    for (const conn of connections) {
      const otherId = conn.from === backup.id ? conn.to : conn.to === backup.id ? conn.from : null;
      const other = otherId ? byId.get(otherId) : undefined;
      if (other && other.role === 'consumer' && other.type !== 'backup') devices.push(other);
    }
    if (devices.length === 0) {
      if (!demo) readings.set(backup.id, { status: EntityStatus.Invalid, watts: null, charging: false });
      continue;
    }

    let total = 0;
    let known = true;
    for (const device of devices) {
      const r = readings.get(device.id);
      const d = r ? demand(device, r) : null;
      if (d === null) known = false;
      else total += d;
    }
    readings.set(
      backup.id,
      known
        ? { status: total === 0 ? EntityStatus.Zero : EntityStatus.Valid, watts: total, charging: false }
        : { status: EntityStatus.Invalid, watts: null, charging: false },
    );
  }
}
