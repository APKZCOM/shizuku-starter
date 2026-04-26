import { AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { Adb, AdbDaemonTransport } from "@yume-chan/adb";

const apkz_package_name = 'io.xapk.installer';
let AGREED = false;
let device;
let deviceName;
let adb;

let readyFor = false;

const i18n = (key, params) => {
    let msg = __I18N__[key] || `{{${key}}}`;
    if(!params) return msg;

    return msg.replace(/\${([a-zA-Z0-9_]+)}/g, (match, key) => params[key] ?? match);
};

const log = (msg, clazz) => {
    logs.innerHTML += `<div class="${clazz || 'info'}"><time class="time">[${new Date().toLocaleTimeString()}]</time> <span>${msg}</span></div>`;
    logs.scrollTop = logs.scrollHeight;
};

const clearLogs = () => {
    logs.innerHTML = '';
};

async function executeCommand(command) {
    console.log(`command: ${command}`);
    if (!adb) {
        disconnected();
        console.log("adb is not ready.");
        return '';
    }
    try {
        if (adb.subprocess.shellProtocol?.isSupported) {
            console.log("use shellProtocol");
            const result = await adb.subprocess.shellProtocol.spawnWaitText(command);
            console.log(result);
            return result.stdout || '';
        } else {
            console.log("use noneProtocol");
            const process = await adb.subprocess.noneProtocol.spawn(command);
            console.log(process);
            const reader = process.stdout.getReader();
            const chunks = [];
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(decoder.decode(value, { stream: true }));
            }
            return chunks.join('');
        }
    } catch (error) {
        console.error('executeCommand:', error);
        return '';
    }
}

async function connectDevice(_device) {
    try {
	device = _device || await AdbDaemonWebUsbDeviceManager.BROWSER?.requestDevice();
	console.log({device});
        
        if(!device || !device.raw) {
            log(i18n('msg_connect_failed'), "error");
            log(i18n('msg_checkif_usb_cable'), 'warn');
            log(i18n('msg_checkif_usb_debugging'), 'warn')
            return;
        }

        let manufacturer = device.raw.manufacturerName || 'Unknown';
        let productName = (device.raw.productName || 'Unknown').replace(manufacturer, '').trim();
        deviceName = `${manufacturer} (${productName})`;

	const credentialStore = new AdbWebCredentialStore();
	console.log({credentialStore});

	const connection = await device.connect();
	console.log({connection});

        setTimeout(function (){
            if(document.body.classList.contains('connected')) return;
            log(i18n('msg_allow_debugging', {deviceName}), 'warn');
        }, 1000);

	const transport = await AdbDaemonTransport.authenticate({
		serial: device.serial,
		connection: connection,
		credentialStore: credentialStore,
	});
	console.log({transport});

	adb = new Adb(transport);
	console.log({adb});

        await adbReady();
    } catch (err) {
        console.error(err);
        let msg = err.message || '';
        if(msg.match(/(already in used)/i)) clearLogs();
        log(`Error: ${msg}`, "error");

        if(msg.indexOf('already in used') > -1){
            log(i18n('msg_adb_in_used'), 'warn');
            log(i18n('msg_close_android_studio'), 'warn');
        }
    }

}

async function adbReady() {
    if(!device || !adb) return disconnected();

    let serialno = await adb.getProp('ro.serialno');
    console.log({serialno});
    console.log(device['#serial']);
    if(!serialno || serialno !== device.raw.serialNumber) return disconnected();

    clearLogs();
    document.body.classList.add('connected');
    document.body.classList.remove('tcp-ready');
    statusText.innerText = i18n('msg_connected', {deviceName});
    log(i18n('msg_connected', {deviceName}), 'succ');

    if(location.hash.indexOf('debug=1')>-1) window.adb = adb;
    if(readyFor) return;
    if(location.hash.indexOf('btn=tcpip') > -1){
        tcpipBtn.click();
    }else if(location.hash.indexOf('btn=stellar') > -1){
        stellarBtn.click();
    }else{
        shizukuBtn.click();
    }
}

function disconnected() {
    
    device = null;
    deviceName = null;
    adb = null;
    
    document.body.classList.remove('connected');
    statusText.innerText = i18n('msg_not_connected');
}

async function startShizuku(opts) {
    readyFor = opts.key || 'shizuku';
    let name = opts.name || 'Shizuku';
    let pkg = opts.pkg;
    let version = opts.version;
    let so_file = opts.so;
    let url = opts.url;
    if(!document.body.classList.contains('connected')){
        if(!AGREED) {
            disclaimer.showModal();
            return;
        }
        await connectDevice(device);
    }

    if(!device || !adb) return disconnected();
    
    let cmd, result;
    try {
	cmd = `pm path ${pkg}`;
        log(i18n('msg_checkif_shizuku_installed', {name}));
        result = await executeCommand(cmd);

    } catch (err) {
        log(`Error: ${err.message}`, "error");
    }
    
    let [, shizuku_path] = result.match(/package:(.+)\/base.apk/) || [];
    if(!shizuku_path){
        log(`Oops! ${result}`, 'error');
        log(i18n('msg_plz_install_shizuku', {deviceName, name}), 'warn');

	cmd = `am start -a android.intent.action.VIEW -d "${url}"`;
        await executeCommand(cmd);
        return;
    }

    try {
        cmd = `find ${shizuku_path} -name "${so_file}" 2>/dev/null`;
        result = ((await executeCommand(cmd)) || '').trim();
        console.log(result);
        if(!result || result.indexOf(shizuku_path) !== 0 || result.substr(-so_file.length) !== so_file){
            log(i18n('msg_no_shizuku_script', {name}), 'error');
            log(i18n('msg_plz_update_shizuku', {name, version}));

	    cmd = `am start -a android.intent.action.VIEW -d "${url}"`;
            await executeCommand(cmd);
            return;
        }

        cmd = result;
        log(i18n('msg_shizuku_starting', {name}));
        log(cmd);
        result = await executeCommand(cmd);

        log(result)
    } catch (err) {
        log(`Error: ${err.message}`, 'error');
    }

    let re = /shizuku_server pid is \d+/;
    if(name === 'Stellar') re = /stellar_server ([^\n\r]+) \d+/;
    if(!result.match(re)){
        log(`Oops! ${result}`, 'error');
        log(i18n('msg_shizuku_start_failed', {name}), 'error');
        return;
    }
	
    log(i18n('msg_shizuku_start_succ', {name}), 'succ');

    if(location.hash.indexOf('APKZ') > -1) openAPKZ();
}

shizukuBtn.onclick = async function (){
    await startShizuku(this.dataset);
}

stellarBtn.onclick = async function (){
    await startShizuku(this.dataset);
}

function openAPKZ() {
    log(i18n('msg_apkz_launching', {deviceName}), 'warn');
    
    let i = 3;
    let timer = setInterval(async function (){
        if(i > 0){
            log(`${i--}`);
            return;
        }
        clearInterval(timer);
        
        try {
	    let cmd = `am start -S -p ${apkz_package_name} -a android.intent.action.VIEW -d "https://app.apkz.com/shizuku"`;
            let result = await executeCommand(cmd);
        
        } catch (err) {
            log(`Error: ${err.message}`, 'error');
        }
    }, 1000);

};

tcpipBtn.onclick = async () => {
    readyFor = 'tcpip';
    if(!document.body.classList.contains('connected')){
        if(!AGREED) {
            disclaimer.showModal();
            return;
        }
        await connectDevice(device);
    }

    if(!device || !adb) return disconnected();

    try {
        let _device = deviceName;
        let _ip = (await executeCommand("ip addr show wlan0 | grep 'inet ' | cut -d' ' -f6 | cut -d/ -f1")).trim();
        let _target = _ip ? _ip+':5555' : '::';
        log(i18n('msg_wireless_debugging_activating'));
        setTimeout(function (){
            if(!device){
                log(i18n('msg_wireless_debugging_activated', {deviceName: _device}), 'succ');
                // log(i18n('msg_to_adb_connect', {_target}), 'warn');
                document.body.classList.add('tcp-ready');
                statusText.innerText = i18n('msg_tcpip_enabled');
            }
        }, 1000);
        let result = await adb.tcpip.setPort(5555);;
        log(result);
        console.log({result});

    } catch (err) {
        log(`Error: ${err.message || 'disconnected'}`, "error");
    }
};

disclaimer.onclose = async (evt) => {
    // console.log(evt);
    if(disclaimer.returnValue !== 'confirm') return;
    AGREED = true;

    await connectDevice();
}

if(navigator.usb){
    navigator.usb.addEventListener("connect", (event) => {
        console.log(`usb.connect: ${event.device.productName}`);
        console.log(event.device);
    });
    navigator.usb.addEventListener("disconnect", (event) => {
        console.log(`usb.disconnect: ${event.device.productName}`);
        console.log(event.device);
        
        disconnected();
    });
}else{
    log(i18n('msg_browser_not_support_webusb'), 'error');
}
