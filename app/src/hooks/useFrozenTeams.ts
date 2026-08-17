import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useGameStore } from '../stores/useGameStore';
import { useTeamStore } from '../stores/useTeamStore';

const FREEZE_DURATION_MS = 10 * 60 * 1000;

export function useFrozenTeams(): { now: number } {
  const game = useGameStore((s) => s.game);
  const myTeamId = useTeamStore((s) => s.myTeamId);
  const setFrozenTeams = useTeamStore((s) => s.setFrozenTeams);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!game) return;
    api.getFrozenTeams(game.id).then((list: { teamId: string; frozenUntil: string }[]) => {
      const map: Record<string, string> = {};
      for (const item of list) {
        map[item.teamId] = item.frozenUntil;
        if (item.teamId === myTeamId) {
          useTeamStore.getState().setFrozen(true, item.frozenUntil);
          const cfg = useGameStore.getState().game?.config;
          if (cfg) {
            const disputeEnd = new Date(
              new Date(item.frozenUntil).getTime() - FREEZE_DURATION_MS + (cfg.disputeWindow ?? 60) * 1000
            ).toISOString();
            useTeamStore.getState().setDisputeWindow(disputeEnd);
          }
        }
      }
      setFrozenTeams(map);
    }).catch(() => {});
  }, [game?.id, myTeamId, setFrozenTeams]);

  useEffect(() => {
    const interval = setInterval(() => {
      const n = Date.now();
      setNow(n);
      const s = useTeamStore.getState();
      for (const [tid, until] of Object.entries(s.frozenTeams)) {
        if (new Date(until).getTime() <= n) s.removeFrozenTeam(tid);
      }
      for (const [tid, until] of Object.entries(s.tagCooldowns)) {
        if (new Date(until).getTime() <= n) s.removeTagCooldown(tid);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return { now };
}