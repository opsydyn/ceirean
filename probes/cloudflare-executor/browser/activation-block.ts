import { expect } from '@playwright/test';

export default function blockHostedActivation() {
  expect('Blocked', 'HostedActivationBlocked: source preparation is not execution approval').toBe(
    'Approved',
  );
}
