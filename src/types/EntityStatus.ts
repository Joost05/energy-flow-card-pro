/** Wat we weten over de waarde van één Home Assistant-entiteit. */
export enum EntityStatus {
  /** Een geldig getal ongelijk aan nul, bijvoorbeeld 1250 W. */
  Valid = 'valid',
  /** Een geldig getal dat precies 0 is. */
  Zero = 'zero',
  /** Tekst die geen getal is, of een entiteit die niet bestaat. */
  Invalid = 'invalid',
  /** Home Assistant meldt "unknown". */
  Unknown = 'unknown',
  /** Home Assistant meldt "unavailable". */
  Unavailable = 'unavailable',
  /** Een node die op dit moment laadt (laadindicator). */
  Charging = 'charging',
}

/** Het teken dat in plaats van een waarde wordt getoond: "?" of "!"; null als er een waarde is. */
export function statusSymbol(status: EntityStatus): string | null {
  switch (status) {
    case EntityStatus.Invalid:
    case EntityStatus.Unknown:
      return '?';
    case EntityStatus.Unavailable:
      return '!';
    default:
      return null;
  }
}

/** Is er een bruikbare getalwaarde (ook 0 W)? */
export function hasValue(status: EntityStatus): boolean {
  return status === EntityStatus.Valid || status === EntityStatus.Zero || status === EntityStatus.Charging;
}
