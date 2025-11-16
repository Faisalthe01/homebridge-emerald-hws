const { spawn } = require('child_process');
const path = require('path');

class EmeraldClient {
  constructor(log, config) {
    this.log = log;
    this.email = config.email;
    this.password = config.password;

    this.python = '/usr/bin/python3';
    this.scriptPath = path.join(__dirname, '..', 'python', 'emerald_daemon.py');

    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';

    this.startDaemon();
  }

  startDaemon() {
    const args = [
      this.python,
      this.scriptPath,
      '--email', this.email,
      '--password', this.password
    ];

    this.log.info('EmeraldHws: starting python daemon as homebridge user...');

    // ?? THIS FIXES EVERYTHING ??
    this.proc = spawn('sudo', ['-u', 'homebridge', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    //
    // STDOUT handler
    //
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();

      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;

        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          this.log.error('EmeraldHws: bad JSON from python:', line);
          continue;
        }

        const entry = this.pending.get(msg.id);
        if (!entry) continue;

        this.pending.delete(msg.id);

        if (msg.ok === false) entry.reject(new Error(msg.error || 'Python error'));
        else entry.resolve(msg.result);
      }
    });

    //
    // STDERR (debug only)
    //
    this.proc.stderr.on('data', (chunk) => {
      const t = chunk.toString().trim();
      if (t) this.log.debug('emerald-hws(py):', t);
    });

    //
    // EXIT HANDLER
    //
    this.proc.on('exit', (code, signal) => {
      this.log.error(`EmeraldHws: python daemon exited (code=${code}, signal=${signal})`);
      for (const { reject } of this.pending.values()) {
        reject(new Error('Python daemon exited'));
      }
      this.pending.clear();
    });
  }

  sendCommand(cmd, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.proc || this.proc.killed)
        return reject(new Error('Python daemon not running'));

      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ id, cmd, ...payload }) + '\n';

      this.proc.stdin.write(msg, 'utf8', (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async discoverDevices() {
    return this.sendCommand('discover');
  }

  async getStatus(id) {
    return this.sendCommand('status', { hws_id: id });
  }

  async setMode(id, mode) {
    return this.sendCommand('set_mode', { hws_id: id, mode });
  }

  async turnOn(id) {
    return this.sendCommand('turn_on', { hws_id: id });
  }

  async turnOff(id) {
    return this.sendCommand('turn_off', { hws_id: id });
  }
}

module.exports = EmeraldClient;
