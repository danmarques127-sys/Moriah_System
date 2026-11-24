// Minimal SMTP client (no dependencies). Configure with SMTP_HOST, SMTP_PORT (465 = TLS, otherwise STARTTLS), SMTP_USER, SMTP_PASS, SMTP_FROM.
import net from 'node:net';
import tls from 'node:tls';

export function mailConfig(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  return {host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM || env.SMTP_USER};
}
const LOCAL = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/;
function reader(socket) {
  let buf = '', waiting = null, error = null;
  socket.setEncoding('utf8');
  const extract = () => {
    const lines = buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
      const text = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n'); return {code: Number(text.slice(0, 3)), text};
    }
    return null;
  };
  const pump = () => { if (!waiting) return; if (error) { const w = waiting; waiting = null; return w.reject(error); } const r = extract(); if (r) { const w = waiting; waiting = null; w.resolve(r); } };
  socket.on('data', d => { buf += d; pump(); });
  socket.on('error', e => { error = e; pump(); });
  socket.on('close', () => { error ||= new Error('SMTP connection closed.'); pump(); });
  return {read: () => new Promise((resolve, reject) => { waiting = {resolve, reject}; pump(); })};
}
const enc = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s).toString('base64') + '?=';
export async function sendMail({to, subject, text}, config = mailConfig(), {timeoutMs = 20000} = {}) {
  if (!config) return {sent: false, reason: 'E-mail não configurado (defina SMTP_HOST, SMTP_USER e SMTP_PASS).'};
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(to))) return {sent: false, reason: 'Endereço de e-mail inválido.'};
  let socket = config.port === 465 ? tls.connect({host: config.host, port: 465, servername: config.host}) : net.connect({host: config.host, port: config.port});
  const timer = setTimeout(() => socket.destroy(new Error('SMTP timeout.')), timeoutMs);
  try {
    let io = reader(socket);
    const expect = async (codes, label) => { const r = await io.read(); if (!codes.includes(r.code)) throw new Error('SMTP ' + label + ': ' + r.text.slice(0, 200)); return r; };
    const cmd = async (line, codes, label) => { socket.write(line + '\r\n'); return expect(codes, label); };
    await expect([220], 'greeting');
    let ehlo = await cmd('EHLO moriah.local', [250], 'EHLO');
    if (config.port !== 465) {
      if (/STARTTLS/i.test(ehlo.text)) {
        await cmd('STARTTLS', [220], 'STARTTLS');
        socket = tls.connect({socket, servername: config.host}); io = reader(socket);
        await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
        ehlo = await cmd('EHLO moriah.local', [250], 'EHLO');
      } else if (!LOCAL.test(config.host)) throw new Error('O servidor SMTP não oferece criptografia; envio cancelado.');
    }
    await cmd('AUTH LOGIN', [334], 'AUTH');
    await cmd(Buffer.from(config.user).toString('base64'), [334], 'usuário');
    await cmd(Buffer.from(config.pass).toString('base64'), [235], 'senha');
    await cmd('MAIL FROM:<' + config.from.replace(/.*<|>.*/g, '') + '>', [250], 'MAIL FROM');
    await cmd('RCPT TO:<' + to + '>', [250, 251], 'RCPT TO');
    await cmd('DATA', [354], 'DATA');
    const body = Buffer.from(String(text).replace(/\r?\n/g, '\r\n')).toString('base64').replace(/(.{76})/g, '$1\r\n');
    const msg = ['From: ' + config.from, 'To: ' + to, 'Subject: ' + enc(String(subject).replace(/[\r\n]+/g, ' ')), 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
    await cmd(msg + '\r\n.', [250], 'mensagem');
    socket.write('QUIT\r\n');
    return {sent: true};
  } catch (e) { return {sent: false, reason: String(e.message).slice(0, 300)}; }
  finally { clearTimeout(timer); socket.destroy(); }
}
