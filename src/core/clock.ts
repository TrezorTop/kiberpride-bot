// Time is injected so expiry and reconcilers are testable without waiting.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
