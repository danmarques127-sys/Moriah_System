import test from 'node:test';
import assert from 'node:assert/strict';
import {deliver, formspreeUrl} from '../src/mailer.mjs';

const msg = {to: 'a@b.co', subject: 'S', text: 'T'};
const URL = 'https://formspree.io/f/abc123';
test('falls back to Formspree when SMTP is not configured', async () => {
  let call;
  const r = await deliver(msg, null, {FORMSPREE_URL: URL}, {post: async (u, o) => { call = {u, o}; return {ok: true}; }});
  assert.equal(r.sent, true); assert.equal(call.u, URL);
  assert.equal(JSON.parse(call.o.body)._subject, 'S');
});
test('SMTP success never touches Formspree', async () => {
  const r = await deliver(msg, {x: 1}, {FORMSPREE_URL: URL}, {smtp: async () => ({sent: true}), post: async () => { throw new Error('no'); }});
  assert.equal(r.sent, true);
});
test('SMTP failure then Formspree failure reports both', async () => {
  const r = await deliver(msg, {x: 1}, {FORMSPREE_URL: URL}, {smtp: async () => ({sent: false, reason: 'bad auth'}), post: async () => ({ok: false, status: 500})});
  assert.equal(r.sent, false); assert.match(r.reason, /bad auth.*500/);
});
test('Formspree can be disabled or invalid', () => {
  assert.equal(formspreeUrl({FORMSPREE_URL: 'off'}), null);
  assert.equal(formspreeUrl({FORMSPREE_URL: 'https://evil.example/f/x'}), null);
});
