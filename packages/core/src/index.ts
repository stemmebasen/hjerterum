export type MemberId = string;
export type EventId = string;
export type BookingId = string;

export interface Member {
  id: MemberId;
  email: string;
  displayName: string;
  active: boolean;
}

export interface Event {
  id: EventId;
  title: string;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
}

export interface RoomBooking {
  id: BookingId;
  eventId: EventId;
  startsAt: string;
  endsAt: string;
  status: "reserved" | "confirmed" | "cancelled";
}

export interface MemberRepository {
  findById(id: MemberId): Promise<Member | null>;
  findByEmail(email: string): Promise<Member | null>;
}

export interface EventRepository {
  listUpcoming(fromIso: string): Promise<Event[]>;
  findById(id: EventId): Promise<Event | null>;
}

export interface BookingRepository {
  hasConflict(startsAt: string, endsAt: string): Promise<boolean>;
  save(booking: RoomBooking): Promise<void>;
}

export interface ObjectStorage {
  put(key: string, body: ArrayBuffer, contentType: string): Promise<void>;
  getPublicUrl(key: string): Promise<string>;
}

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export interface PaymentGateway {
  createCheckout(input: {
    reference: string;
    amountMinor: number;
    currency: "DKK";
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutUrl: string }>;
}

export interface CirclesEntitlementGateway {
  getEligibility(memberId: MemberId): Promise<{ eligible: boolean; reason?: string }>;
}

export { intervalsOverlap } from "./booking.js";
export type { TimeInterval } from "./booking.js";
export {
  canCreateEvent,
  requiresEventApproval,
  calculateAdminFeeMinor,
  eventRefundsEnabled
} from "./event-policy.js";
export { calculateLegacyRoomFee } from "./legacy-room-pricing.js";
export type {
  LegacyRoomPricingInput,
  LegacyRoomPricingResult
} from "./legacy-room-pricing.js";
