// index.js
const EmeraldClient = require('./lib/EmeraldClient');
const EmeraldHwsAccessory = require('./lib/EmeraldHwsAccessory');

const PLATFORM_NAME = 'EmeraldHws';
const PLUGIN_NAME = 'homebridge-emerald-hws';

class EmeraldHwsPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = new Map();
    this.client = null;

    if (!config || !config.email || !config.password) {
      this.log.error('EmeraldHws: email and password required.');
      return;
    }

    this.client = new EmeraldClient(this.log, config);
    this.pollInterval = Math.max(config.pollInterval || 60, 15);

    api.on('didFinishLaunching', () => {
      this.log.info('EmeraldHws: discovering devices...');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory) {
    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices() {
    let devices;
    try {
      devices = await this.client.discoverDevices();
    } catch(e) {
      this.log.error('Discover failed:', e.message);
      return;
    }

    const { uuid } = this.api.hap;

    for (const dev of devices) {
      const id = dev.id;
      const name = dev.name;
      const accUUID = uuid.generate('emerald-hws:' + id);
      let accessory = this.accessories.get(accUUID);

      if (!accessory) {
        accessory = new this.api.platformAccessory(name, accUUID);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(accUUID, accessory);
      }

      const wrapper = new EmeraldHwsAccessory(this, accessory, dev, this.client);
      this.startPolling(wrapper);
    }
  }

  startPolling(wrapper) {
    setInterval(() => wrapper.refreshFromCloud(), this.pollInterval * 1000);
  }
}

module.exports = api => api.registerPlatform(PLATFORM_NAME, EmeraldHwsPlatform);
