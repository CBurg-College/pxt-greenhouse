input.onButtonPressed(Button.A, function () {
    CBreedingBox.pump(CBreedingBox.State.on)
})
input.onButtonPressed(Button.B, function () {
    CBreedingBox.pump(CBreedingBox.State.off)
})

namespace ESP8266 {
    /*
    The ESP8266 code is copied from the ElecFreaks 'esp8266-iot.ts' library:
    https://github.com/elecfreaks/pxt-iot-environment-kit/blob/master/esp8266-iot.ts
    (MIT-license)
    */

    enum Cmd {
        None,
        ConnectWifi,
        ConnectThingSpeak,
        ConnectSmartIot,
        InitSmartIot,
        UploadSmartIot,
        DisconnectSmartIot,
        ConnectMqtt,
    }

    export enum SmartIotSwitchState {
        //% block="on"
        on = 1,
        //% block="off"
        off = 2
    }

    export enum SchemeList {
        //% block="TCP"
        TCP = 1,
        //% block="TLS"
        TLS = 2
    }

    export enum QosList {
        //% block="0"
        Qos0 = 0,
        //% block="1"
        Qos1,
        //% block="2"
        Qos2
    }

    let wifi_connected: boolean = false
    let thingspeak_connected: boolean = false
    let smartiot_connected: boolean = false
    let mqttBrokerConnected: boolean = false
    let userToken_def: string = ""
    let topic_def: string = ""
    const mqttSubscribeHandlers: { [topic: string]: (message: string) => void } = {}
    const mqttSubscribeQos: { [topic: string]: number } = {}
    let mqtthost_def = "ELECFREAKS"
    let iftttkey_def = ""
    let iftttevent_def = ""
    let thingSpeakDatatemp = ""

    let serialCnt = 0
    let recvString = ""
    let scanWIFIAPFlag = 0
    let currentCmd: Cmd = Cmd.None

    const THINGSPEAK_HOST = "api.thingspeak.com"
    const THINGSPEAK_PORT = "80"
    const SMARTIOT_HOST = "47.239.108.37"
    const SMARTIOT_PORT = "8081"
    // export function change(a:any,b:any){
    //     SMARTIOT_HOST = a
    //     SMARTIOT_PORT = b
    // }

    const EspEventSource = 3000
    const EspEventValue = {
        None: Cmd.None,
        ConnectWifi: Cmd.ConnectWifi,
        ConnectThingSpeak: Cmd.ConnectThingSpeak,
        ConnectSmartIot: Cmd.ConnectSmartIot,
        InitSmartIot: Cmd.InitSmartIot,
        UploadSmartIot: Cmd.UploadSmartIot,
        DisconnectSmartIot: Cmd.DisconnectSmartIot,
        ConnectMqtt: Cmd.ConnectMqtt,
        PostIFTTT: 255
    }
    const SmartIotEventSource = 3100
    const SmartIotEventValue = {
        switchOn: SmartIotSwitchState.on,
        switchOff: SmartIotSwitchState.off
    }

    let TStoSendStr = ""

    // write AT command with CR+LF ending
    function sendAT(command: string, wait: number = 0) {
        serial.writeString(`${command}\u000D\u000A`)
        basic.pause(wait)
    }

    function restEsp8266() {

        sendAT("AT+RESTORE", 1000) // restore to factory settings
        sendAT("AT+RST", 1000) // rest
        serial.readString()
        sendAT("AT+CWMODE=1", 500) // set to STA mode
        sendAT("AT+SYSTIMESTAMP=1634953609130", 100) // Set local timestamp.
        sendAT(`AT+CIPSNTPCFG=1,8,"ntp1.aliyun.com","0.pool.ntp.org","time.google.com"`, 100)
        basic.pause(3000)
    }

    function scanWIFIAP(ssid: string) {

        let scanflag = 0
        let mscnt = 0
        recvString = " "
        sendAT(`AT+CWLAPOPT=1,2,-100,255`)
        sendAT(`AT+CWLAP`)
        while (!(scanflag)) {

            recvString = recvString + serial.readString()
            basic.pause(1)
            mscnt += 1
            if (mscnt >= 3000) {
                scanWIFIAPFlag = 0
                break
            }

            if (recvString.includes("+CWLAP:(")) {

                mscnt = 0
                recvString = recvString.slice(recvString.indexOf("+CWLAP:("))
                scanflag = 1
                while (1) {

                    recvString += serial.readString()
                    basic.pause(1)
                    mscnt += 1

                    // OLED.clear()
                    // OLED.writeStringNewLine(_recvString)
                    if (recvString.includes("OK") || mscnt >= 3000) {

                        if (mscnt >= 3000) {
                            scanWIFIAPFlag = 0
                        } else if (recvString.includes(ssid)) {
                            scanWIFIAPFlag = 1
                        } else {
                            scanWIFIAPFlag = 0
                        }
                        break
                    }
                }
            }

        }
        recvString = " "
    }

    /**
     * Initialize ESP8266 module
     */
    export function initWIFI(tx: SerialPin, rx: SerialPin, baudrate: BaudRate) {

        serial.redirect(tx, rx, BaudRate.BaudRate115200)
        basic.pause(100)
        serial.setTxBufferSize(128)
        serial.setRxBufferSize(128)
        restEsp8266()
    }

    /**
     * connect to Wifi router
     */
    export function connectWifi(ssid: string, pw: string) {

        while (1) {
            scanWIFIAP(ssid)
            if (scanWIFIAPFlag) {
                currentCmd = Cmd.ConnectWifi
                sendAT(`AT+CWJAP="${ssid}","${pw}"`) // connect to Wifi router
                control.waitForEvent(EspEventSource, EspEventValue.ConnectWifi)
                while (!wifi_connected) {
                    restEsp8266()
                    sendAT(`AT+CWJAP="${ssid}","${pw}"`)
                    control.waitForEvent(EspEventSource, EspEventValue.ConnectWifi)
                }
                break
            } else {
                restEsp8266()
                currentCmd = Cmd.ConnectWifi
                sendAT(`AT+CWJAP="${ssid}","${pw}"`)
                control.waitForEvent(EspEventSource, EspEventValue.ConnectWifi)
                if (wifi_connected) {
                    break
                }
            }
        }
    }

    /**
     * Warning: Deprecated.
     * Check if ESP8266 successfully connected to Wifi
     */
    export function wifiState(state: boolean) {
        return wifi_connected === state
    }

    /**
     * Connect to ThingSpeak
     */
    export function connectThingSpeak() {

        thingspeak_connected = true
        // connect to server
        // recvString = " "
        // serialCnt = 0
        // sendAT(`AT+CIPSTART="TCP","${THINGSPEAK_HOST}",${THINGSPEAK_PORT}`)
        // currentCmd = Cmd.ConnectThingSpeak
        // basic.pause(1)
        // recvString += serial.readString()
        // if (recvString == " ") {
        //     thingspeak_connected = false
        //     //basic.showIcon(IconNames.Sad)
        // } else {
        //     control.waitForEvent(EspEventSource, EspEventValue.ConnectThingSpeak)

        // } 
    }

    /**
     * Set data
     */
    export function setData(write_api_key: string, n1: number = 0, n2: number = 0, n3: number = 0, n4: number = 0, n5: number = 0, n6: number = 0, n7: number = 0, n8: number = 0) {

        TStoSendStr = "AT+HTTPCLIENT=2,0,\"http://api.thingspeak.com/update?api_key="
            + write_api_key
            + "&field1="
            + n1
            + "&field2="
            + n2
            + "&field3="
            + n3
            + "&field4="
            + n4
            + "&field5="
            + n5
            + "&field6="
            + n6
            + "&field7="
            + n7
            + "&field8="
            + n8
            + "\",,,1"
    }

    /**
     * upload data to ThingSpeak.
     */
    export function uploadData() {

        let mscnt2 = 0
        //sendAT(`AT+CIPSEND=${TStoSendStr.length + 2}`, 300)
        sendAT(TStoSendStr, 100) // upload data

        while (1) {
            recvString += serial.readString()
            basic.pause(1)
            mscnt2 += 1

            // OLED.clear()
            // OLED.writeStringNewLine(_recvString)
            if (recvString.includes("OK") || mscnt2 >= 3000 || recvString.includes("ERROR")) {

                break
            }
        }

        recvString = " "
        basic.pause(200)
    }

    /*
     * Check if ESP8266 successfully connected to ThingSpeak
     */
    export function thingSpeakState(state: boolean) {
        return thingspeak_connected === state
    }

    /* ----------------------------------- smartiot ----------------------------------- */
    /*
     * Connect to smartiot
     */
    export function connectSmartiot(userToken: string, topic: string): void {
        userToken_def = userToken
        topic_def = topic
        currentCmd = Cmd.ConnectSmartIot
        sendAT(`AT+CIPSTART="TCP","${SMARTIOT_HOST}",${SMARTIOT_PORT}`)
        control.waitForEvent(EspEventSource, EspEventValue.ConnectSmartIot)
        pause(100)
        const jsonText = `{"topic":"${topic}","userToken":"${userToken}","op":"init"}`
        currentCmd = Cmd.InitSmartIot
        sendAT(`AT+CIPSEND=${jsonText.length + 2}`)
        control.waitForEvent(EspEventSource, EspEventValue.InitSmartIot)
        if (smartiot_connected) {
            sendAT(jsonText)
            control.waitForEvent(EspEventSource, EspEventValue.InitSmartIot)
        }
        pause(1500)
    }

    /**
     * upload data to smartiot
     */
    export function uploadSmartiot(data: number): void {
        data = Math.floor(data)
        const jsonText2 = `{"topic":"${topic_def}","userToken":"${userToken_def}","op":"up","data":"${data}"}`
        currentCmd = Cmd.UploadSmartIot
        sendAT(`AT+CIPSEND=${jsonText2.length + 2}`)
        control.waitForEvent(EspEventSource, EspEventValue.UploadSmartIot)
        if (smartiot_connected) {
            sendAT(jsonText2)
            control.waitForEvent(EspEventSource, EspEventValue.UploadSmartIot)
        }
        pause(1500)
    }

    /*
     * disconnect from smartiot
     */
    export function disconnectSmartiot(): void {
        if (smartiot_connected) {
            const jsonText3 = `{"topic":"${topic_def}","userToken":"${userToken_def}","op":"close"}`
            currentCmd = Cmd.DisconnectSmartIot
            sendAT("AT+CIPSEND=" + (jsonText3.length + 2))
            control.waitForEvent(EspEventSource, EspEventValue.DisconnectSmartIot)
            if (smartiot_connected) {
                sendAT(jsonText3)
                control.waitForEvent(EspEventSource, EspEventValue.DisconnectSmartIot)
            }
            pause(1500)
        }
    }

    /*
     * Check if ESP8266 successfully connected to SmartIot
     */
    export function smartiotState(state: boolean) {
        return smartiot_connected === state
    }

    export function iotSwitchEvent(state: SmartIotSwitchState, handler: () => void) {
        control.onEvent(SmartIotEventSource, state, handler)
    }

    /*----------------------------------MQTT-----------------------*/
    /*
     * Set  MQTT client
     */
    export function setMQTT(scheme: SchemeList, clientID: string, username: string, password: string, path: string): void {
        sendAT(`AT+MQTTUSERCFG=0,${scheme},"${clientID}","${username}","${password}",0,0,"${path}"`, 1000)
    }

    /*
     * Connect to MQTT broker
     */
    export function connectMQTT(host: string, port: number, reconnect: boolean): void {
        mqtthost_def = host
        const rec = reconnect ? 0 : 1
        currentCmd = Cmd.ConnectMqtt
        sendAT(`AT+MQTTCONN=0,"${host}",${port},${rec}`)
        control.waitForEvent(EspEventSource, EspEventValue.ConnectMqtt)
        Object.keys(mqttSubscribeQos).forEach(topic => {
            const qos = mqttSubscribeQos[topic]
            sendAT(`AT+MQTTSUB=0,"${topic}",${qos}`, 1000)
        })
    }

    /*
     * Check if ESP8266 successfully connected to mqtt broker
     */
    export function isMqttBrokerConnected() {
        return mqttBrokerConnected
    }

    /*
     * send message
     */
    export function publishMqttMessage(msg: string, topic: string, qos: QosList): void {
        sendAT(`AT+MQTTPUB=0,"${topic}","${msg}",${qos},0`, 1000)
        recvString = ""
    }

    /*
     * disconnect MQTT broker
     */
    export function breakMQTT(): void {
        sendAT("AT+MQTTCLEAN=0", 1000)
    }

    export function MqttEvent(topic: string, qos: QosList, handler: (message: string) => void) {
        mqttSubscribeHandlers[topic] = handler
        mqttSubscribeQos[topic] = qos
    }

    ////////// ----------------------------------- IFTTT ----------------------------------- //////////
    /*
     * set ifttt
     */
    export function setIFTTT(key: string, event: string): void {
        iftttkey_def = key
        iftttevent_def = event
    }

    /*
     * post ifttt
     */
    export function postIFTTT(value1: string, value2: string, value3: string): void {
        let sendST1 = "AT+HTTPCLIENT=3,1,\"http://maker.ifttt.com/trigger/" + iftttevent_def + "/with/key/" + iftttkey_def + "\",,,2,"
        let sendST2 = "\"{\\\"value1\\\":\\\"" + value1 + "\\\"\\\,\\\"value2\\\":\\\"" + value2 + "\\\"\\\,\\\"value3\\\":\\\"" + value3 + "\\\"}\""
        let sendST = sendST1 + sendST2
        sendAT(sendST, 1000)
        //control.waitForEvent(EspEventSource, EspEventValue.PostIFTTT)
    }

    /*
     * on serial received data
     */
    serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
        recvString += serial.readString()
        pause(1)
        serialCnt += 1

        // received smart iot data
        if (recvString.includes("switchoff")) {
            recvString = ""
            control.raiseEvent(SmartIotEventSource, SmartIotEventValue.switchOff)
        } else if (recvString.includes("switchon")) {
            recvString = ""
            control.raiseEvent(SmartIotEventSource, SmartIotEventValue.switchOn)
        }

        if (recvString.includes("MQTTSUBRECV")) {
            recvString = recvString.slice(recvString.indexOf("MQTTSUBRECV"))
            const recvStringSplit = recvString.split(",", 4)
            const topic = recvStringSplit[1].slice(1, -1)
            const message = recvStringSplit[3].slice(0, -2)
            mqttSubscribeHandlers[topic] && mqttSubscribeHandlers[topic](message)
            recvString = ""
        }

        if (recvString.includes("Congratu")) {
            recvString = ""
            control.raiseEvent(EspEventSource, EspEventValue.PostIFTTT)
        }

        switch (currentCmd) {
            case Cmd.ConnectWifi:
                if (recvString.includes("AT+CWJAP")) {
                    recvString = recvString.slice(recvString.indexOf("AT+CWJAP"))
                    if (recvString.includes("WIFI GOT IP")) {
                        wifi_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectWifi)
                    } else if (recvString.includes("ERROR")) {
                        wifi_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectWifi)
                    }
                }
                break
            case Cmd.ConnectThingSpeak:
                if (recvString.includes(THINGSPEAK_HOST)) {
                    recvString = recvString.slice(recvString.indexOf(THINGSPEAK_HOST))
                    if (recvString.includes("CONNECT")) {
                        thingspeak_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectThingSpeak)
                    } else if (recvString.includes("ERROR")) {
                        thingspeak_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectThingSpeak)
                    }
                } else if (recvString.includes("WIFI GOT IP")) {
                    thingspeak_connected = false
                    recvString = ""
                    control.raiseEvent(EspEventSource, EspEventValue.ConnectThingSpeak)
                }
                break
            case Cmd.ConnectSmartIot:
                if (recvString.includes(SMARTIOT_HOST)) {
                    recvString = recvString.slice(recvString.indexOf(SMARTIOT_HOST))
                    if (recvString.includes("CONNECT")) {
                        smartiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectSmartIot)
                    } else if (recvString.includes("ERROR")) {
                        smartiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectSmartIot)
                    }
                }
                break
            case Cmd.InitSmartIot:
                if (recvString.includes("AT+CIPSEND")) {
                    recvString = recvString.slice(recvString.indexOf("AT+CIPSEND"))
                    if (recvString.includes("OK")) {
                        smartiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.InitSmartIot)
                    } else if (recvString.includes("ERROR")) {
                        smartiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.InitSmartIot)
                    }
                } else {
                    if (recvString.includes("SEND OK")) {
                        smartiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.InitSmartIot)
                    } else if (recvString.includes("ERROR")) {
                        smartiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.InitSmartIot)
                    }
                }
                break
            case Cmd.UploadSmartIot:
                if (recvString.includes("AT+CIPSEND")) {
                    recvString = recvString.slice(recvString.indexOf("AT+CIPSEND"))
                    if (recvString.includes("OK")) {
                        smartiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.UploadSmartIot)
                    } else if (recvString.includes("ERROR")) {
                        smartiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.UploadSmartIot)
                    }
                } else {
                    if (recvString.includes("SEND OK")) {
                        smartiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.UploadSmartIot)
                    } else if (recvString.includes("ERROR")) {
                        smartiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.UploadSmartIot)
                    }
                }
                break
            case Cmd.DisconnectSmartIot:
                if (recvString.includes("AT+CIPSEND")) {
                    recvString = recvString.slice(recvString.indexOf("AT+CIPSEND"))
                    if (recvString.includes("OK")) {
                        smartiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.DisconnectSmartIot)
                    } else if (recvString.includes("ERROR")) {
                        smartiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.DisconnectSmartIot)
                    }
                } else {
                    if (recvString.includes("SEND OK")) {
                        smartiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.DisconnectSmartIot)
                    } else if (recvString.includes("ERROR")) {
                        smartiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.DisconnectSmartIot)
                    }
                }
                break
            case Cmd.ConnectMqtt:
                if (recvString.includes(mqtthost_def)) {
                    recvString = recvString.slice(recvString.indexOf(mqtthost_def))
                    if (recvString.includes("OK")) {
                        mqttBrokerConnected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectMqtt)
                    } else if (recvString.includes("ERROR")) {
                        mqttBrokerConnected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectMqtt)
                    }
                }
                break
        }
    })
}

/*
The neopixel code is copied from the Microsoft 'neopixel.ts' library:
https://github.com/microsoft/pxt-neopixel
(MIT-license)
*/

enum NeoPixelMode {
    RGB = 1,
    RGBW = 2,
    RGB_RGB = 3
}

namespace neopixel {

    export class Strip {
        buf: Buffer;
        pin: DigitalPin;
        // TODO: encode as bytes instead of 32bit
        brightness: number;
        start: number; // start offset in LED strip
        _length: number; // number of LEDs
        _mode: NeoPixelMode;
        _matrixWidth: number; // number of leds in a matrix - if any

        showColor(rgb: number) {
            rgb = rgb >> 0;
            this.setAllRGB(rgb);
            this.show();
        }

        show() {
            // only supported in beta
            // ws2812b.setBufferMode(this.pin, this._mode);
            ws2812b.sendBuffer(this.buf, this.pin);
        }

        clear(): void {
            const stride = this._mode === NeoPixelMode.RGBW ? 4 : 3;
            this.buf.fill(0, this.start * stride, this._length * stride);
        }

        setBrightness(brightness: number): void {
            this.brightness = brightness & 0xff;
        }

        setPin(pin: DigitalPin): void {
            this.pin = pin;
            pins.digitalWritePin(this.pin, 0);
            // don't yield to avoid races on initialization
        }

        private setBufferRGB(offset: number, red: number, green: number, blue: number): void {
            if (this._mode === NeoPixelMode.RGB_RGB) {
                this.buf[offset + 0] = red;
                this.buf[offset + 1] = green;
            } else {
                this.buf[offset + 0] = green;
                this.buf[offset + 1] = red;
            }
            this.buf[offset + 2] = blue;
        }

        private setAllRGB(rgb: number) {
            let red = unpackR(rgb);
            let green = unpackG(rgb);
            let blue = unpackB(rgb);

            const br = this.brightness;
            if (br < 255) {
                red = (red * br) >> 8;
                green = (green * br) >> 8;
                blue = (blue * br) >> 8;
            }
            const end = this.start + this._length;
            const stride = this._mode === NeoPixelMode.RGBW ? 4 : 3;
            for (let i = this.start; i < end; ++i) {
                this.setBufferRGB(i * stride, red, green, blue)
            }
        }
    }

    export function create(pin: DigitalPin, numleds: number, mode: NeoPixelMode): Strip {
        let strip = new Strip();
        let stride = mode === NeoPixelMode.RGBW ? 4 : 3;
        strip.buf = pins.createBuffer(numleds * stride);
        strip.start = 0;
        strip._length = numleds;
        strip._mode = mode || NeoPixelMode.RGB;
        strip._matrixWidth = 0;
        strip.setBrightness(128)
        strip.setPin(pin)
        return strip;
    }

    function packRGB(a: number, b: number, c: number): number {
        return ((a & 0xFF) << 16) | ((b & 0xFF) << 8) | (c & 0xFF);
    }
    function unpackR(rgb: number): number {
        let r = (rgb >> 16) & 0xFF;
        return r;
    }
    function unpackG(rgb: number): number {
        let g = (rgb >> 8) & 0xFF;
        return g;
    }
    function unpackB(rgb: number): number {
        let b = (rgb) & 0xFF;
        return b;
    }
}

namespace BME280 {

    export let HUMIDITY: number = 0
    export let TEMPERATURE: number = 0
    export let PRESSURE: number = 0

    /*
    The BME280 code is taken from the ElecFreaks 'environment.ts' library:
    https://github.com/elecfreaks/pxt-iot-environment-kit/blob/master/environment.ts
    (MIT-license)
    */

    function setreg(reg: number, dat: number): void {
        let buf = pins.createBuffer(2);
        buf[0] = reg;
        buf[1] = dat;
        pins.i2cWriteBuffer(BME280_I2C_ADDR, buf);
    }

    function getreg(reg: number): number {
        pins.i2cWriteNumber(BME280_I2C_ADDR, reg, NumberFormat.UInt8BE);
        return pins.i2cReadNumber(BME280_I2C_ADDR, NumberFormat.UInt8BE);
    }

    function getInt8LE(reg: number): number {
        pins.i2cWriteNumber(BME280_I2C_ADDR, reg, NumberFormat.UInt8BE);
        return pins.i2cReadNumber(BME280_I2C_ADDR, NumberFormat.Int8LE);
    }

    function getUInt16LE(reg: number): number {
        pins.i2cWriteNumber(BME280_I2C_ADDR, reg, NumberFormat.UInt8BE);
        return pins.i2cReadNumber(BME280_I2C_ADDR, NumberFormat.UInt16LE);
    }

    function getInt16LE(reg: number): number {
        pins.i2cWriteNumber(BME280_I2C_ADDR, reg, NumberFormat.UInt8BE);
        return pins.i2cReadNumber(BME280_I2C_ADDR, NumberFormat.Int16LE);
    }

    let BME280_I2C_ADDR = 0x76

    let dig_T1 = getUInt16LE(0x88)
    let dig_T2 = getInt16LE(0x8A)
    let dig_T3 = getInt16LE(0x8C)
    let dig_P1 = getUInt16LE(0x8E)
    let dig_P2 = getInt16LE(0x90)
    let dig_P3 = getInt16LE(0x92)
    let dig_P4 = getInt16LE(0x94)
    let dig_P5 = getInt16LE(0x96)
    let dig_P6 = getInt16LE(0x98)
    let dig_P7 = getInt16LE(0x9A)
    let dig_P8 = getInt16LE(0x9C)
    let dig_P9 = getInt16LE(0x9E)

    let dig_H1 = getreg(0xA1)
    let dig_H2 = getInt16LE(0xE1)
    let dig_H3 = getreg(0xE3)
    let a = getreg(0xE5)
    let dig_H4 = (getreg(0xE4) << 4) + (a % 16)
    let dig_H5 = (getreg(0xE6) << 4) + (a >> 4)
    let dig_H6 = getInt8LE(0xE7)

    // Stores compensation values for Temperature (must be read from BME280 NVM)
    let digT1Val = 0
    let digT2Val = 0
    let digT3Val = 0

    // Stores compensation values for humidity (must be read from BME280 NVM)
    let digH1Val = 0
    let digH2Val = 0
    let digH3Val = 0
    let digH4Val = 0
    let digH5Val = 0
    let digH6Val = 0

    // Buffer to hold pressure compensation values to pass to the C++ compensation function
    let digPBuf: Buffer

    // BME Compensation Parameter Addresses for Temperature
    const digT1 = 0x88
    const digT2 = 0x8A
    const digT3 = 0x8C

    // BME Compensation Parameter Addresses for Pressure
    const digP1 = 0x8E
    const digP2 = 0x90
    const digP3 = 0x92
    const digP4 = 0x94
    const digP5 = 0x96
    const digP6 = 0x98
    const digP7 = 0x9A
    const digP8 = 0x9C
    const digP9 = 0x9E

    // BME Compensation Parameter Addresses for Humidity
    const digH1 = 0xA1
    const digH2 = 0xE1
    const digH3 = 0xE3
    const e5Reg = 0xE5
    const e4Reg = 0xE4
    const e6Reg = 0xE6
    const digH6 = 0xE7

    setreg(0xF2, 0x04)
    setreg(0xF4, 0x2F)
    setreg(0xF5, 0x0C)
    setreg(0xF4, 0x2F)

    export function measure(): void {
        let adc_T = (getreg(0xFA) << 12) + (getreg(0xFB) << 4) + (getreg(0xFC) >> 4)
        let var1 = (((adc_T >> 3) - (dig_T1 << 1)) * dig_T2) >> 11
        let var2 = (((((adc_T >> 4) - dig_T1) * ((adc_T >> 4) - dig_T1)) >> 12) * dig_T3) >> 14
        let t = var1 + var2
        TEMPERATURE = ((t * 5 + 128) >> 8) / 100
        var1 = (t >> 1) - 64000
        var2 = (((var1 >> 2) * (var1 >> 2)) >> 11) * dig_P6
        var2 = var2 + ((var1 * dig_P5) << 1)
        var2 = (var2 >> 2) + (dig_P4 << 16)
        var1 = (((dig_P3 * ((var1 >> 2) * (var1 >> 2)) >> 13) >> 3) + (((dig_P2) * var1) >> 1)) >> 18
        var1 = ((32768 + var1) * dig_P1) >> 15
        if (var1 == 0)
            return; // avoid exception caused by division by zero
        let adc_P = (getreg(0xF7) << 12) + (getreg(0xF8) << 4) + (getreg(0xF9) >> 4)
        let _p = ((1048576 - adc_P) - (var2 >> 12)) * 3125
        _p = (_p / var1) * 2;
        var1 = (dig_P9 * (((_p >> 3) * (_p >> 3)) >> 13)) >> 12
        var2 = (((_p >> 2)) * dig_P8) >> 13
        PRESSURE = _p + ((var1 + var2 + dig_P7) >> 4)
        let adc_H = (getreg(0xFD) << 8) + getreg(0xFE)
        var1 = t - 76800
        var2 = (((adc_H << 14) - (dig_H4 << 20) - (dig_H5 * var1)) + 16384) >> 15
        var1 = var2 * (((((((var1 * dig_H6) >> 10) * (((var1 * dig_H3) >> 11) + 32768)) >> 10) + 2097152) * dig_H2 + 8192) >> 14)
        var2 = var1 - (((((var1 >> 15) * (var1 >> 15)) >> 7) * dig_H1) >> 4)
        if (var2 < 0) var2 = 0
        if (var2 > 419430400) var2 = 419430400
        HUMIDITY = (var2 >> 12) / 1024
    }
}

namespace DHT22 {

    /*
    The DHT code is taken from an older version of the tjnkertanker library:
    https://github.com/tinkertanker/pxt-iot-environment-kit/releases/tag/v5.2.7
    (MIT-license)
    Note that the latest release does not work
    */

    let dataPin = DigitalPin.P14

    export let TEMPERATURE: number = 0
    export let HUMIDITY: number = 0
    export let SUCCESS: boolean = false

    export function setPin(pin: DigitalPin) {
        dataPin = pin
    }

    export function measure() {
        const DHT11_TIMEOUT = 100
        const buffer = pins.createBuffer(40)
        const data = [0, 0, 0, 0, 0]
        let startTime = control.micros()

        // TODO: V2 bug
        pins.digitalReadPin(DigitalPin.P0);
        pins.digitalReadPin(DigitalPin.P1);
        pins.digitalReadPin(DigitalPin.P2);
        pins.digitalReadPin(DigitalPin.P3);
        pins.digitalReadPin(DigitalPin.P4);
        pins.digitalReadPin(DigitalPin.P10);

        // 1.start signal
        pins.digitalWritePin(dataPin, 0)
        basic.pause(18)

        // 2.pull up and wait 40us
        pins.setPull(dataPin, PinPullMode.PullUp)
        pins.digitalReadPin(dataPin)
        control.waitMicros(40)

        // 3.read data
        startTime = control.micros()
        while (pins.digitalReadPin(dataPin) === 0) {
            if (control.micros() - startTime > DHT11_TIMEOUT) break
        }
        startTime = control.micros()
        while (pins.digitalReadPin(dataPin) === 1) {
            if (control.micros() - startTime > DHT11_TIMEOUT) break
        }

        for (let dataBits = 0; dataBits < 40; dataBits++) {
            startTime = control.micros()
            while (pins.digitalReadPin(dataPin) === 1) {
                if (control.micros() - startTime > DHT11_TIMEOUT) break
            }
            startTime = control.micros()
            while (pins.digitalReadPin(dataPin) === 0) {
                if (control.micros() - startTime > DHT11_TIMEOUT) break
            }
            control.waitMicros(28)
            if (pins.digitalReadPin(dataPin) === 1) {
                buffer[dataBits] = 1
            }
        }

        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 8; j++) {
                if (buffer[8 * i + j] === 1) {
                    data[i] += 2 ** (7 - j)
                }
            }
        }

        if (((data[0] + data[1] + data[2] + data[3]) & 0xff) === data[4]) {
            HUMIDITY = (data[0] << 8) | data[1]
            HUMIDITY *= 0.1
            TEMPERATURE = data[2] + data[3] * 0.1
        }
    }
}

//% color="#00CC00" icon="\uf1f9"
//% block="Breeding box"
//% block.loc.nl="Kweekbakje"
//% groups=['•']
namespace CBreedingBox {

    let PIN_SOIL = AnalogPin.P1
    let PIN_LIGHT = AnalogPin.P2
    DHT22.setPin(DigitalPin.P14)
    let NEOP = neopixel.create(DigitalPin.P15, 8, NeoPixelMode.RGB)
    let PIN_PUMP = DigitalPin.P16

    export let PUMP : number  = 0
    export let MOISTURE: number = 0
    export let LIGHT: number = 0

    export enum State {
        //% block="on"
        //% block.loc.nl="aan"
        on,
        //% block="on"
        //% block.loc.nl="uit"
        off
    }

    export enum Sensor {
        //% block="DHT22"
        //% block.loc.nl="DHT22"
        Dht22,
        //% block="BME280"
        //% block.loc.nl="BME280"
        Bme280,
        //% block="none"
        //% block.loc.nl="geen"
        None
    }

    export let SENSOR = Sensor.None

    export enum Color {
        //% block="red"
        //% block.loc.nl="rood"
        Red = 0xFF0000,
        //% block="orange"
        //% block.loc.nl="oranje"
        Orange = 0xFFA500,
        //% block="yellow"
        //% block.loc.nl="geel"
        Yellow = 0xFFFF00,
        //% block="green"
        //% block.loc.nl="groen"
        Green = 0x00FF00,
        //% block="blue"
        //% block.loc.nl="blauw"
        Blue = 0x0000FF,
        //% block="indigo"
        //% block.loc.nl="indigo"
        Indigo = 0x4b0082,
        //% block="violet"
        //% block.loc.nl="violet"
        Violet = 0x8a2be2,
        //% block="purple"
        //% block.loc.nl="paars"
        Purple = 0xFF00FF,
        //% block="white"
        //% block.loc.nl="wit"
        White = 0xFFFFFF,
        //% block="black"
        //% block.loc.nl="zwart"
        Black = 0x000000
    }


    export enum Measurement {
        //% block="temperature"
        //% block.loc.nl="temperatuur"
        Temperature = 0xFF0000,
        //% block="humitidy"
        //% block.loc.nl="luchtvochtigheid"
        Humidity = 0xFFA500,
        //% block="moisture"
        //% block.loc.nl="bodemvochtigheid"
        Moisture = 0xFFFF00,
        //% block="illuminance"
        //% block.loc.nl="verlichting"
        Illuminance = 0x00FF00
    }

    //% block="user %sensor"
    //% block.loc.nl="gebruik %sensor"
    export function useSensor(sensor: Sensor) {
        SENSOR = sensor
    }

    //% block="display %value"
    //% block.loc.nl="toon %value"
    export function display(value: Measurement) {
        let str = ""
        switch (value) {
            case Measurement.Temperature:
                basic.showString("T")
                str = Math.round( DHT22.TEMPERATURE).toString() + "C"
                break
            case Measurement.Humidity:
                basic.showString("R")
                str = Math.round( DHT22.HUMIDITY).toString() + "%"
                break;
            case Measurement.Moisture:
                basic.showString("M")
                str = MOISTURE.toString() + "%"
                break;
            case Measurement.Illuminance:
                basic.showString("L")
                str = LIGHT.toString() + "%"
                break;
        }
        basic.pause(500)
        basic.showString(" " + str)
    }

    //% block="perform a measurement"
    //% block.loc.nl="voer een meting uit"
    export function measure() {
        let voltL = pins.analogReadPin(PIN_LIGHT)
        let valueL = pins.map(voltL, 0, 1023, 0, 100)
        LIGHT = Math.round(valueL)

        // the moisture sensor gives values from 136 to 236
        // value 136 means fully soaken, 237 means fully dry
        let voltS = pins.analogReadPin(PIN_SOIL)
        if (voltS < 300) voltS = 300
        if (voltS > 750) voltS = 750
        let valueS = 100 - pins.map(voltS, 300, 750, 0, 100)
        MOISTURE = Math.round(valueS)

        switch (SENSOR) {
            case Sensor.Bme280: BME280.measure(); break;
            case Sensor.Dht22: DHT22.measure(); break;
        }
    }

    //% block="turn the pump %state"
    //% block.loc.nl="schakel de pomp %state"
    export function pump(state: State) {
        if (state == State.on) {
            pins.digitalWritePin(PIN_PUMP, 1)
            PUMP = 1
        }
        else {
            pins.digitalWritePin(PIN_PUMP, 0)
            PUMP = 0
        }
    }

    //% block="set the light color to %color with brightness %brightness \\%"
    //% block.loc.nl="stel de lichtkleur in op %color met helderheid %brightness \\%"
    //% brightness.min=0 brightness.max=100 brightness.defl=100
    export function setColor(color: Color, brightness: number) {
        NEOP.showColor(color);
        NEOP.setBrightness(brightness)
    }

    //% block="air pressure"
    //% block.loc.nl="luchtdruk"
    export function pressure(): number {
        if (SENSOR == Sensor.Bme280) return BME280.PRESSURE
        return 0 // value 0 means error
    }

    //% block="amount of light"
    //% block.loc.nl="hoeveelheid licht"
    export function light(): number {
        return LIGHT
    }

    //% block="bone-dry"
    //% block.loc.nl="kurkdroog"
    //% group="•"
    export function moisture0(): number {
        return 25
    }

    //% block="dry"
    //% block.loc.nl="droog"
    //% group="•"
    export function moisture1(): number {
        return 50
    }

    //% block="moist"
    //% block.loc.nl="vochtig"
    //% group="•"
    export function moisture2(): number {
        return 65
    }

    //% block="wet"
    //% block.loc.nl="nat"
    //% group="•"
    export function moisture3(): number {
        return 80
    }

    //% block="soaking"
    //% block.loc.nl="doornat"
    //% group="•"
    export function moisture4(): number {
        return 95
    }

    //% block="dark"
    //% block.loc.nl="donker"
    //% group="•"
    export function light0(): number {
        return 25
    }

    //% block="dusk"
    //% block.loc.nl="schemer"
    //% group="•"
    export function light1(): number {
        return 50
    }

    //% block="lucid"
    //% block.loc.nl="helder"
    //% group="•"
    export function light2(): number {
        return 65
    }

    //% block="bright"
    //% block.loc.nl="fel"
    //% group="•"
    export function light3(): number {
        return 80
    }

    //% block="off"
    //% block.loc.nl="uit"
    //% group="•"
    export function off(): number {
        return 0
    }

    //% block="on"
    //% block.loc.nl="aan"
    //% group="•"
    export function on(): number {
        return 100
    }

    //% block="moisture"
    //% block.loc.nl="grondvochtigheid"
    export function moisture(): number {
        return MOISTURE
    }

    //% block="humidity"
    //% block.loc.nl="luchtvochtigheid"
    export function humidity(): number {
        let val = 0
        if (SENSOR == Sensor.Bme280) val = BME280.HUMIDITY
        if (SENSOR == Sensor.Dht22) val = DHT22.HUMIDITY
        if (val < 0) return 0
        return val // value 0 means error
    }

    //% block="temperature"
    //% block.loc.nl="temperatuur"
    export function temperature(): number {
        let val = 0
        if (SENSOR == Sensor.Bme280) val = BME280.TEMPERATURE
        if (SENSOR == Sensor.Dht22) val = DHT22.TEMPERATURE
        if (val < 0) return 0
        return val // value 0 means error
    }
}

//% color="#FF8800" icon="\uf1f9"
//% block="Time"
//% block.loc.nl="Tijd"
namespace CTimer {

    //% block="wait %time seconds"
    //% block.loc.nl="wacht %time seconden"
    export function waitSec(time: number) {
        basic.pause(time * 1000);
    }

    //% block="wait %time minutes"
    //% block.loc.nl="wacht %time minuten"
    export function waitMin(time: number) {
        basic.pause(time * 60000);
    }

    //% block="wait %time hours"
    //% block.loc.nl="wacht %time uren"
    export function waitHours(time: number) {
        basic.pause(time * 3600000);
    }

    /*
    The next timer code is derived from:
    https://github.com/gbraad/pxt-interval
    */

    //% block="every %time seconds"
    //% block.loc.nl="om de %time seconden"
    export function OnEverySec(time: number, cb: () => void) {
        const myTimerID = 200 + Math.randomRange(0, 100); // semi-unique
        const timerTimeout1 = 1;

        control.onEvent(myTimerID, 0, function () {
            control.inBackground(() => {
                cb()
            })
        })

        control.inBackground(() => {
            while (true) {
                control.raiseEvent(myTimerID, timerTimeout1);
                basic.pause(time * 1000);
            }
        })
    }

    //% block="every %time minutes"
    //% block.loc.nl="om de %time minuten"
    export function OnEveryMin(time: number, cb: () => void) {
        const myTimerID2 = 200 + Math.randomRange(0, 100); // semi-unique
        const timerTimeout2 = 1;

        control.onEvent(myTimerID2, 0, function () {
            control.inBackground(() => {
                cb()
            })
        })

        control.inBackground(() => {
            while (true) {
                control.raiseEvent(myTimerID2, timerTimeout2);
                basic.pause(time * 60000);
            }
        })
    }

    //% block="every %time hours"
    //% block.loc.nl="om de %time uren"
    export function OnEveryHr(time: number, cb: () => void) {
        const myTimerID3 = 200 + Math.randomRange(0, 100); // semi-unique
        const timerTimeout3 = 1;

        control.onEvent(myTimerID3, 0, function () {
            control.inBackground(() => {
                cb()
            })
        })

        control.inBackground(() => {
            while (true) {
                control.raiseEvent(myTimerID3, timerTimeout3);
                basic.pause(time * 3600000);
            }
        })
    }

}

//% color="#FFCC00" icon="\uf1f9"
//% block="Dashboard"
//% block.loc.nl="Dashboard"
namespace CDashboard {

    export enum Dashboard {
        //% block="ThingSpeak"
        //% block.loc.nl="ThingSpeak"
        ThingSpeak
    }

    let SSID = ""
    let PASSWORD = ""
    let WRITEKEY = ""
    let READKEY = ""
    let DASHBOARD = Dashboard.ThingSpeak

    //% block="send to the dashboard"
    //% block.loc.nl="verzend naar het dashboard"
    export function upload() {
        let tmp : number
        let hum : number
        let prs : number
        switch (CBreedingBox.SENSOR) {
            case CBreedingBox.Sensor.Dht22 :
                tmp = DHT22.TEMPERATURE
                hum = DHT22.HUMIDITY
                prs = 0
                break
            case CBreedingBox.Sensor.Bme280 :
                tmp = BME280.TEMPERATURE
                hum = BME280.HUMIDITY
                prs = BME280.PRESSURE
                break
        }
        switch (DASHBOARD) {
            case Dashboard.ThingSpeak:
                ESP8266.setData(WRITEKEY,
                    CBreedingBox.MOISTURE,
                    CBreedingBox.LIGHT,
                    hum,
                    tmp,
                    CBreedingBox.PUMP,
                    prs);
                ESP8266.uploadData();
                break;
        }
    }

    //% block="connected to the dashboard"
    //% block.loc.nl="verbonden met het dashboard"
    export function connected(): boolean {
        switch (DASHBOARD) {
            case Dashboard.ThingSpeak:
                return ESP8266.thingSpeakState(true)
                break;
        }
        return false;
    }

    //% block="wifi ssid %ssid wifi password %passw dashboard writekey %wkey dashboard readkey %rkey"
    //% block="verbind met %dashb"
    export function connect(dashb: Dashboard) {
        DASHBOARD = dashb
        ESP8266.initWIFI(SerialPin.P8, SerialPin.P12, BaudRate.BaudRate115200)
        ESP8266.connectWifi(SSID, PASSWORD)
        switch (DASHBOARD) {
            case Dashboard.ThingSpeak:
                ESP8266.connectThingSpeak()
                break;
        }
    }

    //% block="wifi ssid %ssid wifi password %passw dashboard writekey %wkey dashboard readkey %rkey"
    //% block="wifi ssid %ssid wifi wachtwoord %passw dashboard writekey %wkey dashboard readkey %rkey"
    export function setcredentials(ssid: string, passw: string, wkey: string, rkey: string) {
        SSID = ssid
        PASSWORD = passw
        WRITEKEY = wkey
        READKEY = rkey
    }
}

//% color="#004488" icon="\uf1f9"
//% block="BarDiagram"
//% block.loc.nl="Staafdiagram"
namespace CBarDiagram {

    let BARS = 3
    let LOWLEFT = 0
    let LOWMID = 0
    let LOWRIGHT = 0
    let HIGHLEFT = 100
    let HIGHMID = 100
    let HIGHRIGHT = 100

    export enum Bar {
        //% block="left"
        //% block.loc.nl="linker"
        Left,
        //% block="midst"
        //% block.loc.nl="middelste"
        Mid,
        //% block="right"
        //% block.loc.nl="rechter"
        Right
    }

    //% block="use %count bars"
    //% block.loc.nl="gebruik %count staven"
    //% count.min=1 count.max=3 valperc.defl=3
    export function bars(count: number) {
        BARS = count;
    }

    //% block="set the high value for the %pos bar to %valperc"
    //% block.loc.nl="stel de bovenwaarde van de %pos staaf in op %valperc"
    //% valperc.min=0 valperc.max=100 valperc.defl=100
    export function highValue(pos: Bar, valperc: number) {
        if (pos == Bar.Left)
            HIGHLEFT = (valperc > LOWLEFT ? valperc : LOWLEFT)
        else
            if (pos == Bar.Mid)
                HIGHMID = (valperc > LOWMID ? valperc : LOWMID)
            else
                HIGHRIGHT = (valperc > LOWRIGHT ? valperc : LOWRIGHT)
    }

    //% block="set the low value for the %pos bar to %valperc"
    //% block.loc.nl="stel de onderwaarde van de %pos staaf in op %valperc"
    //% valperc.min=0 valperc.max=100 valperc.defl=0
    export function lowValue(pos: Bar, valperc: number) {
        if (pos == Bar.Left)
            LOWLEFT = (valperc < HIGHLEFT ? valperc : HIGHLEFT)
        else
            if (pos == Bar.Mid)
                LOWMID = (valperc < HIGHMID ? valperc : HIGHMID)
            else
                LOWRIGHT = (valperc < HIGHRIGHT ? valperc : HIGHRIGHT)
    }

    //% block="draw the %pos bar with value %valperc"
    //% block.loc.nl="teken de %pos staaf met waarde %valperc"
    //% valperc.min=0 valperc.max=100 valperc.defl=0
    export function bar(pos: Bar, valperc: number) {
        let x = (pos == Bar.Left ? 0 : 3)
        let w = 4 - BARS
        let low = (pos == Bar.Left ? LOWLEFT : LOWRIGHT)
        let high = (pos == Bar.Left ? HIGHLEFT : HIGHRIGHT)

        switch (pos) {
            case Bar.Left: low = LOWLEFT; high = HIGHLEFT
                x = 0
                break
            case Bar.Mid: low = LOWMID; high = HIGHMID;
                x = (BARS == 1 ? 1 : 2)
                break;
            case Bar.Right: low = LOWRIGHT; high = HIGHRIGHT;
                x = 5 - w
                break;
        }

        if (valperc == low) {
            for (let y = 0; y < 5; y++) {
                led.unplot(x, 4 - y)
                if (w > 1)
                    led.unplot(x + 1, 4 - y)
                if (w > 2)
                    led.unplot(x + 2, 4 - y)
            }
        }
        else {
            valperc = Math.map(valperc, low, high, 0, 4)
            for (let y = 0; y < 5; y++) {
                if (y <= valperc) {
                    led.plot(x, 4 - y)
                    if (w > 1)
                        led.plot(x + 1, 4 - y)
                    if (w > 2)
                        led.plot(x + 2, 4 - y)
                }
                else {
                    led.unplot(x, 4 - y)
                    if (w > 1)
                        led.unplot(x + 1, 4 - y)
                    if (w > 2)
                        led.unplot(x + 2, 4 - y)
                }
            }
        }
    }
}