import type { ComponentProps } from 'react';
import { FontAwesome, Ionicons, MaterialIcons } from '@expo/vector-icons';

export type IconFamily = 'material' | 'fontawesome' | 'ionicons';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];
type FontAwesomeIconName = ComponentProps<typeof FontAwesome>['name'];
type IoniconsIconName = ComponentProps<typeof Ionicons>['name'];

export interface IconSpec {
  family: IconFamily;
  name: MaterialIconName | FontAwesomeIconName | IoniconsIconName;
  color: string;
}

export function Icon({ spec, size = 22 }: { spec: IconSpec; size?: number }) {
  if (spec.family === 'fontawesome') {
    return <FontAwesome name={spec.name as FontAwesomeIconName} size={size} color={spec.color} />;
  }
  if (spec.family === 'ionicons') {
    return <Ionicons name={spec.name as IoniconsIconName} size={size} color={spec.color} />;
  }
  return <MaterialIcons name={spec.name as MaterialIconName} size={size} color={spec.color} />;
}

export const LOG_EVENT_ICONS: Record<string, IconSpec> = {
  game_created: { family: 'material', name: 'videogame-asset', color: '#8e44ad' },
  team_joined: { family: 'material', name: 'group-add', color: '#2980b9' },
  team_kicked: { family: 'material', name: 'person-remove', color: '#7f8c8d' },
  game_started: { family: 'material', name: 'play-arrow', color: '#27ae60' },
  game_paused: { family: 'material', name: 'pause', color: '#f39c12' },
  game_resumed: { family: 'material', name: 'play-arrow', color: '#27ae60' },
  game_ended: { family: 'material', name: 'stop', color: '#e74c3c' },
  landmark_claimed: { family: 'material', name: 'photo-camera', color: '#16a085' },
  landmark_stolen: { family: 'material', name: 'swap-horiz', color: '#e67e22' },
  challenge_complete: { family: 'material', name: 'lock', color: '#2c3e50' },
  challenge_fail: { family: 'material', name: 'cancel', color: '#e74c3c' },
  challenge_pass: { family: 'material', name: 'fast-forward', color: '#f39c12' },
  challenge_voided: { family: 'material', name: 'remove-circle-outline', color: '#95a5a6' },
  tag_created: { family: 'material', name: 'label', color: '#c0392b' },
  tag_disputed: { family: 'material', name: 'autorenew', color: '#7f8c8d' },
  debug_adjusted: { family: 'material', name: 'build', color: '#7f8c8d' },
};

export const LOG_EVENT_ICON_DEFAULT: IconSpec = {
  family: 'material',
  name: 'notes',
  color: '#7f8c8d',
};

// Shared one-off icons used across screens
export const ICONS = {
  close: { family: 'ionicons', name: 'close', color: '#1a1a2e' },
  trophy: { family: 'material', name: 'emoji-events', color: '#f1c40f' },
  pause: { family: 'material', name: 'pause-circle', color: '#f39c12' },
  pin: { family: 'material', name: 'place', color: '#e74c3c' },
  lock: { family: 'material', name: 'lock', color: '#7f8c8d' },
  camera: { family: 'material', name: 'photo-camera', color: '#16a085' },
  checkCircle: { family: 'material', name: 'check-circle', color: '#2ecc71' },
  cancel: { family: 'material', name: 'cancel', color: '#e74c3c' },
  fastForward: { family: 'material', name: 'fast-forward', color: '#f39c12' },
  swords: { family: 'material', name: 'swap-horiz', color: '#e67e22' },
  label: { family: 'material', name: 'label', color: '#c0392b' },
  eyeOff: { family: 'material', name: 'visibility-off', color: '#e67e22' },
  clipboard: { family: 'material', name: 'assignment', color: '#7f8c8d' },
} satisfies Record<string, IconSpec>;
