import type { Channel } from './notification.js';
import { ValidationError } from './errors.js';

interface Rule {
  pattern: RegExp;
  message: string;
}

// Kept out of the spec on purpose: a oneOf + discriminator there produces unreadable
// validator errors. The rules are documented in the spec's recipient description.
const rules: Record<Channel, Rule> = {
  // Pragmatic, not full RFC 5322: something@something.tld with no whitespace.
  email: { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'must be an email address like name@example.com' },
  // E.164: '+', a non-zero country code digit, at most 15 digits in total.
  sms: { pattern: /^\+[1-9]\d{1,14}$/, message: 'must be an E.164 phone number like +14155550123' },
  push: { pattern: /^\S+$/, message: 'must be a device token without whitespace' },
};

export function validateRecipient(channel: Channel, recipient: string): void {
  const rule = rules[channel];
  if (!rule.pattern.test(recipient)) {
    throw new ValidationError([{ path: '/body/recipient', message: `${rule.message} for channel ${channel}` }]);
  }
}
