/**
 * Pure selector for the Chat/Apps header title (stage 10). The component is a
 * thin renderer over this model — jest's node environment cannot render the
 * Tabs navigator, so everything decision-shaped lives (and is tested) here.
 *
 * With an active connection the header shows WHICH agent you are talking to
 * (name + the stage-3 health dot); with none it falls back to the static tab
 * title, non-interactive.
 */

import {
  type HealthPalette,
  type HealthState,
  healthColor,
  healthLabel,
} from '../connections/health';

export type HeaderIdentityModel =
  /** No active connection: the static title, not pressable, no dot. */
  | { kind: 'static'; title: string }
  /** Active connection: agent name + health dot; pressing opens the switcher. */
  | { kind: 'identity'; title: string; dotColor: string; healthLabel: string };

export const headerIdentityModel = (
  active: { agentName: string } | null,
  health: HealthState,
  fallbackTitle: string,
  palette: HealthPalette,
): HeaderIdentityModel => {
  if (active === null) return { kind: 'static', title: fallbackTitle };
  return {
    kind: 'identity',
    title: active.agentName,
    dotColor: healthColor(health, palette),
    healthLabel: healthLabel(health),
  };
};
