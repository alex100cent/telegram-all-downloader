export const DONATION_INTERVAL = 20;

export interface DonationState {
  completedDownloads: number;
  dismissedMilestone: number;
}

export const DEFAULT_DONATION_STATE: DonationState = {
  completedDownloads: 0,
  dismissedMilestone: 0,
};

export function pendingDonationMilestone(state: DonationState): number | undefined {
  const milestone = Math.floor(state.completedDownloads / DONATION_INTERVAL) * DONATION_INTERVAL;
  return milestone > state.dismissedMilestone ? milestone : undefined;
}
