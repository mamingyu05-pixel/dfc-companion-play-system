const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const deps = createRequire(path.resolve(__dirname, '../apps/api-server/package.json'));

test('the patched mail library builds the registration message without an SMTP connection', async () => {
  const nodemailer = deps('nodemailer');
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const result = await transport.sendMail({
    from: 'DFC <sender@synthetic.invalid>', to: 'recipient@synthetic.invalid',
    subject: 'DFC synthetic registration', text: 'Synthetic verification message',
    html: '<p>Synthetic verification message</p>'
  });
  assert.ok(Buffer.isBuffer(result.message));
  const mime = result.message.toString('utf8');
  assert.match(mime, /recipient@synthetic\.invalid/);
  assert.match(mime, /multipart\/alternative/);
  assert.match(mime, /Synthetic verification message/);
  assert.equal(typeof result.messageId, 'string');
});
