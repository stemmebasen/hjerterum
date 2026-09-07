export function canCreateEvent(isPayingMember: boolean): boolean {
  return isPayingMember;
}

export function requiresEventApproval(isFixedTeacher: boolean): boolean {
  return !isFixedTeacher;
}

export function calculateAdminFeeMinor(grossAmountMinor: number): number {
  if (!Number.isInteger(grossAmountMinor) || grossAmountMinor < 0) {
    throw new Error("Gross amount must be a non-negative integer in minor currency units");
  }

  return Math.round(grossAmountMinor * 0.05);
}

export const eventRefundsEnabled = false;
