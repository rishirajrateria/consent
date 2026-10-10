import { db } from "./db";

/**
 * Pluggable provider interfaces for email, SMS and payments.
 * The mock implementations write to the OutboxMessage table (visible at
 * /dev/inbox) and auto-succeed payments, so every flow can be exercised with
 * zero external keys. Real adapters (Resend, Twilio/MSG91, Stripe/Razorpay)
 * implement the same interfaces and are selected via env vars.
 */

export interface EmailProvider {
  send(to: string, subject: string, body: string): Promise<void>;
}

/**
 * Puts a meeting in one person's calendar. The mock emails a calendar invite
 * (.ics), which Gmail, Outlook and Apple Calendar add on arrival. A Google or
 * Microsoft adapter can instead write the event straight into a connected
 * calendar (Calendar API / Graph), keyed by the same uid so updates replace it.
 */
export interface CalendarProvider {
  name: string;
  putEvent(opts: { uid: string; to: { name: string; email: string }; subject: string; summary: string; ics: string }): Promise<{ ref: string }>;
}

export interface SmsProvider {
  send(to: string, body: string): Promise<void>;
}

export interface PaymentProvider {
  name: string;
  /** Creates a checkout; mock returns an internal URL that confirms instantly. */
  createCheckout(opts: {
    paymentId: string;
    amount: string;
    currency: string;
    description: string;
    returnTo: string;
  }): Promise<{ checkoutUrl: string; providerRef: string }>;
  /** Returns a captured payment to the payer; mock refunds instantly. */
  refund(opts: { paymentId: string; providerRef: string | null; amount: string; currency: string; reason: string }): Promise<{ refundRef: string }>;
}

class MockEmail implements EmailProvider {
  async send(to: string, subject: string, body: string) {
    await db.outboxMessage.create({ data: { channel: "email", to, subject, body } });
  }
}

class MockSms implements SmsProvider {
  async send(to: string, body: string) {
    await db.outboxMessage.create({ data: { channel: "sms", to, body } });
  }
}

class MockPayments implements PaymentProvider {
  name = "mock";
  async createCheckout(opts: {
    paymentId: string;
    amount: string;
    currency: string;
    description: string;
    returnTo: string;
  }) {
    const ref = `mock_${opts.paymentId}`;
    return {
      checkoutUrl: `/pay/mock/${opts.paymentId}?return=${encodeURIComponent(opts.returnTo)}`,
      providerRef: ref,
    };
  }
  async refund(opts: { paymentId: string; providerRef: string | null; amount: string; currency: string; reason: string }) {
    return { refundRef: `mock_refund_${opts.paymentId}` };
  }
}

class MockCalendar implements CalendarProvider {
  name = "mock";
  async putEvent(opts: { uid: string; to: { name: string; email: string }; subject: string; summary: string; ics: string }) {
    // Dev: the invite lands in the /dev/inbox outbox with the .ics inline.
    await db.outboxMessage.create({
      data: { channel: "email", to: opts.to.email, subject: opts.subject, body: `${opts.summary}\n\n--- invite.ics ---\n${opts.ics}` },
    });
    return { ref: `mock_cal_${opts.uid}` };
  }
}

export const email: EmailProvider = new MockEmail();
export const calendar: CalendarProvider = new MockCalendar();
export const sms: SmsProvider = new MockSms();

/** Stripe for most countries, Razorpay for India — both mocked in dev. */
export function paymentProviderFor(country: string): PaymentProvider {
  void country; // real impl: country === "IN" ? razorpay : stripe
  return new MockPayments();
}
