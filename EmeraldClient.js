// lib/EmeraldClient.js
const { spawn } = require('child_process');
const path = require('path');

class EmeraldClient {
  constructor(log, config) {
    this.log = log;
    this.email = config.email;
    this.password = config.password;
    this.python = config.pythonPath || 'python3';
    this.cli = path.join(__dirname, '..', 'python', 'emerald_cli.py');
  }

  run(args) {
    return new Promise((resolve, reject) => {
      const full = [this.cli, '--email', this.email, '--password', this.password, ...args];
      const child = spawn(this.python, full);
      let out='', err='';

      child.stdout.on('data', d => out += d.toString());
      child.stderr.on('data', d => err += d.toString());

      child.on('close', code => {
        if (code !== 0) return reject(new Error(err));
        try { resolve(JSON.parse(out)); }
        catch(e){ reject(e); }
      });
    });
  }

  discoverDevices() {
    return this.run(['discover']).then(r => r.devices);
  }

  getStatus(id) {
    return this.run(['status', '--id', id]);
  }

  setAction(id, action) {
    return this.run(['set', '--id', id, '--action', action]);
  }
}

module.exports = EmeraldClient;
