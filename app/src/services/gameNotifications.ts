import * as Notifications from 'expo-notifications';
import { useGameStore } from '../stores/useGameStore';
import { scheduleLocalNotification } from './notifications';

const HALF_TIME_ID = 'vat-half-time';

export function notifyTagged(): void {
  const game = useGameStore.getState().game;
  const disputeWindow = game?.config.disputeWindow ?? 60;
  scheduleLocalNotification(
    "You've been tagged!",
    `Your team is frozen — you have ${disputeWindow}s to dispute the tag.`
  );
}

export function notifyGameEnded(data: { winnerId?: string | null; isTie?: boolean | null }): void {
  const game = useGameStore.getState().game;
  let body: string;
  if (data.isTie || !data.winnerId) {
    body = "It's a tie!";
  } else {
    const winner = game?.teams.find((t) => t.id === data.winnerId);
    body = `${winner?.name ?? 'A team'} wins!`;
  }
  scheduleLocalNotification('Game Over', body);
}

// Half-time reminder: fires when half of the *active* game time has elapsed.
// Re-scheduled (replacing the previous one by id) whenever game state changes,
// and cancelled while paused since the remaining wall time is then unknown.
export async function syncHalfTimeNotification(): Promise<void> {
  const game = useGameStore.getState().game;
  if (!game || game.status !== 'active' || !game.startedAt) {
    await Notifications.cancelScheduledNotificationAsync(HALF_TIME_ID).catch(() => {});
    return;
  }

  const durationMs = game.config.duration * 1000;
  const halfWallMs =
    new Date(game.startedAt).getTime() + durationMs / 2 + game.totalPausedMs;
  const secondsLeft = (halfWallMs - Date.now()) / 1000;
  if (secondsLeft <= 0) {
    await Notifications.cancelScheduledNotificationAsync(HALF_TIME_ID).catch(() => {});
    return;
  }

  const minutesTotal = Math.round(durationMs / 2 / 60000);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Half-time!',
      body: `Half the game time is over — about ${Math.max(1, minutesTotal)} min remaining.`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.round(secondsLeft),
    },
    ...( { id: HALF_TIME_ID } as any ),
  }).catch(() => {});
}
