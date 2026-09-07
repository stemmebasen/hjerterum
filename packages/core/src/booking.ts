export interface TimeInterval {
  startsAt: string;
  endsAt: string;
}

export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  const aStart = Date.parse(a.startsAt);
  const aEnd = Date.parse(a.endsAt);
  const bStart = Date.parse(b.startsAt);
  const bEnd = Date.parse(b.endsAt);

  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) {
    throw new Error("Invalid ISO date interval");
  }

  if (aStart >= aEnd || bStart >= bEnd) {
    throw new Error("Interval end must be after start");
  }

  return aStart < bEnd && bStart < aEnd;
}
