export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function isWithinVicinity(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  radius: number
): boolean {
  return haversineDistance(lat1, lon1, lat2, lon2) <= radius;
}

export function computeScoreboard(
  teams: { id: string; name: string; color: string }[],
  landmarkStates: { teamId?: string; locked: boolean }[]
): { teamId: string; name: string; color: string; claimed: number; locked: number }[] {
  return teams
    .map((t) => {
      const claimed = landmarkStates.filter(
        (s) => s.teamId === t.id
      ).length;
      const locked = landmarkStates.filter(
        (s) => s.teamId === t.id && s.locked
      ).length;
      return { teamId: t.id, name: t.name, color: t.color, claimed, locked };
    })
    .sort((a, b) => b.claimed - a.claimed || b.locked - a.locked);
}

export function checkWinCondition(
  scores: { teamId: string; claimed: number }[],
  winThreshold: number
): { winner: string | null; isTie: boolean } {
  const sorted = [...scores].sort((a, b) => b.claimed - a.claimed);
  if (sorted.length === 0) return { winner: null, isTie: false };
  if (sorted[0].claimed >= winThreshold) {
    if (sorted[1] && sorted[1].claimed === sorted[0].claimed) {
      return { winner: null, isTie: true };
    }
    return { winner: sorted[0].teamId, isTie: false };
  }
  return { winner: null, isTie: false };
}

export function computeWinner(
  scores: { teamId: string; name: string; claimed: number; locked: number }[]
): { winnerId: string | null; isTie: boolean } {
  if (scores.length === 0) return { winnerId: null, isTie: false };
  const sorted = [...scores].sort(
    (a, b) => b.claimed - a.claimed || b.locked - a.locked
  );
  if (sorted.length > 1 &&
    sorted[0].claimed === sorted[1].claimed &&
    sorted[0].locked === sorted[1].locked
  ) {
    return { winnerId: null, isTie: true };
  }
  return { winnerId: sorted[0].teamId, isTie: false };
}
