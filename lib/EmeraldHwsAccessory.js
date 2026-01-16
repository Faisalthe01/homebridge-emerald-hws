let Service, Characteristic;

class EmeraldHwsAccessory {
    constructor(platform, accessory, device, initialStatus, client) {

        Service = platform.api.hap.Service;
        Characteristic = platform.api.hap.Characteristic;

        this.platform = platform;
        this.log = platform.log;
        this.client = client;
        this.accessory = accessory;
        this.device = device;
        this.name = "Emerald HWS";

        this.pollTimer = null;
        this.isPolling = false;
        
        // NEW: Flag to silence logs during scheduled restarts
        this.maintenanceMode = false;

        this.last = {
            online: null,
            power: null,
            mode: null,
            currTemp: null,
            setTemp: null,
            waterLevel: null,
            fw: null,
            heatingState: null,
        };

        // Pending UI overrides (to stop bounce-back after commands)
        this.pending = {
            active: null, 
            boost: null,
        };

        //
        // ACCESSORY INFO
        //
        const info = accessory.getService(Service.AccessoryInformation);
        info.setCharacteristic(Characteristic.Manufacturer, "Emerald");
        info.setCharacteristic(Characteristic.Model, "HWS");
        info.setCharacteristic(Characteristic.SerialNumber, device.name);
        info.setCharacteristic(Characteristic.Name, this.name);

        //
        // FIRMWARE INIT
        //
        let fwSet = false;

        if (initialStatus && typeof initialStatus.soft_version === "string") {
            const fw = initialStatus.soft_version.replace(/^V/i, "");
            info.setCharacteristic(Characteristic.FirmwareRevision, fw);
            this.last.fw = fw;

            if (this.accessory.context.firmware !== fw) {
                this.accessory.context.firmware = fw;
                fwSet = true;
            }

        } else if (this.accessory.context.firmware) {
            const fw = this.accessory.context.firmware;
            info.setCharacteristic(Characteristic.FirmwareRevision, fw);
            this.last.fw = fw;

        } else {
            info.setCharacteristic(Characteristic.FirmwareRevision, "0.0");
            this.last.fw = "0.0";
        }

        if (fwSet) {
            this.platform.api.updatePlatformAccessories([this.accessory]);
        }

        this.fwChar = info.getCharacteristic(Characteristic.FirmwareRevision);

        //
        // HEATER COOLER TILE
        //
        this.hc =
            accessory.getService(Service.HeaterCooler) ||
            accessory.addService(Service.HeaterCooler, this.name);

        this.hc.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({
                validValues: [Characteristic.TargetHeaterCoolerState.HEAT]
            })
            .updateValue(Characteristic.TargetHeaterCoolerState.HEAT);

        this.hc.getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({
                minValue: 30,
                maxValue: 80,
                minStep: 1,
                perms: [
                    Characteristic.Perms.READ,
                    Characteristic.Perms.NOTIFY
                ]
            });
        this.hc.getCharacteristic(Characteristic.Active)
            .onSet(this.setActive.bind(this));

        //
        // WATER LEVEL SENSOR
        //
        const waterName = "Water Level";

        this.water =
            accessory.getService("Water Level") ||
            accessory.addService(
                Service.HumiditySensor,
                waterName,
                "water-level"
            );

        this.water.setCharacteristic(Characteristic.ConfiguredName, waterName);
        this.water.setCharacteristic(Characteristic.Name, waterName);

        //
        // BOOST SWITCH
        //
        const boostName = "Boost Mode";

        this.boost =
            accessory.getService("Boost Mode") ||
            accessory.addService(
                Service.Switch,
                boostName,
                "boost-mode"
            );

        this.boost.setCharacteristic(Characteristic.ConfiguredName, boostName);
        this.boost.setCharacteristic(Characteristic.Name, boostName);

        this.boost.getCharacteristic(Characteristic.On)
            .onSet(this.setBoost.bind(this));

        //
        // START POLL LOOP
        //
        this.startMainPollLoop();
    }

    //
    // MAIN POLL LOOP
    //
    startMainPollLoop() {
        if (this.pollTimer) clearTimeout(this.pollTimer);

        if (this.isPolling) return;

        this.isPolling = true;

        this.refreshFromCloud()
            .catch(err => this.log.error(`POLL ERROR: ${err.message}`))
            .finally(() => {
                const interval = (this.platform.pollInterval || 15) * 1000;

                this.pollTimer = setTimeout(
                    () => this.startMainPollLoop(),
                    interval
                );

                this.isPolling = false;
            });
    }

    //
    // POWER CONTROL
    //
    async setActive(v) {
        if (this.pollTimer) clearTimeout(this.pollTimer);

        const on = (v === Characteristic.Active.ACTIVE);
        this.log.info(`Hot Water Power Command: ${on ? "ON" : "OFF"}`);

        this.pending.active = on;

        this.hc.updateCharacteristic(
            Characteristic.Active,
            on ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE
        );

        setTimeout(() => {
            this.pending.active = null;
        }, 3000);

        try {
            if (on) await this.client.turnOn(this.device.id);
            else await this.client.turnOff(this.device.id);

        } catch (e) {
            this.log.error("Failed to toggle power:", e.message);
            setTimeout(() => {
                this.hc.updateCharacteristic(Characteristic.Active, !on);
            }, 150);
        }

        this.startMainPollLoop();
    }

    //
    // BOOST CONTROL
    //
    async setBoost(v) {
        if (this.pollTimer) clearTimeout(this.pollTimer);

        if (!this.last.power) {
            this.log.warn("Boost ignored - HWS is OFF");
            setTimeout(() => {
                this.boost.updateCharacteristic(Characteristic.On, false);
            }, 100);
            return;
        }

        this.log.info(v ? "Boost Mode ON" : "Normal Mode ON");

        try {
            if (v) {
                await this.client.setMode(this.device.id, 0);
                this.last.mode = 0;
            } else {
                await this.client.setMode(this.device.id, 1);
                this.last.mode = 1;
            }
        } catch (e) {
            this.log.error("Failed to set mode:", e.message);
            setTimeout(() => {
                this.boost.updateCharacteristic(Characteristic.On, !v);
            }, 150);
        }

        setTimeout(() => this.startMainPollLoop(), 2000);
    }


    //
    // REFRESH FROM CLOUD — OFFLINE/ONLINE SAFE
    //
    async refreshFromCloud() {
        let data;
        let state;

        try {
            data = await this.client.getStatus(this.device.id);
            state = data.last_state || {};
        } catch (e) {

            // DETECT MAINTENANCE RESTART
            const isDaemonRestart = e.message && (
                e.message.includes('Daemon exited') || 
                e.message.includes('Python daemon starting')
            );

            if (isDaemonRestart) {
                // Mark this as maintenance so we stay silent when we come back
                this.maintenanceMode = true;
            } else {
                // If this is a real error, mark maintenance as false
                this.maintenanceMode = false;

                if (this.last.online !== 0) {
                    this.log.warn(`HWS OFFLINE - API failed: ${e.message}`);
                }
            }

            this.last.online = 0;

            const err = new Error("No Response");
            err.code = -70402;

            try {
                this.hc.updateCharacteristic(Characteristic.Active, err);
                this.hc.updateCharacteristic(Characteristic.CurrentTemperature, err);
                this.hc.updateCharacteristic(Characteristic.CurrentHeaterCoolerState, err);
                this.hc.updateCharacteristic(Characteristic.HeatingThresholdTemperature, err);
                this.hc.updateCharacteristic(Characteristic.TargetHeaterCoolerState, err);

                this.water.updateCharacteristic(Characteristic.CurrentRelativeHumidity, err);
                this.boost.updateCharacteristic(Characteristic.On, err);
            } catch {}
            return;
        }

        const onlineFlag = (data.is_online === 1 || data.is_online === "1");

        if (!onlineFlag) {
            if (this.last.online !== 0) {
                this.log.warn(`HWS OFFLINE (is_online=${data.is_online})`);
            }

            // Real offline state -> Clear maintenance flag
            this.maintenanceMode = false;
            this.last.online = 0;

            const err = new Error("No Response");
            err.code = -70402;

            try {
                this.hc.updateCharacteristic(Characteristic.Active, err);
                this.hc.updateCharacteristic(Characteristic.CurrentTemperature, err);
                this.hc.updateCharacteristic(Characteristic.CurrentHeaterCoolerState, err);
                this.hc.updateCharacteristic(Characteristic.HeatingThresholdTemperature, err);
                this.hc.updateCharacteristic(Characteristic.TargetHeaterCoolerState, err);

                this.water.updateCharacteristic(Characteristic.CurrentRelativeHumidity, err);
                this.boost.updateCharacteristic(Characteristic.On, err);

            } catch {}

            return;
        }

        // LOGIC: Only log "ONLINE" if it wasn't a maintenance restart
        if (this.last.online !== 1) {
            if (!this.maintenanceMode) {
                this.log.info(`HWS ONLINE - restoring HomeKit (is_online=${data.is_online})`);
            } else {
                // It was maintenance, so we recover silently
                this.log.debug(`HWS ONLINE (Silent Recovery)`);
            }
        }

        // Reset flag and update status
        this.maintenanceMode = false;
        this.last.online = 1;

        //
        // FIRMWARE UPDATE
        //
        if (data.soft_version) {
            const fw = data.soft_version.replace(/^V/i, "");
            if (fw !== this.last.fw) {
                this.fwChar.updateValue(fw);
                this.accessory.context.firmware = fw;
                this.last.fw = fw;
                this.platform.api.updatePlatformAccessories([this.accessory]);
            }
        }

        //
        // NORMAL DATA
        //
        const isOn = state.switch === "on" || state.switch === 1;
        const mode = state.mode;
        const currTemp = state.temp_current || 0;
        const setTemp = state.temp_set || 0;

        if (isOn !== this.last.power) {
            this.log.warn(`Power changed: ${isOn ? "ON" : "OFF"}`);
            this.last.power = isOn;
        }

        if (mode !== this.last.mode) {
            this.log.warn(`Mode changed: ${mode === 0 ? "BOOST" : "NORMAL"}`);
            this.last.mode = mode;
        }

        if (currTemp !== this.last.currTemp) {
            this.log.warn(`Water Temperature: ${currTemp} C`);
            this.last.currTemp = currTemp;
        }

        if (setTemp !== this.last.setTemp) {
            this.log.warn(`Target Temperature: ${setTemp} C`);
            this.last.setTemp = setTemp;
        }

        let level;

        if (currTemp >= 54) level = 100;
        else if (currTemp >= 48) level = 80;
        else if (currTemp >= 42) level = 60;
        else if (currTemp >= 35) level = 40;
        else if (currTemp >= 25) level = 20; 
        else if (currTemp >= 23) level = 10; 
        else if (currTemp >= 18) level = 8;
        else level = 5;

        if (level !== this.last.waterLevel) {
            this.log.warn(`Water Level: ${level}%`);
            this.last.waterLevel = level;
        }

        this.water.updateCharacteristic(
            Characteristic.CurrentRelativeHumidity,
            level
        );

        if (!this.pending || this.pending.active === null) {
            this.hc.updateCharacteristic(
                Characteristic.Active,
                isOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE
            );
        }

        // HEATING/IDLE
        let heatingState;
        if (!isOn) {
            heatingState = Characteristic.CurrentHeaterCoolerState.INACTIVE;
        } else {
            if (typeof data.device_operation_status === "number" && data.device_operation_status === 1) {
                heatingState = Characteristic.CurrentHeaterCoolerState.HEATING;
            } else {
                heatingState = Characteristic.CurrentHeaterCoolerState.IDLE;
            }
        }

        if (heatingState !== this.last.heatingState) {
            const readable =
                heatingState === Characteristic.CurrentHeaterCoolerState.HEATING
                    ? "HEATING"
                    : heatingState === Characteristic.CurrentHeaterCoolerState.IDLE
                        ? "IDLE"
                        : "INACTIVE";

            this.log.warn(`Heating State: ${readable}`);
            this.last.heatingState = heatingState;
        }

        this.hc.updateCharacteristic(
            Characteristic.CurrentHeaterCoolerState,
            heatingState
        );

        this.hc.updateCharacteristic(
            Characteristic.CurrentTemperature,
            currTemp
        );

        this.hc.updateCharacteristic(
            Characteristic.HeatingThresholdTemperature,
            setTemp
        );

        this.hc.updateCharacteristic(
            Characteristic.TargetHeaterCoolerState,
            Characteristic.TargetHeaterCoolerState.HEAT
        );

        if (!this.pending || this.pending.boost === null) {
            const boostActive = isOn && mode === 0;
            this.boost.updateCharacteristic(
                Characteristic.On,
                boostActive
            );
        }
    }
}

module.exports = EmeraldHwsAccessory;
