import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pressMateDoor, pressWizardDoor, type DoorDeps } from '../doorActions';

function makeDeps(overrides: Partial<DoorDeps> = {}): DoorDeps {
  return {
    navigate: vi.fn(),
    lightTap: vi.fn(),
    track: vi.fn(),
    canCreateQuote: vi.fn(() => true),
    createNewQuote: vi.fn(),
    ...overrides,
  };
}

describe('dashboard doors', () => {
  let deps: DoorDeps;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("primary door navigates to Mate and tracks dashboard_door_tapped {door:'mate'}", () => {
    pressMateDoor(deps);
    expect(deps.track).toHaveBeenCalledWith('dashboard_door_tapped', { door: 'mate' });
    expect(deps.navigate).toHaveBeenCalledWith('Mate', { source: 'dashboard_door' });
    // Mate mints its own quote on Apply — the door must not.
    expect(deps.createNewQuote).not.toHaveBeenCalled();
  });

  it('secondary door creates a quote and navigates to NewJob', () => {
    pressWizardDoor(deps);
    expect(deps.track).toHaveBeenCalledWith('dashboard_door_tapped', { door: 'wizard' });
    expect(deps.createNewQuote).toHaveBeenCalledOnce();
    expect(deps.navigate).toHaveBeenCalledWith('NewJob');
  });

  it('secondary door routes to Paywall when quote creation is gated', () => {
    deps = makeDeps({ canCreateQuote: vi.fn(() => false) });
    pressWizardDoor(deps);
    expect(deps.navigate).toHaveBeenCalledWith('Paywall', { source: 'dashboard' });
    expect(deps.createNewQuote).not.toHaveBeenCalled();
  });
});
