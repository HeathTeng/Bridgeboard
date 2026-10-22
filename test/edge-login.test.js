import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookiesForHost, cookieHeader } from '../lib/edge-login.js';

test('keeps only cookies a request to the Blackboard host would carry', () => {
  const all = [
    { name: 'BbRouter', value: 'a', domain: 'school.blackboard.com' },
    { name: 'AWSALB', value: 'b', domain: '.blackboard.com' },
    { name: 'ESTSAUTH', value: 'c', domain: 'login.microsoftonline.com' },
    { name: 'x', value: 'd', domain: 'evilblackboard.com' },
  ];
  const mine = cookiesForHost(all, 'school.blackboard.com');
  assert.deepEqual(mine.map((c) => c.name), ['BbRouter', 'AWSALB']);
  assert.equal(cookieHeader(mine), 'BbRouter=a; AWSALB=b');
});
