// The dashboard's two doors: Mate (primary) and the wizard (secondary).
// Extracted so the tap behaviour — analytics, the paywall check, and the
// create/navigate order — is unit-testable without rendering the animated
// dashboard. Deps are injected because the screen owns navigation, haptics,
// and the store bindings.

export interface DoorDeps {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  lightTap: () => void;
  track: (event: 'dashboard_door_tapped', props: { door: 'mate' | 'wizard' }) => void;
  canCreateQuote: () => boolean;
  createNewQuote: () => void;
}

// No createNewQuote here — Mate mints its own quote on Apply. The source
// param lets the Mate tab attribute this focus visit to the door.
export function pressMateDoor(deps: DoorDeps): void {
  deps.track('dashboard_door_tapped', { door: 'mate' });
  deps.lightTap();
  deps.navigate('Mate', { source: 'dashboard_door' });
}

export function pressWizardDoor(deps: DoorDeps): void {
  deps.track('dashboard_door_tapped', { door: 'wizard' });
  if (!deps.canCreateQuote()) {
    deps.navigate('Paywall', { source: 'dashboard' });
    return;
  }
  deps.lightTap();
  deps.createNewQuote();
  deps.navigate('NewJob');
}
