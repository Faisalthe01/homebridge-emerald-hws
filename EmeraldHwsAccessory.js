// lib/EmeraldHwsAccessory.js

class EmeraldHwsAccessory {
  constructor(platform, accessory, device, client) {
    this.platform = platform;
    this.accessory = accessory;
    this.client = client;
    this.log = platform.log;
    this.id = device.id;
    this.state = {
      isOn: device.is_on,
      mode: device.mode,
      currentTemp: device.current_temperature,
      targetTemp: device.target_temperature,
      isHeating: device.is_heating
    };

    const { Service, Characteristic } = platform.api.hap;

    this.info = accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, device.brand || 'Emerald')
      .setCharacteristic(Characteristic.Model, 'HWS')
      .setCharacteristic(Characteristic.SerialNumber, device.serial_number || this.id);

    this.heater = accessory.getService(Service.HeaterCooler) ||
                  accessory.addService(Service.HeaterCooler, device.name);

    this.boost = accessory.getServiceById(Service.Switch, 'boost') ||
                 accessory.addService(Service.Switch, device.name + ' Boost', 'boost');

    this.eco = accessory.getServiceById(Service.Switch, 'eco') ||
               accessory.addService(Service.Switch, device.name + ' Eco', 'eco');

    // HeaterCooler characteristics
    this.heater.getCharacteristic(Characteristic.Active)
      .onGet(() => this.state.isOn ? 1 : 0)
      .onSet(v => this.setPower(v === 1));

    this.heater.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(() => this.state.currentTemp || 0);

    this.heater.getCharacteristic(Characteristic.TargetTemperature)
      .onGet(() => this.state.targetTemp || 50)
      .onSet(() => {}); // ignore changes

    this.heater.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [1] })
      .onGet(() => 1)
      .onSet(() => {}); // locked to HEAT

    this.heater.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(() => {
        if (!this.state.isOn) return 0;
        if (this.state.isHeating) return 2;
        return 1;
      });

    // Boost switch
    this.boost.getCharacteristic(Characteristic.On)
      .onGet(() => this.state.mode === 0)
      .onSet(v => this.setMode(v ? 'boost' : 'normal'));

    // Eco switch
    this.eco.getCharacteristic(Characteristic.On)
      .onGet(() => this.state.mode === 2)
      .onSet(v => this.setMode(v ? 'eco' : 'normal'));
  }

  async setPower(on) {
    const action = on ? 'on' : 'off';
    const res = await this.client.setAction(this.id, action);
    this.apply(res);
  }

  async setMode(mode) {
    const res = await this.client.setAction(this.id, mode);
    this.apply(res);
  }

  apply(s) {
    this.state.isOn = s.is_on;
    this.state.mode = s.mode;
    this.state.currentTemp = s.current_temperature;
    this.state.targetTemp = s.target_temperature;
    this.state.isHeating = s.is_heating;

    const { Characteristic } = this.platform.api.hap;
    this.heater.updateCharacteristic(Characteristic.Active, this.state.isOn ? 1:0);
    this.heater.updateCharacteristic(Characteristic.CurrentTemperature, this.state.currentTemp);
    this.heater.updateCharacteristic(Characteristic.TargetTemperature, this.state.targetTemp);

    this.boost.updateCharacteristic(Characteristic.On, this.state.mode === 0);
    this.eco.updateCharacteristic(Characteristic.On, this.state.mode === 2);
  }

  async refreshFromCloud() {
    const res = await this.client.getStatus(this.id);
    this.apply(res);
  }
}

module.exports = EmeraldHwsAccessory;
